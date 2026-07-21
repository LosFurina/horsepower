## 1. Model Catalog and Exact Capability Evidence

- [ ] 1.1 Add failing tests for current Pi model discovery, stable non-secret catalog revisions, empty/unavailable catalogs, and the rule that `reasoning: true` does not imply every thinking level.
- [ ] 1.2 Implement the model-catalog adapter and replace boolean reasoning expansion with exact declared-or-unverified capability data.
- [ ] 1.3 Add failing tests for process-local positive evidence keyed by provider/model, thinking, and catalog revision, including ten-minute expiry, revision mismatch, and explicit invalidation.
- [ ] 1.4 Implement the bounded in-memory capability evidence cache without persistence, webhook, handoff, or telemetry output.

## 2. Live Probe and Conservative Classification

- [ ] 2.1 Add failing table-driven tests for `supported`, explicit `unsupported`, and `inconclusive` outcomes covering authentication, authorization, quota, rate limit, timeout, transport, service, malformed response, and unknown failures.
- [ ] 2.2 Implement a provider-neutral capability probe contract and conservative classifier that never derives positive support from failure text.
- [ ] 2.3 Add failing launch-contract tests proving the production Pi probe uses the exact model/thinking pair, fixed minimal prompt, bounded output, `--no-session`, `--no-skills`, `--no-tools`, and no shell.
- [ ] 2.4 Implement the Pi probe adapter with redacted bounded evidence and immediate abort/cleanup semantics.

## 3. Transactional CLI Setup

- [ ] 3.1 Add failing CLI tests for `horsepower setup --interactive`, current model listing, all three required slots, retry/reselect/skip/cancel behavior, and localized `en`/`zh-CN` conclusions.
- [ ] 3.2 Implement guided setup using injected terminal and catalog/probe adapters so each selected combination is verified without probing every model/level pair.
- [ ] 3.3 Add failing non-interactive tests proving explicit setup validates all required combinations and preserves prior model-slot bytes when any result is unsupported, inconclusive, canceled, or the write fails.
- [ ] 3.4 Make guided and explicit setup share one validate-all-then-atomically-commit transaction and stable machine error/status fields.

## 4. Pre-launch Runtime Gate

- [ ] 4.1 Add failing one-shot and persistent tests proving capability validation occurs after slot resolution but before run, handoff, temporary prompt, or child-process side effects.
- [ ] 4.2 Wire one shared capability gate into one-shot and persistent worker creation, reusing only fresh matching evidence and reprobeing missing, stale, or invalidated combinations.
- [ ] 4.3 Add tests and implementation for actual worker capability rejection: invalidate matching evidence, preserve configured bindings, create no automatic retry with lower thinking or another model, and return bounded remediation.

## 5. Installer, Doctor, and Localization

- [ ] 5.1 Add failing installer tests for optional guided setup after activation and Skill warning handling, successful configuration, skip, no TTY, `--no-setup`, probe failure, cancel, and byte-for-byte preservation of prior slot configuration.
- [ ] 5.2 Integrate the guided setup prompt into `install.sh`, distinguish installation success from incomplete model setup, and print the exact `horsepower setup --interactive` follow-up command.
- [ ] 5.3 Update doctor and `en`/`zh-CN` messages to report catalog unavailable, capability unverified, unsupported, inconclusive, stale, and reconfiguration actions without translating IDs or raw evidence.

## 6. Acceptance and Documentation

- [ ] 6.1 Build a deterministic local Pi/provider fixture that accepts selected thinking values and explicitly rejects others without real credentials, private provider names, paid APIs, or network access.
- [ ] 6.2 Add mandatory E2E for interactive setup and both worker modes, proving fresh validation, TTL reuse, stale reprobe, explicit rejection invalidation, and no silent downgrade.
- [ ] 6.3 Update English and Chinese documentation, bundled Horsepower Skill guidance, deterministic release fixtures, privacy scanning, and manifest/archive expectations.
- [ ] 6.4 Run focused tests, full unit/integration tests, mandatory E2E, typecheck, build, deterministic release/privacy scan, `openspec validate --all --strict`, and `git diff --check`; record Captain-selected E2E evidence or an explicit waiver before completion.
