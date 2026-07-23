## Context

Horsepower currently has two relevant lifecycle modules. `verification-gate.ts` accepts any non-empty list of successful E2E command records, or a concrete waiver with alternative evidence, before `report_terminal` may record `completed`. `review-campaign.ts` provides finite budgets, fixed acceptance scope, and root-cause deduplication, but findings have no explicit technical disposition or resolution lifecycle. Corrective dispatches can name a review campaign without naming the accepted finding they address.

These controls already prevent unit-only completion and automatic reviewer-driven continuation, but they still leave important claims as convention: command evidence has no observation time or acceptance mapping; a successful command can be unrelated to an unverified requirement; worker output can be repeated as Captain evidence; and review feedback can move directly from finding to corrective dispatch without an explicit technical judgment.

The change must remain model-neutral and process-local, keep official OpenSpec as the sole source of change facts, preserve finite human-controlled review budgets, and avoid loading Superpowers or any other Skill in workers. Superpowers supplies useful principles—fresh evidence before claims and technical evaluation before implementation—but not the runtime contract or storage model.

## Goals / Non-Goals

**Goals:**

- Make `completed` mean that the Captain supplied fresh successful evidence for the current OpenSpec acceptance scope, not merely a successful command.
- Make stale, partial, failed, claim-mismatched, worker-only, or scope-drifted evidence fail closed with actionable machine-stable diagnostics.
- Give every in-scope review finding an explicit Captain-owned disposition and, when accepted, an evidence-backed resolution lifecycle.
- Permit corrective dispatch only for an accepted unresolved root cause and never from a reviewer verdict alone.
- Keep the contracts bounded, localized, process-local, testable, and compatible with existing OpenSpec and Horsepower authority boundaries.

**Non-Goals:**

- Install, copy, execute, or depend on Superpowers Skills.
- Add TDD or systematic-debugging workflows in this change.
- Let Horsepower decide which product-level E2E command is correct; the Captain still selects it.
- Persist runtime evidence as a competing OpenSpec planning, task, or archive store.
- Automatically dispatch fixers, reviewers, or follow-up work.
- Make successful verification mathematically tamper-proof against a dishonest Captain; the gate validates bounded, internally consistent Captain attestations and runtime-observed context.

## Decisions

### 1. Replace bare completion evidence with a bounded verification manifest

`report_terminal(status: "completed")` will require a `verification` manifest rather than accepting uncorrelated positive command summaries. The manifest contains:

- `observedAt`: the Captain-declared UTC execution/observation time;
- one to eight exact command records with stable IDs, exit code, optional duration, bounded summary, and the acceptance references each command proves;
- a bounded acceptance checklist whose entries identify current OpenSpec tasks, requirements/scenarios, or explicitly declared change-level acceptance claims and point to command IDs or alternative-evidence IDs;
- when E2E is inapplicable, the existing waiver semantics represented with a concrete reason and bounded alternative evidence mapped to acceptance references.

The completion gate will require every command used as positive evidence to have exit code zero, every acceptance entry to have evidence, every referenced evidence ID to exist, and at least one successful E2E command unless a valid waiver is present. Partial checks may be reported as evidence, but cannot imply checks they are not mapped to.

At report time Horsepower will freshly run the existing OpenSpec context validation, read the current apply-ready task scope through the supported boundary, and compute a process-local acceptance snapshot/digest. The report must match the active implementation campaign's change and task scope, and the checklist must reconcile that current scope. Scope drift, unchecked scoped acceptance, or an OpenSpec validation failure rejects completion without recording terminal state.

Freshness is evaluated against the Horsepower clock and active run: `observedAt` cannot predate the implementation campaign/run, be in the future beyond clock tolerance, or exceed a small documented maximum age (ten minutes, matching the project's existing process-local freshness convention). Horsepower records its own receipt time and current OpenSpec snapshot, so a caller cannot reuse an old accepted manifest after scope changes. The exact threshold and skew constants live in one lifecycle module and are covered with injected-clock tests.

Alternative considered: require only an `observedAt` field on the existing E2E array. Rejected because fresh but unrelated evidence still permits false completion. Alternative considered: have Horsepower execute arbitrary verification commands itself. Rejected because the orchestration tool is not a general shell runner, command choice belongs to the Captain, and changing that trust boundary would substantially expand scope and security risk.

### 2. Keep backward compatibility for non-complete reports, fail closed for legacy completion payloads

`blocked_needs_human`, `failed`, and `canceled` remain reportable without successful verification. For `completed`, the old uncorrelated `e2e`/`e2eWaiver` shape will be rejected with localized migration guidance rather than silently upgraded, because it cannot prove claim-to-evidence mapping or freshness.

The public orchestration schema, Horsepower Skill guidance, README examples, and release metadata will change together. Stable machine values—IDs, commands, timestamps, digests, statuses, and error codes—remain untranslated.

Alternative considered: infer a single wildcard acceptance claim for old payloads. Rejected because it preserves the exact ambiguity this change removes.

### 3. Model review findings as Captain-dispositioned state machines

Each root-cause finding retains its deduplicated occurrences and evidence and gains:

- disposition: `pending`, `accepted`, `rejected`, `needs_clarification`, or `blocked_needs_human`;
- a bounded Captain rationale and optional evidence reference for every non-pending disposition;
- resolution state for accepted findings: `open` or `resolved`, with fresh targeted verification evidence required to resolve;
- process-local timestamps for finding, disposition, and resolution transitions.

New Captain-only orchestration actions will disposition and resolve findings. Recording another occurrence does not erase or silently change the disposition; materially conflicting evidence returns the finding to Captain attention rather than automatically reopening or dispatching work. Out-of-scope findings remain evidence only and cannot authorize corrective dispatch.

A review campaign can end `accepted` only when every in-scope finding is either technically rejected with rationale or accepted and resolved with targeted evidence. `pending`, `needs_clarification`, `blocked_needs_human`, or accepted-open findings block acceptance and produce actionable status. Other terminal outcomes remain available.

Alternative considered: represent acceptance and resolution as free-form summaries. Rejected because the runtime could not enforce the review discipline or distinguish a valid rejection from ignored feedback.

### 4. Correlate corrective dispatch with one accepted unresolved root cause

A `fix` dispatch under a review campaign must include `reviewFindingRootCauseId`. Before consuming budget or creating work, Horsepower verifies that the finding belongs to the same change/project/campaign, is in scope, is dispositioned `accepted`, and remains unresolved. Reviewer dispatches do not name a corrective root cause; review verdicts and recommendations remain inert evidence.

One corrective dispatch addresses one root cause. If one implementation genuinely fixes multiple findings, the Captain may resolve each root cause separately against the same fresh targeted evidence after inspecting and verifying the result. This preserves deduplication and avoids creating artificial findings to obtain more budget.

Alternative considered: allow a fixer to receive all pending findings. Rejected because unclear or technically rejected feedback would become implementation authority and correlation would be lost.

### 5. Reuse one evidence validator while keeping acceptance ownership separate

A small lifecycle verification module will validate timestamps, commands, evidence IDs, mappings, and bounded summaries for both change completion and review-finding resolution. Change acceptance reconciliation stays in the OpenSpec boundary, while review disposition and state transitions stay in the review campaign module. This creates one evidence-validation seam without turning verification, OpenSpec interpretation, and review authority into one large module.

Worker reports are inputs, not verification evidence by themselves. The Captain may cite a managed artifact as supporting evidence, but completion and finding resolution still require Captain-observed current repository/OpenSpec state and the applicable fresh command or waiver evidence.

## Risks / Trade-offs

- **[The new completion schema is intentionally breaking for callers using bare `e2e`]** → Fail with explicit localized migration guidance; update all bundled Skills, docs, fixtures, and tests in the same release.
- **[Parsing OpenSpec acceptance scope could couple Horsepower to artifact formatting]** → Use official CLI status/instructions where available and isolate minimal supported artifact reading in the existing OpenSpec boundary; validate exact supported OpenSpec range and fail closed on ambiguity.
- **[A ten-minute freshness window may be too short for long verification suites]** → Measure freshness from command completion/observation, not start time; permit several command records with their own completion evidence while requiring the final manifest promptly.
- **[More review states add Captain interaction cost]** → Keep two narrow actions (`disposition`, `resolve`), bounded defaults, and status output that identifies the next blocked decision; do not add workflow automation.
- **[Captain attestations are not cryptographic command provenance]** → State the trust boundary explicitly, validate consistency and current context, and avoid claiming stronger guarantees than the runtime can enforce.
- **[Review budget can expire before all accepted findings are resolved]** → Preserve current explicit human-authorized extension and `blocked_needs_human`; never auto-increase or auto-dispatch.

## Migration Plan

1. Add failing lifecycle and schema tests for fresh claim-matched completion manifests and review finding transitions.
2. Implement shared bounded evidence validation and current OpenSpec acceptance snapshots behind existing lifecycle/boundary seams.
3. Extend review campaign state/actions and gate corrective dispatch before budget consumption.
4. Replace bundled Captain guidance, docs, localization, fixtures, and public tool schema examples atomically.
5. Run focused compatibility tests, full checks, deterministic release validation, OpenSpec validation, and fresh Captain-selected E2E acceptance.

Rollback restores the prior immutable Horsepower release. Runtime campaign, review, and verification evidence is process-local, so no persisted data migration is required. A rollback also restores the old tool schema; no OpenSpec artifact format is changed.

## Open Questions

None. The selected scope is limited to completion verification and review-feedback discipline; debugging and TDD enhancements are deferred.
