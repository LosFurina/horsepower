## 1. RED Parallel Projection Contracts

- [x] 1.1 Add failing reducer tests that admit two to eight parallel identities in canonical input order and prove interleaved events update only the matching `invocationId` while retaining every child snapshot.
- [x] 1.2 Add failing extension-renderer tests for the bounded parent totals and complete per-child identity, operation/status, elapsed, authoritative usage, latest utterance, and untranslated machine fields in `en` and `zh-CN`.
- [x] 1.3 Add failing mixed-outcome and cancellation tests proving completed, failed, and canceled child states remain visible and immutable while siblings continue and final details agree with first-terminal-wins truth.
- [x] 1.4 Add failing privacy, UTF-8/aggregate bound, duplicate/unknown identity, stale post-terminal event, and renderer/onUpdate failure tests proving observational behavior.

## 2. Stable Parallel Card Implementation

- [x] 2.1 Introduce an ephemeral bounded parallel operation-card projection keyed by immutable invocation identity and ordered by admitted task position.
- [x] 2.2 Reduce normalized progress into per-child snapshots, compute truthful parent counts from child states, and freeze child terminal presentation against later non-terminal updates.
- [x] 2.3 Render each aggregate partial result with the parent summary and all child identities/telemetry while preserving existing single and chain card behavior.
- [x] 2.4 Expose bounded machine-stable parent and child projection details, catch all projection/render delivery failures, and release projection state when the tool call settles.

## 3. Integration and Documentation

- [x] 3.1 Add orchestration/extension integration tests for accepted-order registration, four-way concurrency interleaving, managed handoff stages, and final per-child identity/outcome reconciliation.
- [x] 3.2 Add real Pi extension E2E proving one parallel tool call keeps multiple children simultaneously visible through partial-result replacement rather than merely emitting attributable events.
- [x] 3.3 Update English and Chinese documentation with parallel parent/child card semantics, field bounds, terminal retention, privacy exclusions, and rendering-failure behavior.

## 4. Verification and Immutable Acceptance

- [x] 4.1 Run focused progress/orchestration/extension tests, typecheck, full unit/E2E suites, strict OpenSpec validation, deterministic release/privacy checks, `npm run check`, and `git diff --check`.
- [x] 4.2 Build and install a new immutable alpha release, manually dispatch multiple real parallel children with interleaved progress and mixed completion timing, inspect stable parent/child cards, and submit fresh claim-matched terminal evidence.
