## 1. RED Command-Output Contracts

- [x] 1.1 Add failing extension-handler tests proving `/horsepower-workers` invokes only safe `list`, appends exactly one durable TUI-only entry on success, does not call `sendMessage`, and never creates or advances worker state.
- [x] 1.2 Add failing tests for explicit empty output, one and eight workers, deterministic ordering, complete identity/message/status projection, omission of unavailable telemetry, and clear persistent-versus-one-shot explanation.
- [x] 1.3 Add failing `en`/`zh-CN`, UTF-8/aggregate bound, control-character, credential/private-path, prompt/report/raw-event exclusion, and expanded/collapsed renderer tests.
- [x] 1.4 Add failing runtime-list, locale, append-entry, and renderer failure tests proving visible bounded fallback, no silent success, no recursive append/retry, and unchanged worker truth.

## 2. Safe Presentation and Renderer

- [x] 2.1 Define an allowlisted bounded worker-list presentation DTO for at most eight current persistent workers, including stable identity, status, current message/queue facts, and eligible telemetry only.
- [x] 2.2 Implement deterministic privacy-safe projection and localized empty/scope/failure text while preserving untranslated IDs, statuses, slots, models, thinking values, modes, and commands.
- [x] 2.3 Register a `horsepower-worker-list` custom entry renderer with compact and expanded durable views plus a minimal safe fallback that performs no runtime query or mutation.
- [x] 2.4 Change `/horsepower-workers` success from transient notification-only output to `pi.appendEntry` of the bounded snapshot, using notification solely for explicit failure fallback.

## 3. Mode and Regression Coverage

- [x] 3.1 Preserve and test the structured `horsepower_subagent action=list` contract independently of TUI rendering, including truthful empty and populated persistent-worker lists.
- [x] 3.2 Add regression tests proving terminal `single`, `parallel`, and `chain` children never appear as persistent workers and an empty list does not imply no one-shot execution occurred.
- [x] 3.3 Add real Pi E2E for the supported command path and durable custom entry/rendered output after subsequent TUI renders; retain RPC command discovery and explicit non-TUI behavior.

## 4. Documentation and Acceptance

- [x] 4.1 Update bundled Horsepower Skill guidance and English/Chinese documentation for `/horsepower-workers`, durable output, empty state, current-process lifetime, one-shot exclusion, telemetry bounds, privacy, and failure behavior.
- [x] 4.2 Run focused extension/persistent-manager/orchestration/localization tests, strict OpenSpec validation, typecheck, full unit/E2E suites, deterministic release/privacy checks, `npm run check`, and `git diff --check`.
- [x] 4.3 Build and install a new immutable alpha release, manually verify empty and populated Chinese/English `/horsepower-workers` output remains visible across later renders and excludes completed parallel children, then submit fresh claim-matched terminal evidence.
