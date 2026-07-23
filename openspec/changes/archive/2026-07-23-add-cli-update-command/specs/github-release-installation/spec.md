## ADDED Requirements

### Requirement: CLI-driven official release update
The CLI SHALL provide `horsepower update` as a public non-interactive command that resolves the latest release through the official `https://github.com/LosFurina/horsepower` GitHub Releases channel and, when a newer eligible version exists, performs the update in the same invocation. It SHALL also accept `--version VERSION` to select an exact official release without changing the default latest-release behavior. Release and asset requests SHALL use HTTPS, bounded redirects, timeouts, response sizes, and download sizes and SHALL reject unexpected repository, tag, asset, or content identities.

#### Scenario: A newer latest release exists
- **WHEN** the user runs `horsepower update` and the official latest-release resolution returns a newer eligible Horsepower version
- **THEN** Horsepower downloads, verifies, installs, activates, and post-validates that release before reporting `updated`

#### Scenario: Current release is latest
- **WHEN** the resolved official release version equals the active verified version
- **THEN** Horsepower performs no download or filesystem mutation and reports `already_current`

#### Scenario: Exact version is requested
- **WHEN** the user runs `horsepower update --version VERSION`
- **THEN** Horsepower resolves assets only for the exact official `vVERSION` release and applies the same verification and activation contract

#### Scenario: Latest resolution is untrusted or unavailable
- **WHEN** GitHub resolution fails, exceeds a bound, redirects outside the permitted HTTPS identity, or yields an invalid repository or tag
- **THEN** Horsepower returns a stable failed result and leaves the active installation unchanged

### Requirement: Update preserves immutable verified installation
An update candidate SHALL satisfy the existing verified release archive contract, including archive/checksum agreement, release version, asset name, exact layout, manifest, internal critical-file digests, entry points, compatibility, modes, and safe entry types, before it can enter the managed versions directory. Horsepower SHALL install only to `versions/vVERSION`, SHALL NOT overwrite or merge into any existing version directory, and SHALL preserve all prior immutable versions.

#### Scenario: Candidate is valid and new
- **WHEN** every release and compatibility check passes and `versions/vVERSION` is absent
- **THEN** Horsepower atomically moves the fully staged release into the new immutable version directory and leaves all existing versions byte-for-byte unchanged

#### Scenario: Candidate archive is invalid
- **WHEN** checksum, name, version, manifest, digest, layout, compatibility, mode, entry type, or path validation fails
- **THEN** Horsepower deletes temporary staging, creates no managed version, and leaves `current` and all owned links unchanged

#### Scenario: Version destination already exists
- **WHEN** `versions/vVERSION` already exists
- **THEN** Horsepower never overwrites it and activates it only if strict installed-release verification proves it is the exact valid requested release; otherwise the update fails closed

#### Scenario: Resolved release is older
- **WHEN** default latest resolution yields a version older than the active version
- **THEN** Horsepower refuses an implicit downgrade and leaves the installation unchanged

### Requirement: Atomic update activation and rollback
After candidate verification, Horsepower SHALL atomically switch only the managed `current` symlink, preserve whether Pi integration links were enabled or disabled before the update, preserve the stable CLI link, and run installation-only post-update verification through the newly active CLI. If activation or post-validation fails, Horsepower SHALL restore the exact prior `current` target and integration-link state and SHALL report failure without claiming the new version active.

#### Scenario: Enabled installation updates successfully
- **WHEN** extension and Skill links are valid Horsepower-owned enabled links before update and post-update validation passes
- **THEN** they continue resolving through `current` to the new release and Horsepower reports that `/reload` or Pi restart is required for running Pi processes

#### Scenario: Disabled installation updates successfully
- **WHEN** both Pi integration links are intentionally absent before update
- **THEN** the new release becomes current while both links remain absent and Horsepower does not silently enable Pi integration

#### Scenario: Post-update doctor fails
- **WHEN** the new CLI fails installation-only doctor after `current` is switched
- **THEN** Horsepower atomically restores the prior `current` target and original integration-link state and returns a stable rollback result

#### Scenario: Installation ownership is unsafe
- **WHEN** `current`, the CLI link, an integration link, managed ancestor, version destination, or expected target is conflicting, linked unexpectedly, or not verifiably Horsepower-owned
- **THEN** Horsepower rejects the update before mutating managed installation state

#### Scenario: Concurrent update is attempted
- **WHEN** another installer or updater owns the bounded update lock
- **THEN** Horsepower fails without downloading into or mutating the shared managed installation

### Requirement: Update preserves user state and avoids setup side effects
The update command SHALL preserve global and project settings, model slots, webhook credentials, memory, lifecycle state, handoffs, OpenSpec artifacts, repository files, and shell startup files. It SHALL NOT run interactive setup, alter locale, perform model or OpenSpec discovery, use `sudo`, invoke npm publishing, `pi install`, `pi update`, package lifecycle scripts, or automatically reload, restart, signal, or terminate Pi or workers.

#### Scenario: Existing configuration and retained state are present
- **WHEN** an update succeeds or fails
- **THEN** configuration and retained state outside managed code and owned activation links remain byte-for-byte unchanged

#### Scenario: Pi process is running
- **WHEN** an update activates a new release while an existing Pi process has the old extension loaded
- **THEN** Horsepower leaves that process and its workers untouched and reports that the user must run `/reload` or restart Pi

#### Scenario: Update runs without a terminal
- **WHEN** stdin is piped or no controlling terminal exists
- **THEN** update performs the same bounded non-interactive operation without prompting or entering complete configuration

### Requirement: Localized structured update outcomes
Update output SHALL use the effective `en` or `zh-CN` locale for human-facing text while keeping versions, paths, commands, statuses, error codes, digests, URLs, and JSON field names untranslated. Text and `--json` results SHALL distinguish at least `already_current`, `updated`, `failed`, and `rolled_back` and SHALL expose bounded stable current, resolved, installed, active, checksum, source, integration, and reload-required facts when available without exposing credentials or unrestricted network bodies.

#### Scenario: Chinese update succeeds
- **WHEN** effective locale is `zh-CN` and an update succeeds
- **THEN** the conclusion and remediation are Chinese while version IDs, status, digest, source, and `/reload` remain machine-stable

#### Scenario: JSON update is requested
- **WHEN** the user invokes `horsepower update --json`
- **THEN** Horsepower returns the normal bounded JSON envelope with a stable update status and verified release facts equivalent to text output

#### Scenario: Download or verification fails
- **WHEN** a network, integrity, compatibility, ownership, activation, or post-validation error occurs
- **THEN** Horsepower emits a stable error code, localized bounded explanation, and truthful rollback or unchanged-state facts without printing response bodies or secrets

### Requirement: Complete update command help
`update` SHALL be represented in the authoritative public CLI registry and top-level command index. `horsepower update --help`, `horsepower update -h`, and `horsepower help update` SHALL return equivalent command-specific help before platform checks, installation inspection, filesystem mutation, release discovery, or network activity, including localized text and stable `--json` help.

#### Scenario: Update help is requested
- **WHEN** the user invokes any supported update help form
- **THEN** Horsepower exits with status 0, shows exact update usage, purpose, options, outcomes, and examples, and performs no update side effect

#### Scenario: Top-level help is requested
- **WHEN** the authoritative command registry renders first-level commands
- **THEN** `update` appears exactly once with its localized bounded description

#### Scenario: Packaged update help is verified
- **WHEN** the deterministic release CLI is exercised
- **THEN** every supported update help form succeeds without network access or installation mutation
