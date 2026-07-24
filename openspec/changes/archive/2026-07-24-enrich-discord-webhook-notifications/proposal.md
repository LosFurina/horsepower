## Why

Current Discord terminal notifications contain too little structured context to explain what happened, which task and agent were involved, or whether the recipient must act. Operators need detailed but orderly, privacy-safe messages that use Discord's visual capabilities without exposing prompts, reasoning, credentials, raw provider data, unrestricted tool output, reports, stderr, or private paths.

## What Changes

- Extend the bounded terminal webhook event with optional safe campaign, task, worker, agent, model, operation, timing, diagnostic, failure, and action-required context.
- Render Discord notifications as status-colored embeds with a concise non-empty `content` fallback, grouped fields, timestamp/footer, and disabled mentions.
- Distinguish completion, failure, cancellation, blocked/stalled diagnostics, and whether human action is required.
- Preserve the generic Horsepower JSON provider contract and legacy events whose enriched context is absent.
- Keep lifecycle terminal truth authoritative; Discord rendering remains observational and cannot reverse settlement.
- Add strict Discord limit, privacy, localization, snapshot, compatibility, and production-path delivery tests.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `platform-webhook-delivery`: Add bounded enriched terminal context and structured Discord embed delivery while retaining generic compatibility and observational semantics.

## Impact

Affected areas include terminal webhook event types and normalization, run lifecycle notification bindings, orchestration/runtime context propagation, Discord request rendering, localization, configuration diagnostics, unit/E2E fixtures, and release privacy checks. No new external dependency or Discord credential storage mechanism is introduced.
