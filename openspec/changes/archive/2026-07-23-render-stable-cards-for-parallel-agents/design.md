## Context

One-shot orchestration already assigns every parallel child an immutable `WorkerIdentity`, including a unique `invocationId` and child run ID, and forwards normalized telemetry with each event. The extension currently maps each event independently through `progressResult(event)` and invokes the one Pi tool call's `onUpdate`. Pi treats those partial results as replacements for that tool call's current result, so whichever child emitted most recently becomes the only visible child card.

Parallel execution is capped at eight tasks and four concurrent processes. Any solution must retain those limits, avoid rendering raw worker data, remain observational, and preserve first-terminal-wins lifecycle and managed-handoff truth.

## Goals / Non-Goals

**Goals:**

- Keep a stable parent summary and simultaneously visible state for every parallel child.
- Reuse single-worker identity and telemetry semantics for each child.
- Correlate interleaved events by authoritative `invocationId` while preserving submitted task order.
- Keep structured details bounded, localized at the human layer, privacy-safe, and non-authoritative.
- Verify behavior through deterministic unit tests and a real Pi partial-result path.

**Non-Goals:**

- Change worker concurrency, dispatch schemas, model-slot selection, handoff rules, or campaign authorization.
- Create multiple Pi tool calls for one `parallel` action.
- Persist card state after the parent tool call settles.
- Accumulate worker transcripts or expose reasoning, prompts, tool output, reports, or private paths.
- Redesign persistent-worker cards or chain sequencing beyond shared renderer compatibility.

## Decisions

### 1. Maintain one per-execution parallel projection in the extension

At tool execution start, the extension will create a bounded projection only when the requested action is `parallel`. The projection will hold parent counts, canonical child order, and the latest normalized card state keyed by `invocationId`. Every progress event reduces into this projection and `onUpdate` receives a complete snapshot rather than one event-only child card.

Alternative: emit separate Pi tool calls for children. Rejected because the Captain made one explicit tool call and splitting it would alter tool execution, cancellation, and terminal-result semantics.

### 2. Establish canonical order from admitted identities

The orchestration layer already emits `accepted` once for each invocation in input order before execution. The reducer will register children from those authoritative identities and retain that order regardless of later event interleaving. Unknown, duplicate, or identity-changing events will fail closed at the observational boundary and will not reassign existing child state.

Alternative: sort by latest event time or child name. Rejected because it causes card movement or ambiguity when names repeat.

### 3. Render an aggregate snapshot through the existing tool update callback

A parallel snapshot will include a localized parent summary and one child section/row with the same complete title, operation/status, elapsed usage, and latest-utterance rules used for single cards. Structured `details` will expose bounded stable parent counters and child snapshots. The projection will recompute counters from child state instead of trusting caller-supplied totals.

Alternative: show only aggregate counts. Rejected because it does not satisfy single-equivalent child visibility or debugging needs.

### 4. Keep projection state observational and ephemeral

Reducer or renderer exceptions will be caught at the progress boundary exactly like current callback failures. No projection state will authorize work, determine lifecycle settlement, validate reports, or override returned terminal data. The projection is released when `execute` returns or throws.

### 5. Derive terminal child presentation from authoritative events and final details

Child `completed`, `failed`, and `canceled` events freeze that child's visible terminal status against later non-terminal observational updates. On parent settlement, the renderer will reconcile only with authoritative terminal identities/outcomes already returned by orchestration; it will not infer completion from process silence or fabricate unavailable telemetry. First authoritative terminal settlement remains unchanged.

### 6. Test the replacement surface, not only event production

Unit tests will interleave two or more child identities through a single `onUpdate` callback and assert every partial snapshot retains all admitted children. E2E will exercise a real Pi extension tool call so a passing event-array test cannot hide replacement behavior in the actual partial-result surface.

## Risks / Trade-offs

- **[More text in one tool card]** → Cap children at the existing eight, apply deterministic UTF-8-safe per-field and aggregate bounds, and use compact collapsed rendering while retaining all identities.
- **[Events arrive before all accepted identities]** → Orchestration emits accepted events synchronously in input order; reducer tests fail closed if that invariant regresses.
- **[A stale event overwrites terminal display]** → Terminal child states reject later non-terminal projection updates while lifecycle truth remains external.
- **[TUI-specific assumptions differ across Pi versions]** → Exercise the supported Pi range through packaged E2E and keep structured details independent of styling.
- **[Rendering defects affect execution]** → Catch projection and callback errors and prove unchanged terminal results with failure-injection tests.

## Migration Plan

1. Add RED reducer/renderer tests for interleaved children and stable snapshots.
2. Introduce the bounded parallel projection and aggregate renderer without changing one-shot execution.
3. Add mixed-outcome, cancellation, localization, privacy, and rendering-failure coverage.
4. Exercise the real Pi partial-result path and deterministic release artifact.
5. Install a new immutable alpha release and manually inspect a multi-child parallel card.

Rollback removes the aggregate projection and restores event-only rendering; no persisted state or configuration migration is required.

## Open Questions

None. The implementation may choose compact rows or sections according to Pi TUI constraints, but every admitted child and required field must remain available in the stable snapshot.
