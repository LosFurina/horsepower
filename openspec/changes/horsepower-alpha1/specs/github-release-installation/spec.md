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

### Requirement: Installer safety and platform support
The bootstrap SHALL support Linux and macOS, reject Windows, use no `sudo`, run no release lifecycle scripts, modify no shell startup files, and use `/dev/tty` for interactive setup after piped execution.

#### Scenario: No controlling terminal
- **WHEN** the bootstrap has no usable `/dev/tty` or receives `--no-setup`
- **THEN** it installs without interactive configuration and prints an exact follow-up command

### Requirement: Safe uninstall
Normal uninstall SHALL remove only verified Horsepower-owned links, `current`, and managed versions using `lstat` semantics while preserving configuration, overrides, memory, and state. Purge SHALL require explicit confirmation and `--yes` when non-interactive.

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
