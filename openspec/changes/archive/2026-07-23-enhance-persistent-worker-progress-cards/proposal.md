## Why

Horsepower persistent workers are reusable, but the current Captain experience does not make non-blocking dispatch behavior or ongoing worker activity sufficiently observable. Operation cards omit elapsed time, aggregate input/output token usage, and the latest privacy-safe worker utterance, making a live persistent session look like a blocking one-shot and forcing the Captain to inspect lower-level events.

## What Changes

- Require persistent `create` admission and `send(wait: false)` / `steer(wait: false)` delivery to return promptly with stable worker/message identity while the persistent worker continues independently, so the Captain can perform other work and later use `status`, `read`, follow-up delivery, `abort`, or `destroy` against the same worker.
- Make human `Esc` cancellation observable and orphan-free: a canceled wait/run reports structured cancellation identity, never fabricates a managed report, and leaves no hidden active one-shot execution.
- Add bounded elapsed-time and aggregate input/output-token telemetry to worker progress snapshots and operation cards for one-shot and persistent execution.
- Display the latest normalized worker utterance in the operation card when available, after credential/path redaction, control-character removal, UTF-8-safe truncation, and aggregate event/byte bounds.
- Keep full prompts, reasoning, raw provider payloads, unrestricted tool output, private handoff paths, credentials, and full reports out of progress cards.
- Preserve observational semantics: progress collection or rendering failure must not alter dispatch execution, persistent-worker lifetime, managed handoff validation, or terminal truth.
- Add deterministic unit, integration, and real Pi E2E coverage for non-blocking persistent reuse and telemetry rendering.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `persistent-workers`: Strengthen non-blocking message dispatch and reusable-session observability requirements.
- `explicit-dispatch`: Extend bounded attributed live progress and stable operation cards with elapsed time, token usage, and the latest privacy-safe worker utterance.

## Impact

Affected areas include persistent create/message lifecycle and result contracts, Captain cancellation handling, Pi RPC event normalization, one-shot and persistent usage aggregation, progress snapshot types, extension operation-card rendering, privacy/redaction bounds, runtime and extension tests, real Pi E2E fixtures, bundled Skill guidance, and English/Chinese documentation. No model selection, OpenSpec planning ownership, worker security boundary, or terminal authority changes are introduced.
