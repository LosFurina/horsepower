## 1. Safe Enriched Event Contract

- [x] 1.1 Extend terminal webhook types with optional bounded campaign, task, worker, agent, slot/model/thinking, work-kind, operation, timing, diagnostic, failure, and action-required context.
- [x] 1.2 Add one allowlisted normalization/redaction path with per-field and aggregate UTF-8 bounds, unknown-key omission, control-character removal, credential/URL/private-path protection, and stable deterministic ordering.
- [x] 1.3 Bind enriched context from existing authoritative campaign/run/dispatch state without reading prompts, reasoning, transcripts, reports, raw provider events, unrestricted tool output/stderr, or private handoff storage.
- [x] 1.4 Preserve legacy terminal events and generic JSON required fields, HMAC/Bearer signatures, retry behavior, and provider selection compatibility.

## 2. Discord Visual Codec

- [x] 2.1 Define a bounded Discord request type with non-empty localized `content`, exactly one embed, deterministic fields, ISO timestamp/footer, and `allowed_mentions.parse=[]`.
- [x] 2.2 Implement stable icons, titles, and colors for completed, failed, canceled, blocked, and stalled outcomes without altering authoritative terminal status.
- [x] 2.3 Render ordered outcome/action, change/task, worker/model, operation/timing, failure/diagnostic, and identifier groups while omitting unavailable or redundant fields.
- [x] 2.4 Enforce Discord limits for content, title, description, field count/name/value, embed count, and aggregate embed text with Unicode-safe truncation after redaction.
- [x] 2.5 Generate deterministic localized action guidance: no action for completion, explicit remediation when available, and bounded inspect/status/read fallbacks otherwise.

## 3. Lifecycle and Failure Visibility

- [x] 3.1 Extend run notification bindings and orchestration/runtime call sites to carry safe context for change and dispatch terminal settlement.
- [x] 3.2 Ensure notification context is immutable per run, first-terminal-wins, and unavailable values are omitted rather than guessed.
- [x] 3.3 Keep codec and delivery failures observational while recording bounded provider, failure class, attempt count, and status code through existing delivery surfaces.
- [x] 3.4 Keep `doctor` static-only and make `webhook test` exercise the enriched Discord production request without exposing the configured URL or credentials.

## 4. Contract and Privacy Tests

- [x] 4.1 Add codec snapshots for completed, failed, canceled, blocked, stalled, and legacy context-free Discord events in `en` and `zh-CN`.
- [x] 4.2 Add strict structural tests for colors, field order, omitted empty fields, one-embed/25-field limits, aggregate limits, timestamp/footer, and disabled mentions.
- [x] 4.3 Add adversarial privacy tests proving prompts, reasoning, credentials, secret URL parameters, provider payloads, tool output, reports, stderr, and private paths cannot enter Discord or generic output.
- [x] 4.4 Add lifecycle tests proving task/agent/worker/model/action context reaches the correct run once and does not become terminal or completion authority.
- [x] 4.5 Add generic compatibility tests proving legacy JSON/signature consumers and missing-provider settings remain unchanged.

## 5. Production Verification and Release Safety

- [x] 5.1 Add production-path HTTP E2E proving enriched Discord delivery uses the configured `discord` provider and accepts HTTP 204 while receiver rejection remains attributable.
- [x] 5.2 Perform one explicit real Discord visual acceptance using a rotated webhook credential and confirm the message is detailed, orderly, localized, and mention-safe.
- [x] 5.3 Update CLI/help and operator documentation with provider-explicit configuration, notification trigger scope, rich-message field meanings, and credential-rotation guidance.
- [x] 5.4 Run typecheck, build, focused/full tests, strict OpenSpec validation, git diff checks, and clean release privacy/manifest scans before immutable release.
