## ADDED Requirements

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
