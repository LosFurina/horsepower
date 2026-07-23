# interactive-configuration Specification

## Purpose
TBD - created by archiving change complete-interactive-configuration. Update Purpose after archive.
## Requirements
### Requirement: Complete installed-release configuration journey
Horsepower SHALL provide `horsepower configure --interactive` as a complete configuration journey for an installed release. The journey SHALL cover output locale, the Horsepower/external-Skill boundary, current-context Skill exposure, optional webhook configuration, and required model-slot configuration in that order, while `horsepower setup --interactive` SHALL remain a model-only reconfiguration command.

#### Scenario: User starts complete configuration
- **WHEN** a controlling terminal is available and the user runs `horsepower configure --interactive`
- **THEN** Horsepower guides locale, Skill boundary and audit, webhook, and model configuration without presenting model-only setup as the complete journey

#### Scenario: No controlling terminal is available
- **WHEN** complete interactive configuration cannot open the controlling terminal
- **THEN** Horsepower changes no configuration and returns a localized actionable error with stable machine evidence

#### Scenario: Existing locale-only command is used
- **WHEN** the user runs `horsepower configure --locale en|zh-CN` with an optional supported scope
- **THEN** Horsepower preserves the existing non-interactive locale-only behavior without starting the complete journey

### Requirement: Ordered localized section outcomes
Complete configuration SHALL persist the selected locale before rendering subsequent prompts, SHALL use that locale for every later human-facing prompt and conclusion, and SHALL report stable per-section outcomes without claiming full completion when any requested section is skipped, canceled, unsupported, inconclusive, or fails.

#### Scenario: User selects Chinese
- **WHEN** the user selects `zh-CN` at the beginning of complete configuration
- **THEN** all subsequent Skill, webhook, model, retry, cancellation, and completion guidance is Chinese while commands, model IDs, thinking IDs, statuses, evidence codes, and JSON keys remain untranslated

#### Scenario: Model setup does not complete
- **WHEN** locale or webhook configuration succeeds but guided model setup is skipped, canceled, unsupported, inconclusive, or fails
- **THEN** Horsepower preserves the confirmed earlier sections, preserves prior model-slot bytes, reports model setup as incomplete, and prints the exact model-only follow-up command

### Requirement: Explicit external Skill and Superpowers guidance
Complete configuration SHALL always explain that external Skills, including Superpowers as an example, remain user-managed and may influence the main Captain according to Pi discovery, while every Horsepower worker uses `--no-skills` and cannot load them. Horsepower SHALL NOT install, remove, enable, disable, or modify external Skills as part of configuration.

#### Scenario: Audit is clean
- **WHEN** complete configuration finds no statically resolvable external Skill and audit status is complete
- **THEN** Horsepower still presents the concise boundary explanation and continues without an exposure confirmation gate

#### Scenario: Audit finds exposure or uncertainty
- **WHEN** complete configuration finds external Skills or the current-context audit is partial or failed
- **THEN** Horsepower presents bounded localized audit evidence and continues only after explicit affirmative confirmation with No as the default

#### Scenario: User declines exposure confirmation
- **WHEN** the user does not explicitly affirm the external Skill or audit-uncertainty warning
- **THEN** Horsepower stops later complete-configuration sections without modifying any external Skill or the existing webhook and model configuration
