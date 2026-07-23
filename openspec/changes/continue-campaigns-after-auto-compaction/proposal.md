## Why

Pi automatic context compaction can leave an already confirmed Horsepower/OpenSpec campaign idle even though the user already selected its change, exact task scope, and execution mode. Requiring the user to type `go` after lossy maintenance interrupts long-running work and incorrectly treats compaction as a new authorization boundary.

## What Changes

- Track bounded process-local continuation state for the currently active implementation campaign without duplicating OpenSpec task facts.
- After successful automatic `threshold` or `overflow` compaction, continue the same active campaign automatically with its unchanged change ID, exact selected task IDs, and user-selected mode.
- When Pi reports `willRetry: true`, rely on Pi's native retry and do not enqueue a duplicate Horsepower continuation.
- When Pi will not retry and has no pending continuation, enqueue exactly one Horsepower follow-up turn after compaction; never require a `go` prompt or repeat campaign selection.
- Revalidate the active campaign and official OpenSpec inventory immediately before continuation and stop safely on switched/ended campaign, task completion/drift, invalid context, terminal report, explicit pause/block, failed/aborted compaction, manual `/compact`, or an already-pending continuation.
- Preserve worker execution, persistent sessions, managed handoffs, review budgets, and terminal truth across compaction without automatically creating extra workers or changing scope.
- Add deterministic extension-event and real Pi E2E coverage for threshold/overflow compaction, native retry, exactly-once queued continuation, repeated compaction, and all stop conditions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `explicit-dispatch`: Keep a user-authorized campaign moving across automatic Pi compaction without duplicate kickoff or renewed user prompts.
- `openspec-execution-boundary`: Revalidate the same official OpenSpec task scope before post-compaction continuation and fail closed on drift or terminal/blocked state.

## Impact

Affected areas include Pi `session_before_compact`, `session_compact`, `agent_settled`, `ctx.isIdle`, and `ctx.hasPendingMessages` integration; implementation-campaign lifecycle state; queued extension follow-ups; OpenSpec inventory revalidation; localized notices; extension/runtime tests; and real Pi compaction E2E fixtures. State remains process-local, and no campaign is restored after Pi process restart.
