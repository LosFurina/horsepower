## MODIFIED Requirements

### Requirement: Installer safety and platform support
The bootstrap SHALL support Linux and macOS, reject Windows, use no `sudo`, run no release lifecycle scripts, modify no shell startup files, and use `/dev/tty` for interactive configuration after piped execution. `--no-setup` SHALL unambiguously disable interactive configuration without disabling verified installation, observation-only audit, or localized follow-up guidance.

#### Scenario: No controlling terminal
- **WHEN** the bootstrap has no usable `/dev/tty` or receives `--no-setup`
- **THEN** it installs without interactive configuration and prints `horsepower configure --interactive` as the exact complete-configuration follow-up command

#### Scenario: Interactive terminal is available
- **WHEN** the bootstrap has a usable `/dev/tty` and does not receive `--no-setup`
- **THEN** it performs the pre-activation Skill gate and, after verified activation, starts the complete configuration journey

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
The complete interactive configuration journey invoked directly or by interactive installation SHALL offer optional webhook configuration and SHALL allow the user to preserve existing settings, disable notifications, or configure them. Configuration SHALL support change notifications enabled by default, dispatch notifications disabled by default, and authentication modes `hmac`, `bearer`, and `none` with HMAC recommended.

#### Scenario: User skips webhook
- **WHEN** no webhook exists and the user selects skip, or an existing webhook exists and the user selects preserve
- **THEN** complete configuration leaves the effective webhook state unchanged and reports that outcome

#### Scenario: User disables webhook
- **WHEN** the user explicitly selects disable
- **THEN** complete configuration uses the existing credential-removing disable transaction and reports notifications disabled

#### Scenario: User configures HMAC
- **WHEN** the user provides a URL, selects `hmac`, and provides a secret
- **THEN** configuration writes the secret only to mode-`0600` Horsepower configuration and diagnostics redact it

#### Scenario: User configures Bearer authentication
- **WHEN** the user provides a URL, selects `bearer`, and provides a token
- **THEN** webhook requests use the Authorization header and no prompt, diagnostic, or summary prints the token

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

## ADDED Requirements

### Requirement: Installation documentation distinguishes interactive and unattended paths
The English and Chinese release documentation SHALL present interactive installation without `--no-setup` as the primary complete-configuration path, SHALL document `--no-setup` separately as unattended installation, and SHALL describe `horsepower setup --interactive` only as model-slot setup or revalidation.

#### Scenario: User follows primary installation instructions
- **WHEN** a user follows the first documented installation command
- **THEN** the installer is allowed to present language, Skill boundary, webhook, and model configuration rather than suppressing those prompts

#### Scenario: User chooses unattended installation
- **WHEN** a user follows the documented `--no-setup` path
- **THEN** documentation states which prompts are skipped and directs the user to `horsepower configure --interactive` for the complete journey
