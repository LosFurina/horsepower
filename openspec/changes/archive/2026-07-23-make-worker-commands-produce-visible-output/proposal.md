## Why

`/horsepower-workers` currently serializes the persistent-worker list into `ctx.ui.notify`, so its result is a transient notification and the command handler produces no durable command output. This can appear as a silent command, especially for an empty list, and it does not explain that completed `single`, `parallel`, and `chain` children are one-shot executions rather than persistent workers.

## What Changes

- Make `/horsepower-workers` always produce a bounded, durable, visible TUI result that does not participate in LLM context.
- Render an explicit localized empty state explaining that no persistent worker exists and that completed one-shot children are not listed.
- Render each current persistent worker with stable identity, lifecycle/message status, and available bounded telemetry without exposing prompts, reports, credentials, private paths, or raw events.
- Preserve deterministic ordering, the process-lifetime worker model, and observational output semantics.
- Return localized actionable failures instead of allowing command errors or rendering failures to appear silent.
- Define non-TUI/RPC behavior explicitly and verify the actual Pi command path rather than only command registration.
- Keep parallel child-card visualization in the separate `render-stable-cards-for-parallel-agents` change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `persistent-workers`: Add reliable durable command presentation for current process-lifetime persistent workers and an explicit one-shot boundary.

## Impact

Affected areas include the extension command handler and custom entry renderer, persistent-worker summary projection as needed, localization, extension unit tests, real Pi TUI/RPC E2E, English/Chinese documentation, and immutable release verification. Worker creation, execution, retention, event streams, and terminal truth do not change.
