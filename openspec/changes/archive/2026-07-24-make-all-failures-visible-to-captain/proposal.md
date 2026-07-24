## Why

Horsepower currently exposes many business failures, but some errors are collapsed into generic failures, confined to transient progress cards, or swallowed by fallback and asynchronous cleanup paths. Captain needs bounded, privacy-safe, actionable failure information across the whole product so it can distinguish bad input, configuration, process, lifecycle, evidence, notification, update, and presentation failures without guessing or mistaking degraded execution for success.

## What Changes

- Establish a project-wide failure visibility contract for every operation that can affect a request, lifecycle state, persisted artifact, or diagnostic conclusion.
- Return bounded structured failures with stable code, boundary, stage, safe message, remediation, and available operation identity instead of silently swallowing or generically flattening actionable failures.
- Preserve child-level outcomes for parallel or composite work and fail the parent result when any required child fails, while retaining successful child facts.
- Make asynchronous failures after admission observable to Captain through existing durable worker/run/status surfaces rather than adding a second source of terminal truth.
- Record bounded observational diagnostics for rendering, localization, notification, and best-effort cleanup failures without changing an otherwise valid business terminal state.
- Audit CLI, setup, updater, release, configuration, OpenSpec, campaign/review, verification, handoff, worker, process/RPC, webhook, and TUI paths for hidden or ambiguous failures.
- Improve the bundled Horsepower Skill guidance so initial implementation dispatches explicitly use `agent: "coder"` and an independently selected `modelSlot`.
- Keep all surfaced errors redacted and bounded; do not expose prompts, credentials, raw provider payloads, unrestricted stderr/tool output, or private handoff paths.

## Capabilities

### New Capabilities
- `captain-failure-visibility`: Defines safe structured failure projection, composite failure reporting, and bounded observational diagnostics across Horsepower operations.

### Modified Capabilities
- `explicit-dispatch`: Require dispatch input, admission, execution, settlement, and child failures to remain attributable and visible to Captain.
- `persistent-workers`: Require asynchronous worker/message failures and degraded cleanup outcomes to remain inspectable through existing worker surfaces.
- `openspec-execution-boundary`: Require authorization, inventory, campaign, review, drift, and verification failures to retain actionable boundary information.
- `github-release-installation`: Require setup, compatibility, update, activation, rollback, and release verification failures to be explicit without weakening transactional guarantees.
- `platform-webhook-delivery`: Require notification failures and static diagnostics to be observable without altering authoritative terminal truth.
- `cli-help`: Require command parsing and operational failures to return actionable bounded errors rather than ambiguous output or silent fallbacks.

## Impact

The change affects shared error normalization and redaction, tool results, orchestration and batch outcomes, persistent worker state, Pi process/RPC handling, campaign/review/verification boundaries, handoffs, webhook diagnostics, CLI/setup/updater/release flows, TUI projections, localization fallbacks, tests, documentation, and the bundled Horsepower Skill. Existing status enums and authoritative lifecycle stores remain intact; this change projects failures through those existing interfaces rather than introducing a competing evidence or terminal registry.
