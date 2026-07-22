# github-release-installation Specification

## Purpose
TBD - created by archiving change horsepower-alpha1. Update Purpose after archive.
## Requirements
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

### Requirement: Localized human-facing output configuration
Horsepower SHALL support exactly `en` and `zh-CN` output locales in Alpha 1. Project `outputLocale` SHALL override global `outputLocale`, missing configuration SHALL resolve to `en`, and unsupported values SHALL be rejected before configuration is changed.

#### Scenario: Project overrides global locale
- **WHEN** global configuration selects `zh-CN` and project configuration selects `en`
- **THEN** human-facing conclusions for that project use English while machine fields remain unchanged

#### Scenario: No locale is configured
- **WHEN** neither project nor global settings define `outputLocale`
- **THEN** Horsepower uses `en` and reports the effective locale in structured output

#### Scenario: Unsupported locale is configured
- **WHEN** setup or configure receives a locale other than `en` or `zh-CN`
- **THEN** Horsepower rejects the update transactionally with a stable untranslated error code and a localized human-readable explanation

### Requirement: Localized installation and diagnostics
Interactive installation SHALL begin with a bilingual language choice when no locale is already configured and SHALL use the selected locale for the rest of the session. Non-interactive installation SHALL accept `--locale en|zh-CN`. CLI output, errors, doctor findings/remediation, enable/disable conclusions, and webhook human-readable summaries SHALL use the effective locale, while JSON keys, enums, IDs, paths, commands, digests, artifact references, error codes, and raw evidence remain untranslated.

#### Scenario: User selects Chinese during installation
- **WHEN** the interactive user selects 简体中文
- **THEN** remaining installer prompts and completion guidance use Chinese and global settings persist `outputLocale: "zh-CN"`

#### Scenario: Installer has no terminal or locale flag
- **WHEN** no prior locale exists, `/dev/tty` is unavailable, and `--locale` is omitted
- **THEN** installation uses English and prints the exact command for configuring `zh-CN` later

#### Scenario: Chinese webhook is emitted
- **WHEN** a terminal event resolves `outputLocale` to `zh-CN`
- **THEN** its human-readable `summary` is Chinese while event type, status, identifiers, and evidence references remain stable

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

### Requirement: Pre-activation Skill exposure warning
After staged release verification and before mutating managed versions, `current`, links, or settings, installation SHALL run the staged Horsepower static Skill audit for the invocation's original working directory. It SHALL exclude only verified Horsepower and official OpenSpec Skills and SHALL disclose all other enabled Skills or audit uncertainty without modifying user resources.

#### Scenario: Interactive installation finds external Skills
- **WHEN** audit finds at least one external Skill and a controlling terminal is available
- **THEN** the installer lists bounded metadata, explains that workers use `--no-skills` while the main Captain can still be influenced, and continues only after explicit `y`, `Y`, or `yes` confirmation with No as the default

#### Scenario: Interactive audit is incomplete
- **WHEN** audit status is `partial` or `failed` in an interactive installation
- **THEN** the installer discloses the uncertainty and requires the same explicit confirmation even if no candidate was found

#### Scenario: Non-interactive installation has exposure or uncertainty
- **WHEN** no controlling terminal is available or `--no-setup` is supplied and audit finds external Skills or is not complete
- **THEN** the installer writes a localized warning to stderr and continues without changing Pi Skill configuration

#### Scenario: User declines warning
- **WHEN** an interactive user gives empty or non-affirmative confirmation
- **THEN** installation stops before activation and leaves any existing Horsepower installation, settings, and Pi integration links unchanged

### Requirement: Installer candidate scan advice
Installer warnings SHALL state that the audit covers global and current-working-directory context, does not enumerate extension-contributed Skills, and cannot predict future projects. They SHALL offer but not execute the documented `$HOME` candidate scan command.

#### Scenario: Warning is displayed
- **WHEN** installation reports Skill exposure or audit limitations
- **THEN** the user receives portable Linux/macOS candidate-scan guidance that distinguishes files found from Skills actually enabled by Pi

### Requirement: Guided model-slot installation setup
After verified activation and Skill exposure handling, interactive installation SHALL offer guided setup for the required `judgment`, `craft`, and `utility` model slots. The guide SHALL use the current Pi model catalog without probing the upstream provider, and SHALL allow choosing a model and thinking level or canceling without partial model-slot writes.

#### Scenario: Interactive user configures required slots
- **WHEN** a controlling terminal is available and the user chooses guided model setup
- **THEN** the installer guides all three required slots and atomically saves the locally validated bindings

#### Scenario: Setup performs no upstream probe
- **WHEN** the user selects a Pi-visible model and thinking value
- **THEN** the guide proceeds to the next slot without making a provider request or showing probe remediation choices

#### Scenario: Setup is skipped
- **WHEN** the user skips guided setup, `--no-setup` is supplied, or no controlling terminal is available
- **THEN** installation preserves existing slot configuration and prints the exact `horsepower setup --interactive` follow-up command

#### Scenario: Guided configuration fails after activation
- **WHEN** guided setup is canceled or cannot validate all required slots after Horsepower code activation succeeded
- **THEN** the installed code remains valid, previous slot configuration remains byte-for-byte unchanged, and output distinguishes installation success from incomplete model setup
