## 1. Worker Skill Isolation

- [ ] 1.1 Add failing launch-contract tests proving persistent and one-shot workers require exactly one `--no-skills`, pass no implicit `--skill`, and preserve explicit prompts, tools, models, and thinking.
- [ ] 1.2 Add `--no-skills` to persistent RPC and one-shot JSON launch construction and make the focused launch tests pass.
- [ ] 1.3 Add a real Pi E2E leakage fixture whose discovered Skill demands a sentinel response, and prove one-shot and persistent Horsepower workers never observe the sentinel instruction.

## 2. Shared OpenSpec Compatibility

- [ ] 2.1 Add failing table-driven tests for strict stable semver acceptance of `>=1.6.0 <2.0.0`, including missing, command-failure, unparseable, prerelease, lower-bound, upper-bound, and build-metadata cases.
- [ ] 2.2 Introduce one source compatibility module and update runtime OpenSpec validation, doctor/preflight, release manifest generation/validation, and localized diagnostics to use it.
- [ ] 2.3 Tighten the pre-download installer bootstrap check and add release tests proving its declared range cannot drift from source and manifest compatibility.

## 3. Safe Skill Exposure Audit

- [ ] 3.1 Add failing audit tests for Pi static resolution, enabled-resource filtering, missing-package skip behavior, dynamic-extension limitation disclosure, and zero side effects.
- [ ] 3.2 Implement a static audit adapter using Pi 0.80.10 `SettingsManager` and `DefaultPackageManager.resolve()` without loading extensions, models, Skill scripts, or missing packages.
- [ ] 3.3 Add failing provenance tests for digest-owned Horsepower exclusion, verified official OpenSpec exclusion, same-name lookalikes, stale integration, unreadable resources, and duplicate/collision handling.
- [ ] 3.4 Implement metadata parsing, provenance filters, bounded result normalization, folded human paths, and `complete`/`partial`/`failed` outcomes.
- [ ] 3.5 Add safe standard-location fallback scanning and the non-executed portable `$HOME` candidate-scan guidance, with tests that incomplete zero results never claim safety.

## 4. CLI and Localization

- [ ] 4.1 Add failing CLI contract tests for `horsepower skill-audit`, `--json`, option validation, no-OpenSpec-change observation semantics, both locales, stable machine fields, and non-persistence.
- [ ] 4.2 Wire `skill-audit` into the CLI and add English and `zh-CN` messages for exposure, uncertainty, limitations, and candidate-scan advice without translating paths, IDs, status, source, or evidence fields.
- [ ] 4.3 Extend doctor output to report OpenSpec range incompatibility consistently while keeping Skill exposure audit opt-in outside installation.

## 5. Installer Warning Gate

- [ ] 5.1 Add failing installer integration tests proving audit runs after staged preflight but before activation, interactive exposure/uncertainty defaults to No, affirmative input continues, and refusal preserves prior topology and settings exactly.
- [ ] 5.2 Integrate staged `skill-audit` output into `install.sh`, excluding verified Horsepower/OpenSpec resources and rendering bounded localized warnings plus candidate-scan advice.
- [ ] 5.3 Add non-interactive tests proving `--no-setup` or absent TTY warns on stderr and continues, while compatible complete/no-exposure installation does not add a confirmation prompt.
- [ ] 5.4 Add hostile and degraded audit tests for missing packages, malformed metadata, resolver failure, fallback failure, private-path folding, and confirmation input variants.

## 6. Documentation and Acceptance

- [ ] 6.1 Update English and Chinese documentation and the bundled Horsepower Skill to state the exact boundary: workers always use `--no-skills`; the main Captain remains user-controlled and only audited/warned.
- [ ] 6.2 Update deterministic release fixtures, privacy scanning, manifest expectations, archive tests, installer release fixtures, and version references for the new compatibility and CLI behavior.
- [ ] 6.3 Run focused tests, full unit/integration tests, mandatory E2E, typecheck, build, deterministic release/privacy scan, `openspec validate --all --strict`, and `git diff --check`; record Captain-selected E2E evidence or an explicit waiver before completion.
