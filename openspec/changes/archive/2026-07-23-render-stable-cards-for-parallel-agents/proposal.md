## Why

Parallel children already emit complete, attributable identities and bounded telemetry, but Pi receives all child updates through one tool-call partial-result surface. The latest child event therefore replaces the visible card, so users cannot monitor every concurrent child with the same stable visibility available to a single worker.

## What Changes

- Render one bounded parent summary for a parallel dispatch and one stable child row/card per invocation.
- Preserve each child’s complete resolved identity, current operation, bounded telemetry, and terminal status across interleaved updates.
- Update only the child identified by an event’s authoritative `invocationId`; never let one child’s update replace another child’s state.
- Keep rendering observational, privacy-safe, localized, bounded to the existing maximum of eight children, and consistent with final terminal truth.
- Add source and real Pi integration coverage for interleaving, mixed terminal outcomes, cancellation, rendering failure, and packaged immutable-release behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `explicit-dispatch`: Strengthen observable parallel execution and complete worker identity requirements so every parallel child remains simultaneously and stably visible.

## Impact

Affected areas include `src/extension/index.ts`, parallel progress state/projection, `src/orchestration/facade.ts` as needed for parent metadata, extension/orchestration unit tests, real Pi E2E fixtures, English and Chinese documentation, and deterministic release verification. Worker execution, concurrency, campaign authority, handoff behavior, and terminal lifecycle semantics do not change.
