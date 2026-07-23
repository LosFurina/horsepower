## Context

Pi emits `session_before_compact` and `session_compact` for manual, threshold, and overflow compaction. `event.willRetry` identifies overflow recovery that Pi will retry itself; `agent_settled` means no automatic retry, compaction retry, or queued continuation remains. Extension control flow exposes `ctx.isIdle()` and `ctx.hasPendingMessages()`, and `pi.sendMessage(..., { deliverAs: "followUp", triggerTurn: true })` can enqueue a continuation.

Horsepower implementation campaigns are process-local and already contain user-authorized change ID, exact selected task snapshots/order/digest, and mode. Campaign dispatch revalidates current official OpenSpec inventory, but the extension currently has no post-compaction continuation state. A lossy summary can therefore leave the Captain idle and waiting for `go` despite unchanged authorization.

## Goals / Non-Goals

**Goals:**

- Continue the same active campaign after successful automatic compaction without a new user prompt.
- Use Pi native retry when available and enqueue at most one Horsepower continuation otherwise.
- Preserve exact change/task/mode authorization and revalidate official OpenSpec before continuation.
- Stop safely for terminal, blocked, paused, drifted, switched, ended, manual, failed, aborted, or duplicate cases.
- Keep behavior process-local, bounded, testable, and non-authoritative regarding completion.

**Non-Goals:**

- Resume campaigns after Pi process restart, `/new`, unrelated `/resume`, or project change.
- Automatically continue after manual `/compact`.
- Infer a new scope/mode, mark tasks complete, dispatch extra workers, reset review budgets, or fabricate terminal evidence.
- Replace or customize Pi compaction summaries.

## Decisions

### 1. Maintain one process-local continuation lease for the active campaign

When a campaign is confirmed, the extension records a bounded lease containing campaign ID, project root, change ID, selected task IDs, inventory digest, mode, generation, and state (`active`, `paused`, `terminal`, or superseded). This is execution authorization metadata already owned by the campaign manager, not a second planning store. Beginning another campaign invalidates the prior lease.

Alternative: recover authorization from the lossy compaction summary. Rejected because summaries are model-generated and cannot authorize scope/mode.

### 2. Distinguish Pi retry from Horsepower continuation

On successful `session_compact`:

- `reason=manual`: do nothing;
- `willRetry=true`: mark the compaction generation as Pi-owned and enqueue nothing;
- automatic compaction with no Pi retry: wait until `agent_settled`, then continue only if `ctx.isIdle()` and `!ctx.hasPendingMessages()` and the same generation has no queued continuation.

The continuation is delivered as one extension follow-up with `triggerTurn: true`. A generation/idempotency key prevents duplicate delivery across repeated hooks/events.

Alternative: always send a follow-up in `session_compact`. Rejected because it races Pi overflow retry and can duplicate work.

### 3. Revalidate before enqueue and again before work production

Before continuation, Horsepower checks that the campaign remains active for the same project/change/mode, its selected tasks still match current official inventory order/snapshots/digest and remain pending, and no change terminal state or explicit pause/block exists. Existing dispatch-time validation remains mandatory, closing the race after enqueue.

If validation fails, Horsepower emits one bounded localized stop notice and does not ask for `go`; scope changes require a fresh campaign selection.

### 4. Continuation message carries authorization identity, not full prompts

The follow-up includes only bounded stable campaign identity, exact task IDs, mode, and an instruction to continue from official OpenSpec/current repository state. It excludes previous complete prompts, raw provider payloads, private paths, worker reports, credentials, and full compaction summaries. The Captain must reread supported OpenSpec context as necessary.

### 5. Explicit pause and terminal state suppress continuation

Campaign runtime gains a bounded continuation disposition so the Captain can record that execution is paused/blocked/terminal. Assistant silence alone is not terminal, but an explicit blocked/terminal report or human interruption prevents auto-resume. User steering/follow-up already queued takes precedence.

## Test and Gate Plan

### Profiles
- testIntensity: exhaustive
- gateStrictness: release

### Test Cases

#### TC-1: continuation lease lifecycle
- maps: scenario:Post-compaction continuation authority/Same campaign remains eligible, scenario:Post-compaction continuation authority/Campaign was switched or ended, scenario:Post-compaction continuation authority/Work has an explicit stop state, scenario:Post-compaction continuation authority/Session or project is replaced, task:1.1, task:1.2
- level: unit
- purpose: prove only the active process-local campaign lease can authorize continuation and stale authority is invalidated
- preconditions: create a campaign with fixed campaign, project, change, task, mode, inventory, and generation identity
- action: exercise active, switch, end, pause, blocked, terminal, project replacement, session replacement, and duplicate generation transitions
- expected: only the unchanged active lease remains eligible and every superseded or stopped lease is suppressed
- failure: old authorization was revived, scope leaked, or one generation could continue more than once
- disposition: required

#### TC-2: official OpenSpec revalidation
- maps: scenario:Post-compaction OpenSpec revalidation/Official scope is unchanged, scenario:Post-compaction OpenSpec revalidation/Selected task changed or completed, scenario:Post-compaction OpenSpec revalidation/OpenSpec context is invalid, scenario:Post-compaction OpenSpec revalidation/Drift occurs after continuation is queued, task:1.3, task:1.4
- level: integration
- purpose: prove continuation authority remains correlated to current official OpenSpec facts before enqueue and dispatch
- preconditions: use a strict-valid fixture change with ordered selected task snapshots and a known inventory digest
- action: exercise unchanged, completed, missing, reordered, renamed, moved, invalid CLI context, project mismatch, and post-enqueue drift states
- expected: only snapshot-equivalent pending scope continues and all drift fails before work-producing side effects
- failure: Horsepower inferred, repaired, or advanced stale OpenSpec authority
- disposition: required

#### TC-3: threshold exactly-once continuation
- maps: scenario:Automatic-compaction campaign continuation/Threshold compaction settles without Pi retry, task:2.1, task:2.2, task:3.2, task:3.4
- level: e2e
- purpose: prove a successful automatic threshold compaction resumes the same campaign without a user go message
- preconditions: run official Pi with an active campaign, no pending message, threshold reason, and willRetry false
- action: force successful automatic compaction and observe the settled extension lifecycle and next Captain turn
- expected: exactly one follow-up turn starts with unchanged campaign, change, task, and mode identity
- failure: the campaign stalled, duplicated its kickoff, or created new authorization
- disposition: required

#### TC-4: overflow native retry ownership
- maps: scenario:Automatic-compaction campaign continuation/Overflow compaction will retry, task:2.1, task:2.2, task:3.2
- level: compatibility
- purpose: prove Horsepower does not compete with the official Pi overflow retry contract
- preconditions: run the supported Pi lifecycle with overflow reason and willRetry true
- action: complete compaction and observe native retry plus all Horsepower queued messages
- expected: Pi native retry is the only continuation and Horsepower enqueues no follow-up
- failure: Pi and Horsepower both retried the same work
- disposition: required

#### TC-5: pending and duplicate suppression
- maps: scenario:Automatic-compaction campaign continuation/Existing continuation is pending, task:2.1, task:2.2, task:2.3
- level: concurrency
- purpose: prove repeated and interleaved lifecycle events cannot enqueue duplicate campaign continuation
- preconditions: arrange duplicate generation hooks and cases with an existing steering, follow-up, or pending message
- action: permute repeated session-before-compact, session-compact, and agent-settled events
- expected: each eligible generation queues at most one continuation and a preexisting pending continuation yields zero
- failure: idempotency or pending-message arbitration allowed duplicate work
- disposition: required

#### TC-6: manual failed and aborted stop paths
- maps: scenario:Automatic-compaction campaign continuation/Manual compaction completes, scenario:Automatic-compaction campaign continuation/Compaction fails or is aborted, task:2.1, task:2.3
- level: failure-path
- purpose: prove user maintenance and unsuccessful compaction never authorize automatic execution
- preconditions: construct manual, failed, aborted, and missing-success-entry lifecycle sequences
- action: deliver settled and repeated hooks for every unsuccessful or manual sequence
- expected: no continuation, worker, run, handoff, budget consumption, fabricated progress, or terminal state occurs
- failure: a non-eligible compaction event advanced campaign work
- disposition: required

#### TC-7: idle and event-order boundaries
- maps: scenario:Automatic-compaction campaign continuation/Threshold compaction settles without Pi retry, scenario:Automatic-compaction campaign continuation/Existing continuation is pending, task:2.1, task:2.2
- level: boundary
- purpose: prove continuation occurs only at the valid idle and no-pending lifecycle boundary
- preconditions: cover every isIdle and hasPendingMessages combination plus settled-before and settled-after compact ordering
- action: execute all supported boundary combinations for one automatic generation
- expected: only successful automatic compaction with idle true, pending false, and no native retry can enqueue
- failure: an active turn was interrupted or an eligible campaign was left permanently idle
- disposition: required

#### TC-8: adversarial stale identity and sensitive summary
- maps: scenario:Post-compaction continuation authority/Campaign was switched or ended, scenario:Bounded private continuation message/Compaction summary contains sensitive content, task:2.3, task:2.4
- level: adversarial
- purpose: prevent stale authority revival and sensitive compaction content from entering continuation payloads
- preconditions: prepare conflicting campaign generations and summaries containing credential, private-path, provider, and oversized text shapes
- action: attempt continuation with stale identity and inspect every projected field in the resulting bounded outcome
- expected: stale identity is rejected and continuation data contains only allowlisted stable campaign fields
- failure: old authority resumed or private summary content escaped into progress or follow-up data
- disposition: required

#### TC-9: localized bounded follow-up
- maps: scenario:Bounded private continuation message/Continuation is queued, task:2.4, task:3.1
- level: platform
- purpose: prove localized continuation remains bounded while preserving untranslated authorization identity
- preconditions: configure en and zh-CN and use the maximum supported selected-task scope
- action: render continuation and stop notices and inspect the private follow-up payload
- expected: human text follows locale while campaign, change, task, and mode tokens remain stable and bounded
- failure: localization changed machine identity or payload bounds and privacy were violated
- disposition: required

#### TC-10: repeated compaction and full regression
- maps: scenario:Post-compaction continuation authority/Assistant becomes quiet without terminal evidence, scenario:Post-compaction continuation authority/Work has an explicit stop state, task:2.3, task:3.2, task:3.3
- level: regression
- purpose: preserve existing worker, handoff, review, and terminal behavior across repeated automatic compaction
- preconditions: run full suites and multiple automatic generations separated by real campaign activity
- action: compare quiet assistant settlement with explicit pause and terminal states while running repository regression
- expected: quietness alone permits eligible continuation, each generation continues once, and explicit stop states continue zero times
- failure: turn settlement became false terminal evidence or existing lifecycle behavior regressed
- disposition: required

### Gates

#### G-1: strict OpenSpec validity
- maps: task:3.3
- intent: openspec validate --all --strict
- scope: all active main and delta specifications after implementation
- pass: every item validates strictly with exit code zero
- disposition: required
- phase: completion
- waiver: no waiver is permitted for official OpenSpec validity
- floor: openspec

#### G-2: release privacy and manifest scan
- maps: scenario:Bounded private continuation message/Continuation is queued, scenario:Bounded private continuation message/Compaction summary contains sensitive content, task:2.4, task:3.3
- intent: run the release builder privacy and manifest verification against the exact release source snapshot
- scope: source manifest, packaged extension, fixtures, continuation projections, and release archive
- pass: scanning exits zero without credentials, private handoff paths, prompts, reports, or concrete private bindings
- disposition: required
- phase: release
- waiver: scanner rules cannot be weakened; privacy-shaped fixtures must use safe runtime composition
- floor: privacy

#### G-3: continuation authorization security
- maps: scenario:Post-compaction continuation authority/Campaign was switched or ended, scenario:Post-compaction continuation authority/Session or project is replaced, scenario:Post-compaction OpenSpec revalidation/Selected task changed or completed, task:1.1, task:1.2, task:1.3, task:1.4, task:2.3
- intent: run focused campaign authority, stale identity, and OpenSpec drift tests
- scope: lease ownership, selected scope, generation identity, project ownership, and pre-side-effect rejection
- pass: every unauthorized continuation is rejected before queue, budget, run, worker, or handoff creation
- disposition: required
- phase: completion
- waiver: no waiver is permitted for campaign authorization security
- floor: security

#### G-4: official Pi compatibility
- maps: scenario:Automatic-compaction campaign continuation/Threshold compaction settles without Pi retry, scenario:Automatic-compaction campaign continuation/Overflow compaction will retry, task:2.1, task:2.2, task:3.2
- intent: exercise the supported official Pi compaction event contract and installed RPC surface
- scope: threshold, overflow, willRetry, settled ordering, idle state, and pending-message behavior
- pass: official Pi behavior matches the tested event contract without unsupported private API assumptions
- disposition: required
- phase: completion
- waiver: source-only simulation cannot replace final official Pi compatibility evidence
- floor: compatibility

#### G-5: terminal and lifecycle truth
- maps: scenario:Automatic-compaction campaign continuation/Manual compaction completes, scenario:Automatic-compaction campaign continuation/Compaction fails or is aborted, scenario:Post-compaction continuation authority/Work has an explicit stop state, task:2.3
- intent: run the manual, failed, aborted, paused, blocked, and terminal no-side-effect matrix
- scope: continuation queue, workers, runs, handoffs, budgets, progress, and terminal reporting
- pass: every stop path queues nothing and preserves truthful first-terminal and no-orphan behavior
- disposition: required
- phase: completion
- waiver: no waiver is permitted for lifecycle or terminal truth
- floor: terminal-truth

#### G-6: real Pi automatic-compaction acceptance
- maps: scenario:Automatic-compaction campaign continuation/Threshold compaction settles without Pi retry, scenario:Automatic-compaction campaign continuation/Overflow compaction will retry, scenario:Automatic-compaction campaign continuation/Existing continuation is pending, task:3.2, task:3.4
- intent: run real Pi threshold, overflow, pending, and repeated-compaction acceptance
- scope: active campaign continuation through the actual extension and supported Pi process
- pass: eligible work continues once without go, native retry is not duplicated, and exact scope and mode remain unchanged
- disposition: required
- phase: completion
- waiver: only when official Pi is unavailable, with a concrete environment reason and fresh mapped alternative evidence
- floor: e2e

#### G-7: full repository regression
- maps: task:3.3
- intent: npm ci followed by npm run check and git diff --check
- scope: typecheck, unit, build, all E2E suites, and repository diff hygiene
- pass: every command exits zero and all required suites report no failures
- disposition: required
- phase: completion
- waiver: no waiver is permitted for the release regression gate
- floor: regression

#### G-8: immutable release and installed acceptance
- maps: scenario:Automatic-compaction campaign continuation/Threshold compaction settles without Pi retry, scenario:Automatic-compaction campaign continuation/Overflow compaction will retry, scenario:Post-compaction OpenSpec revalidation/Drift occurs after continuation is queued, task:3.3, task:3.4
- intent: build twice, compare bytes, verify checksum and privacy, install immutably, run doctor, and execute installed real Pi acceptance
- scope: deterministic archive, prior-version preservation, active symlink, installed extension, rollback safety, duplicate detection, and orphan audit
- pass: builds are byte-identical, old versions remain unchanged, doctor is healthy, installed acceptance passes, and no duplicate or orphan exists
- disposition: required
- phase: release
- waiver: source-only tests cannot replace packaged immutable installation evidence
- floor: release

## Risks / Trade-offs

- **[Duplicate work from retry races]** → Key continuation by compaction generation, honor `willRetry`, wait for `agent_settled`, and inspect pending messages.
- **[Compaction summary omits critical details]** → Continue from official OpenSpec and repository state, not summary authority; preserve selected scope metadata process-locally.
- **[Campaign changes during compaction]** → Correlate project/campaign/generation and revalidate before queue and dispatch.
- **[Infinite compact/continue loop]** → At most one continuation per successful automatic compaction generation; no continuation on failure or immediate repeated unproductive settled state without new campaign activity.
- **[Extension event ordering differs]** → Unit-test permutations and real Pi threshold/overflow behavior; use `agent_settled` rather than `agent_end`.

## Migration Plan

1. Add failing lifecycle/extension tests for event permutations, exactly-once continuation, and stop conditions.
2. Add bounded campaign continuation lease/status and OpenSpec revalidation.
3. Wire Pi compaction/settled hooks and localized continuation/stop notices.
4. Update Skill/docs and real Pi E2E fixtures.
5. Run focused/full tests, strict validation, deterministic release gates, and installed alpha smoke.

Rollback restores the prior immutable alpha release. Continuation leases are process-local and require no data migration.

## Open Questions

None. Manual compaction does not auto-continue; successful automatic compaction does, unless Pi already retries or a stop condition applies.
