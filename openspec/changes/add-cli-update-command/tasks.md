## 1. RED Updater Trust-Boundary Contracts

- [ ] 1.1 Add failing typed-service tests for official latest and exact-version resolution, strict SemVer/alpha comparison, equal-version no-op, implicit downgrade rejection, HTTPS identity, redirect, timeout, and response/download bounds.
- [ ] 1.2 Add failing tests for checksum/archive/manifest/digest/layout/compatibility/mode/path/entry validation and prove invalid candidates create no managed version or activation mutation.
- [ ] 1.3 Add failing temporary-HOME tests for owned enabled/disabled installations, unsafe ancestors/links, existing valid and conflicting version destinations, exclusive lock contention, and byte-preservation of settings/state/handoffs.
- [ ] 1.4 Add failing activation tests for atomic `current` switching, new-CLI installation-only doctor, rollback/restoration failure evidence, live-process non-interference, and exact integration-link state preservation.

## 2. Release Discovery and Verification

- [ ] 2.1 Implement an injected bounded official-release transport with HTTPS/repository/tag/asset allowlisting, redirect and timeout limits, response/download byte caps, and redacted stable failures.
- [ ] 2.2 Implement strict Horsepower SemVer parsing/comparison and candidate selection for latest and `--version`, returning `already_current` before asset download and rejecting implicit downgrade.
- [ ] 2.3 Extract or expose reusable checksum, safe archive, exact layout, release manifest/digest, compatibility, installed-tree, and entry-point verification primitives shared with current release/install contracts.
- [ ] 2.4 Stage candidates in a private temporary root, run bounded staged preflight, and atomically place only fully verified absent versions without overwriting any existing directory.

## 3. Transactional Activation

- [ ] 3.1 Implement no-follow managed-root ownership checks and an exclusive bounded installation mutation lock before download/shared mutation.
- [ ] 3.2 Snapshot verified `current`, CLI, extension, and Skill link state; preserve enabled versus disabled integration and reject partial/conflicting installations without repair.
- [ ] 3.3 Atomically activate the candidate through `current`, run the newly active CLI's installation-only doctor with a bounded environment/timeout, and restore and verify the prior target/state on failure.
- [ ] 3.4 Ensure success and every failure path clean temporary resources, preserve prior immutable versions and all user state, avoid setup/package-manager/process side effects, and report whether the candidate is installed versus active.

## 4. CLI, Help, Localization, and Docs

- [ ] 4.1 Register public `update` execution with `--version`, `--locale`, and `--json`, stable `already_current|updated|failed|rolled_back` data, localized `en`/`zh-CN` conclusions, and reload-required guidance.
- [ ] 4.2 Integrate `update` into the authoritative recursive help registry from `support-help-for-every-cli-command`, including top-level discovery, all help forms, JSON parity, bounds, and proof that help constructs no updater/network/filesystem adapter.
- [ ] 4.3 Add CLI tests for text/JSON success, no-op, network/integrity/compatibility/ownership/rollback failures, unsupported platform action versus platform-independent help, and untranslated machine facts.
- [ ] 4.4 Update English and Chinese documentation for default latest update, exact version selection, already-current behavior, verification/rollback, enabled/disabled integration, `/reload`, non-interactive operation, and the separate fresh-install `install.sh` boundary.

## 5. Packaged E2E and Release Acceptance

- [ ] 5.1 Add packaged CLI E2E with a local injected release fixture covering successful prior-alpha-to-new-alpha update, already-current without asset request, disabled integration, corrupted candidate, post-doctor rollback, help without network, and unchanged retained state.
- [ ] 5.2 Run focused CLI/update/release/install/localization tests, strict OpenSpec validation, CI-version `npm ci`, typecheck, full unit/E2E suites, deterministic release/privacy checks, `npm run check`, and `git diff --check`.
- [ ] 5.3 Build and install a new immutable alpha release, smoke localized text/JSON/help/failure/no-op paths, publish only through the existing immutable GitHub release process, then update from the prior alpha using `horsepower update` and submit fresh claim-matched terminal evidence.
