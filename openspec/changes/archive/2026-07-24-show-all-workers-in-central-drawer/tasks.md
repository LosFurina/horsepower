## 1. Shared Worker Card Contract

- [x] 1.1 Define a bounded private `WorkerCardModel` covering common one-shot and persistent identity, lifecycle, operation, slot/model/thinking, telemetry, polling, stall, and failure fields.
- [x] 1.2 Extract shared localized labels, safe projection utilities, status color semantics, and ANSI/Unicode width-aware card rendering from parallel-card and worker-list implementations.
- [x] 1.3 Migrate parallel Agent Cards to the shared renderer without changing canonical ordering, operation-vs-dispatch status, terminal truth, or bounded progress behavior.
- [x] 1.4 Add parity tests proving equivalent common fields render consistently in compact parallel and detailed drawer contexts.

## 2. Unified Observational Inventory

- [x] 2.1 Add a bounded process-local active one-shot observational registry keyed by stable invocation identity and populated only from canonical admission/progress events.
- [x] 2.2 Remove associated one-shot entries after authoritative single, parallel, or chain tool settlement, including failed and canceled settlement, without deriving terminal authority from the registry.
- [x] 2.3 Adapt `PersistentWorkerManager.list()` workers to shared cards while retaining running, idle, failed, and canceled workers according to current destroy/process-cleanup semantics.
- [x] 2.4 Combine one-shot and persistent projections in deterministic order with item/field/aggregate byte bounds and strict privacy redaction.

## 3. Centered Worker Drawer

- [x] 3.1 Implement a fresh read-only `ctx.ui.custom()` overlay component centered with responsive width, minimum width, maximum height, and margins.
- [x] 3.2 Render shared worker cards in a line-aware scroll viewport with worker/position hints, arrow and page navigation, `r` refresh, and Escape/`q` close.
- [x] 3.3 Add presentation-only derived-time refresh for progress age and next poll, material snapshot deduplication, and idempotent timer cleanup on close/disposal.
- [x] 3.4 Make `/horsepower-workers` open the drawer in TUI mode, visibly show zero-worker state, and expose no user send/steer/abort/destroy/retry controls.
- [x] 3.5 Preserve bounded unified inventory output and explicit no-overlay messaging for RPC, JSON, and print modes, with localized render/append/custom-UI failure fallback.

## 4. Lifecycle, Privacy, and Access Boundaries

- [x] 4.1 Verify drawer refresh and open/close do not block persistent `status`, `read`, Captain `send`/`steer`, worker settlement, or one-shot progress.
- [x] 4.2 Ensure only Captain Horsepower tool paths communicate with subagents in Pi and drawer keyboard handling cannot mutate worker state.
- [x] 4.3 Clear one-shot observational state and drawer timers on settlement, session replacement, reload, quit, and process cleanup without destroying persistent workers.
- [x] 4.4 Add tests for prompts, reasoning, provider payloads, raw tool output, credentials, reports, and private paths never entering models, drawer output, or fallback output.

## 5. Update Summary Regression

- [x] 5.1 Retain the CLI fix that prefers dynamic `CommandResult.summaryVariables` over static command-definition variables.
- [x] 5.2 Add focused update success and already-current text/JSON tests proving actual release identity is shown and `undefined` never appears.

## 6. Verification and Release Safety

- [x] 6.1 Add unit tests for shared cards, inventory lifecycle, deterministic ordering, drawer scrolling/keys/refresh/cleanup, empty state, responsive widths, localization, and mode fallbacks.
- [x] 6.2 Add official Pi TUI or closest feasible production-path E2E that opens `/horsepower-workers`, shows active one-shot plus running/idle persistent cards, closes safely, and does not expose worker mutation controls; document manual acceptance where terminal input capture is unavailable.
- [x] 6.3 Run typecheck, build, focused/full tests justified by changed scope, strict OpenSpec validation, git diff checks, and clean release privacy/manifest scans before immutable release.
