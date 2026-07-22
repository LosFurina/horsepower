## Why

`/horsepower-campaign` currently asks users to manually type a comma-separated task-scope string using a hard-coded unrelated example, while Horsepower neither displays the selected change's real OpenSpec tasks nor validates that entered IDs exist and remain unfinished. This shallow interface causes Captain guidance, UI expectations, and runtime authorization to diverge, and can authorize ambiguous ranges containing nonexistent or already completed tasks.

## What Changes

- Make `/horsepower-campaign` load the selected apply-ready OpenSpec change and present its current task inventory before scope selection.
- Offer explicit choices for all unfinished tasks, unfinished tasks by section, or manually selected task IDs.
- Replace free-form numeric-range authorization with a canonical set of real OpenSpec task IDs captured from the current `tasks.md` snapshot.
- Validate manual selection against current task IDs, reject nonexistent and completed tasks, remove duplicates, and show the normalized selection for confirmation.
- Revalidate authorized task IDs against current OpenSpec tasks before each work-producing dispatch so task completion or artifact drift fails closed instead of silently expanding authority.
- Make the campaign command, Horsepower Skill, English and Chinese documentation, errors, examples, and tests describe the same task-selection contract.
- Immediately trigger exactly one Captain turn after a campaign is successfully confirmed and created, so implementation starts without requiring the user to send a separate `go` message.
- Restore bounded live visibility into each one-shot subagent's lifecycle and tool activity instead of showing only a final result or an unexplained wait.
- Give every subagent display a stable execution identity containing dispatch name, agent name and role, requested/resolved model slot, concrete model, thinking level, and handoff mode.
- Make every accepted dispatch reach a structured `completed`, `failed`, or `canceled` result; forbid empty tool results and orphan managed handoffs when validation, capability checks, spawn, streaming, report validation, or cleanup fails.
- Preserve explicit user choice of `multi_agent` or `main_agent`, process-local campaigns, OpenSpec ownership, Captain authority, existing review-budget rules, and bounded private worker output.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `explicit-dispatch`: Implementation campaign scope selection and dispatch authorization must use discovered, canonical, unfinished OpenSpec task IDs rather than unvalidated comma-separated scope expressions.
- `openspec-execution-boundary`: The official OpenSpec boundary must expose a bounded current task inventory/snapshot for campaign selection and dispatch-time revalidation without creating a parallel task store.

## Impact

Affected areas include the OpenSpec boundary and CLI runner integration, task parsing and snapshot validation, implementation-campaign state and authorization, the `/horsepower-campaign` Pi command flow and post-confirmation turn delivery, one-shot JSON event parsing, orchestration progress callbacks and terminalization, tool rendering, localized worker identity/progress, managed handoff failure cleanup, Horsepower Skill instructions, English and Chinese READMEs, unit/integration/E2E tests, and public campaign result details. Existing active campaigns are process-local and do not require persisted migration; the release changes the accepted campaign scope input from arbitrary strings/ranges to canonical task IDs selected from OpenSpec, makes successful campaign creation immediately actionable, and restores observable, terminally reliable subagent execution.
