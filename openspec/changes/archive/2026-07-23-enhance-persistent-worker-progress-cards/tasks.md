## 1. Persistent Non-Blocking Lifecycle

- [x] 1.1 Add failing persistent-manager and orchestration tests using controlled unresolved initial/follow-up turns to prove persistent `create`, `send(wait: false)`, and `steer(wait: false)` return stable worker/message identity without invoking completion waiters, while Captain work and `status`/`read` continue.
- [x] 1.2 Add failing tests proving one worker ID and conversation survive multiple terminal messages and idle periods until explicit `destroy`, including fast-completion races, timeout-with-continuation, abort-with-preservation, and process cleanup.
- [x] 1.3 Add a controlled slow one-shot test that cancels the public wait as if the human pressed `Esc` and proves structured canceled run/invocation identity, bounded child termination, absent-report rejection, first-terminal-wins race behavior, and no hidden active orphan.
- [x] 1.4 Implement non-blocking create/message acknowledgement, stable per-message status/result projection, and orphan-free human cancellation without changing queued delivery, managed handoff, abort, destroy, or terminal semantics.

## 2. Normalized Progress Telemetry

- [x] 2.1 Add failing one-shot runner and persistent RPC event tests for injected monotonic elapsed time, authoritative per-message input/output aggregation, reset on follow-up, latest completed assistant utterance replacement, and absent-field behavior.
- [x] 2.2 Add failing privacy and bounds tests proving credential/path/control-character redaction, UTF-8-safe latest-utterance truncation, reasoning/partial-delta/prompt/provider/tool/report exclusion, and aggregate event/byte-limit enforcement.
- [x] 2.3 Implement shared bounded progress telemetry types and normalization for one-shot and persistent execution, preserving exact worker identity and terminal truth when collection or callbacks fail.

## 3. Operation Cards and Captain Interface

- [x] 3.1 Add failing extension unit/E2E tests for stable one-shot and persistent cards displaying formatted elapsed time, aggregate input/output tokens, latest privacy-safe utterance, and truthful omission of unavailable telemetry.
- [x] 3.2 Implement operation-card rendering and structured progress details without exposing raw events, full prompts/reports, credentials, private handoff paths, or complete transcripts.
- [x] 3.3 Update bundled Horsepower Skill guidance and English/Chinese documentation for asynchronous persistent reuse, observation via status/read, explicit destroy, telemetry meaning, and privacy limits.

## 4. Verification and Release

- [x] 4.1 Run focused persistent-manager, one-shot runner, orchestration, extension/runtime, progress privacy, handoff, and real Pi E2E tests, fixing only defects within this change scope.
- [x] 4.2 Run strict OpenSpec validation, CI-version `npm ci`, typecheck, full unit/E2E suites, deterministic build/release privacy scans, `npm run check`, and `git diff --check`.
- [x] 4.3 Build and install a new immutable release; manually verify a slow `send(wait: false)` permits concurrent Captain work, the same worker handles a later follow-up, cards show elapsed/input/output/latest-safe-message telemetry, and explicit destroy removes the worker without orphaning managed handoffs.
