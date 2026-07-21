## ADDED Requirements

### Requirement: GitHub-only distribution
Horsepower SHALL be distributed through `LosFurina/horsepower` GitHub Releases and a repository-owned curl bootstrap. The Node project SHALL be non-publishable, and Horsepower SHALL NOT invoke npm publishing, `pi install`, `pi update`, or Pi Package Gallery installation.

#### Scenario: User runs bootstrap
- **WHEN** the official `install.sh` is executed
- **THEN** it downloads and verifies a Horsepower GitHub Release without using Pi's package manager

### Requirement: Verified release archive
Each release SHALL provide `horsepower-v<version>.tar.gz` and its SHA-256 asset. Activation SHALL require agreement among release version, archive name, checksum, manifest, internal critical-file digests, and expected layout.

#### Scenario: Valid release
- **WHEN** checksum, manifest, internal digests, and layout all match
- **THEN** the staged release is eligible for activation

#### Scenario: Unsafe archive
- **WHEN** an archive contains absolute paths, traversal, unexpected roots, or unsafe links
- **THEN** installation rejects it before extraction or activation

### Requirement: Stable symlink installation
Horsepower SHALL keep immutable release directories, atomically point `current` at one release, and create stable extension, skill, and CLI symlinks through `current`. It SHALL never fall back to copying resources.

#### Scenario: Fresh installation
- **WHEN** target paths are absent
- **THEN** Horsepower creates verified links at `~/.pi/agent/extensions/horsepower`, `~/.pi/agent/skills/horsepower`, and `~/.local/bin/horsepower`

#### Scenario: Conflicting path
- **WHEN** a target is a regular file, directory, or unrelated symlink
- **THEN** installation reports the conflict and leaves it untouched

#### Scenario: Activation fails
- **WHEN** post-install doctor fails
- **THEN** the installer restores the prior `current` target and removes only links created by that run

### Requirement: Reversible Pi integration links
The CLI SHALL support idempotent `enable` and `disable` operations for the Horsepower Pi extension and skill links. These operations SHALL preserve the CLI link, `current`, immutable versions, configuration, memory, state, handoffs, and project overrides.

#### Scenario: User disables Horsepower
- **WHEN** both Pi integration links are verified Horsepower-owned or absent
- **THEN** `horsepower disable` atomically removes only the owned extension and skill links and reports that `/reload` or Pi restart is required

#### Scenario: User enables Horsepower
- **WHEN** `current`, its manifest, compatibility, entry points, digests, target parents, and link destinations are valid
- **THEN** `horsepower enable` atomically creates the extension and skill links through `current` without changing the CLI link

#### Scenario: Enable or disable sees a conflict
- **WHEN** either target is a regular file, directory, unrelated link, or beneath an untrusted linked parent
- **THEN** the operation refuses all changes and leaves both targets untouched

#### Scenario: Link mutation partially fails
- **WHEN** enable or disable changes one owned link and a later link operation fails
- **THEN** Horsepower restores the link state that existed before that invocation

#### Scenario: Existing Pi process remains active
- **WHEN** the user disables Horsepower while a Pi process already has the extension loaded
- **THEN** Horsepower does not use IPC or a daemon to stop workers and documents that the change takes effect after `/reload` or restart

### Requirement: Pi integration status diagnostics
Doctor SHALL distinguish `enabled`, `disabled`, `partially_enabled`, and `conflict` from verified extension and skill link state without treating an intentionally absent Pi link as an installation failure.

#### Scenario: Both Pi links are absent
- **WHEN** the CLI link and active release remain valid but extension and skill links are absent
- **THEN** doctor reports `disabled` and recommends `horsepower enable`

### Requirement: Installer safety and platform support
The bootstrap SHALL support Linux and macOS, reject Windows, use no `sudo`, run no release lifecycle scripts, modify no shell startup files, and use `/dev/tty` for interactive setup after piped execution.

#### Scenario: No controlling terminal
- **WHEN** the bootstrap has no usable `/dev/tty` or receives `--no-setup`
- **THEN** it installs without interactive configuration and prints an exact follow-up command

### Requirement: Safe uninstall
Normal uninstall SHALL remove only verified Horsepower-owned links, `current`, and managed versions using `lstat` semantics while preserving configuration, overrides, memory, state, and handoffs. Purge SHALL require explicit confirmation and `--yes` when non-interactive and SHALL remove retained handoffs only after managed code and links are absent.

#### Scenario: Normal uninstall
- **WHEN** the user runs `horsepower uninstall`
- **THEN** managed code and links are removed without following symlink targets and user data remains

#### Scenario: Unexpected uninstall target
- **WHEN** an expected link was replaced by another object
- **THEN** Horsepower refuses to delete it and reports the path

### Requirement: Release privacy gate
Public repository and release contents SHALL contain no private agents, provider mappings, concrete private models, credentials, API keys, machine paths, or history artifacts.

#### Scenario: Forbidden data detected
- **WHEN** release scanning finds a forbidden secret or private path pattern
- **THEN** release construction fails before publication

### Requirement: Optional webhook setup
Interactive installation SHALL offer optional webhook configuration and SHALL allow the user to skip it. Configuration SHALL support change notifications enabled by default, dispatch notifications disabled by default, and authentication modes `hmac`, `bearer`, and `none` with HMAC recommended.

#### Scenario: User skips webhook
- **WHEN** the user leaves webhook setup empty or selects skip
- **THEN** installation completes with notifications disabled

#### Scenario: User configures HMAC
- **WHEN** the user provides a URL, selects `hmac`, and provides a secret
- **THEN** setup writes the secret only to mode-`0600` Horsepower configuration and diagnostics redact it

#### Scenario: User configures Bearer authentication
- **WHEN** the user provides a URL, selects `bearer`, and provides a token
- **THEN** webhook requests use the Authorization header and no diagnostic prints the token

### Requirement: Redacted non-blocking webhook delivery
Terminal webhook payloads SHALL contain event ID, timestamp, scope, run/change identifiers, terminal status, and bounded redacted summary/evidence references. They SHALL NOT contain prompts, model output, API keys, authentication values, or full command output. Delivery SHALL use bounded exponential retries only within the current Pi process and SHALL never change the original terminal status.

#### Scenario: HMAC notification
- **WHEN** a terminal event uses HMAC authentication
- **THEN** the request includes an event ID, timestamp, and HMAC-SHA256 signature over the canonical request body

#### Scenario: Receiver remains unavailable
- **WHEN** all configured in-process delivery attempts fail
- **THEN** Horsepower records redacted notification failure for current-process status/doctor output and preserves the original terminal status

#### Scenario: Pi process exits during retry
- **WHEN** the host process exits before a retry completes
- **THEN** Horsepower does not persist or resume the notification and documentation states this limitation
