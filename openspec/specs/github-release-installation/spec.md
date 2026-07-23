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
The bootstrap SHALL support Linux and macOS, reject Windows, use no `sudo`, run no release lifecycle scripts, modify no shell startup files, and use `/dev/tty` for interactive configuration after piped execution. `--no-setup` SHALL unambiguously disable interactive configuration without disabling verified installation, observation-only audit, or localized follow-up guidance.

#### Scenario: No controlling terminal
- **WHEN** the bootstrap has no usable `/dev/tty` or receives `--no-setup`
- **THEN** it installs without interactive configuration and prints `horsepower configure --interactive` as the exact complete-configuration follow-up command

#### Scenario: Interactive terminal is available
- **WHEN** the bootstrap has a usable `/dev/tty` and does not receive `--no-setup`
- **THEN** it performs the pre-activation Skill gate and, after verified activation, starts the complete configuration journey

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
Interactive installation SHALL begin with a bilingual language choice when no locale is already configured and SHALL use the selected locale for the rest of the installer and complete configuration journey. Non-interactive installation SHALL accept `--locale en|zh-CN`. CLI prompts, output, errors, doctor findings/remediation, enable/disable conclusions, and webhook human-readable summaries SHALL use the effective locale, while JSON keys, enums, IDs, paths, commands, digests, artifact references, model IDs, thinking IDs, error codes, and raw evidence remain untranslated.

#### Scenario: User selects Chinese during installation
- **WHEN** the interactive user selects 简体中文
- **THEN** remaining installer, Skill guidance, webhook, model-selection, capability-action, cancellation, and completion prompts use Chinese and global settings persist `outputLocale: "zh-CN"`

#### Scenario: Installer has no terminal or locale flag
- **WHEN** no prior locale exists, `/dev/tty` is unavailable, and `--locale` is omitted
- **THEN** installation uses English and prints the exact commands for complete interactive configuration and later Chinese configuration

#### Scenario: Chinese webhook is emitted
- **WHEN** a terminal event resolves `outputLocale` to `zh-CN`
- **THEN** its human-readable `summary` is Chinese while event type, status, identifiers, and evidence references remain stable

### Requirement: Optional webhook setup
The complete interactive configuration journey invoked directly or by interactive installation SHALL offer optional webhook configuration and SHALL allow the user to preserve existing settings, disable notifications, or configure them. New configuration SHALL explicitly select `generic` or `discord`; SHALL support change notifications enabled by default and dispatch notifications disabled by default; and SHALL permit only authentication modes compatible with the selected provider. Existing configuration without a provider SHALL remain effective as `generic` until the user explicitly reconfigures it.

#### Scenario: User skips webhook
- **WHEN** no webhook exists and the user selects skip, or an existing webhook exists and the user selects preserve
- **THEN** complete configuration leaves the effective webhook state unchanged and reports that outcome

#### Scenario: User disables webhook
- **WHEN** the user explicitly selects disable
- **THEN** complete configuration uses the existing credential-removing disable transaction and reports notifications disabled

#### Scenario: User configures generic HMAC
- **WHEN** the user selects `generic`, provides a URL, selects `hmac`, and provides a secret
- **THEN** configuration writes the provider and secret only to mode-`0600` Horsepower configuration and diagnostics redact the URL and secret

#### Scenario: User configures generic Bearer authentication
- **WHEN** the user selects `generic`, provides a URL, selects `bearer`, and provides a token
- **THEN** webhook requests use the Authorization header and no prompt, diagnostic, summary, or delivery result prints the URL or token

#### Scenario: User configures Discord
- **WHEN** the user selects `discord` and supplies compatible URL and authentication settings
- **THEN** Horsepower validates the complete prospective provider configuration and persists it transactionally

#### Scenario: Provider and authentication are incompatible
- **WHEN** the user selects a provider/authentication combination that its adapter does not support
- **THEN** Horsepower rejects the update before writing settings and gives bounded localized remediation

### Requirement: Redacted non-blocking webhook delivery
Terminal webhook processing SHALL first create a canonical event containing event ID, timestamp, scope, opaque run/change identifiers, terminal status, and bounded redacted summary/evidence references. Generic delivery SHALL serialize that canonical event; Discord delivery SHALL adapt only that event into a provider-native bounded envelope. No delivery SHALL contain prompts, model output, reports, private paths, API keys, authentication values, or full command output. Delivery SHALL use bounded retries only within the current Pi process and SHALL never change the original terminal status.

#### Scenario: Generic HMAC notification
- **WHEN** a terminal event uses the generic provider with HMAC authentication
- **THEN** the request includes an event ID, timestamp, and HMAC-SHA256 signature over the canonical request body

#### Scenario: Provider-native notification
- **WHEN** a terminal event uses the Discord provider
- **THEN** Horsepower renders a valid Discord envelope from the canonical event without exposing additional lifecycle or private data

#### Scenario: Receiver remains unavailable
- **WHEN** all configured in-process delivery attempts fail
- **THEN** Horsepower records redacted notification failure for current-process status output and preserves the original terminal status

#### Scenario: Pi process exits during retry
- **WHEN** the host process exits before a retry completes
- **THEN** Horsepower does not persist or resume the notification and documentation states this limitation

#### Scenario: User explicitly tests delivery
- **WHEN** the user invokes the webhook test operation
- **THEN** Horsepower uses the effective production provider path and reports bounded success or failure without exposing the URL, credential, signature, or raw receiver body

#### Scenario: Doctor runs without a delivery probe
- **WHEN** doctor examines a syntactically valid enabled webhook
- **THEN** it reports static provider configuration health without making an outbound request or claiming receiver acceptance

### Requirement: Pre-activation Skill exposure warning
After staged release verification and before mutating managed versions, `current`, links, or settings, installation SHALL run the staged Horsepower static Skill audit for the invocation's original working directory. Interactive installation SHALL always explain the worker/main-Captain external Skill boundary; it SHALL additionally disclose all enabled external Skills or audit uncertainty and gate activation when such exposure or uncertainty exists, without modifying user resources.

#### Scenario: Interactive installation audit is clean
- **WHEN** audit is complete with no external Skill and a controlling terminal is available
- **THEN** the installer explains that external Skills such as Superpowers remain user-managed, the main Captain follows normal Pi discovery, and Horsepower workers use `--no-skills`, then continues without an exposure confirmation gate

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
After verified activation and Skill exposure handling, interactive installation SHALL enter the complete configuration journey and offer guided setup for the required `judgment`, `craft`, and `utility` model slots. The model section SHALL use the current Pi model catalog and live selected-combination validation, and SHALL allow retrying, choosing another model or thinking level, skipping setup for the documented model-only follow-up command, or canceling without partial model-slot writes.

#### Scenario: Interactive user configures required slots
- **WHEN** a controlling terminal is available and the user chooses guided model setup during complete configuration
- **THEN** the installer guides all three required slots in the effective locale and completes that section only after their exact combinations are currently verified and atomically saved

#### Scenario: Setup performs no upstream probe
- **WHEN** the user selects a Pi-visible model and thinking value
- **THEN** Horsepower relies on the current Pi catalog and process-local capability evidence without making its own upstream provider request

#### Scenario: Probe is unsupported or inconclusive
- **WHEN** a selected combination is rejected or cannot be conclusively validated
- **THEN** the localized guide offers retry when applicable, reselection, skip, or cancel and does not claim the combination is supported

#### Scenario: Setup is skipped
- **WHEN** the user skips the model section, `--no-setup` is supplied, or no controlling terminal is available
- **THEN** installation preserves existing slot configuration and prints `horsepower setup --interactive` as the exact model-only follow-up command in addition to any complete-configuration follow-up needed

#### Scenario: Guided configuration fails after activation
- **WHEN** guided setup is canceled or cannot validate all required slots after Horsepower code activation succeeded
- **THEN** the installed code remains valid, previous slot configuration remains byte-for-byte unchanged, and output distinguishes installation success from incomplete model setup

### Requirement: Installation documentation distinguishes interactive and unattended paths
The English and Chinese release documentation SHALL present interactive installation without `--no-setup` as the primary complete-configuration path, SHALL document `--no-setup` separately as unattended installation, and SHALL describe `horsepower setup --interactive` only as model-slot setup or revalidation.

#### Scenario: User follows primary installation instructions
- **WHEN** a user follows the first documented installation command
- **THEN** the installer is allowed to present language, Skill boundary, webhook, and model configuration rather than suppressing those prompts

#### Scenario: User chooses unattended installation
- **WHEN** a user follows the documented `--no-setup` path
- **THEN** documentation states which prompts are skipped and directs the user to `horsepower configure --interactive` for the complete journey

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
