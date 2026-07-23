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
