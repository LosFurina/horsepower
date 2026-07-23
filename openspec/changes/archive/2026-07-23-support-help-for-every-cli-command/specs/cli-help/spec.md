## ADDED Requirements

### Requirement: Complete top-level CLI help
Horsepower SHALL provide `horsepower --help`, `horsepower -h`, and `horsepower help` as successful side-effect-free requests that enumerate every public first-level command from the authoritative executable command registry. The output SHALL include bounded usage and purpose guidance and SHALL NOT silently omit operational commands.

#### Scenario: User requests top-level help
- **WHEN** the user invokes `horsepower --help`, `horsepower -h`, or `horsepower help`
- **THEN** Horsepower exits with status 0 and presents every public first-level command exactly once with a bounded description

#### Scenario: A new public command is registered
- **WHEN** implementation adds an executable public command without complete help metadata
- **THEN** registry validation or automated contract tests fail rather than shipping an undocumented command

### Requirement: Help for every public command path
Every public first-level command and every public nested command path SHALL support both `--help` and `-h`. Command-specific help SHALL identify the exact command path and present its supported usage forms, purpose, positional arguments, options, nested commands, and examples as applicable, rather than returning unrelated top-level help.

#### Scenario: First-level command help is requested
- **WHEN** the user invokes a registered path such as `horsepower doctor --help`
- **THEN** Horsepower exits with status 0 and displays doctor-specific usage and options without listing unrelated command details as the primary result

#### Scenario: Nested command help is requested
- **WHEN** the user invokes a registered nested path such as `horsepower webhook configure -h` or `horsepower handoff inspect --help`
- **THEN** Horsepower exits with status 0 and displays the exact nested path, required arguments, accepted options, and relevant examples

#### Scenario: Parent command has nested actions
- **WHEN** the user requests help for `horsepower webhook` or `horsepower handoff`
- **THEN** Horsepower lists every supported immediate child action and explains how to request child-specific help

#### Scenario: Unknown help path is requested
- **WHEN** the user requests help for an unknown first-level command or unknown nested action
- **THEN** Horsepower returns a stable usage failure identifying the unknown path and does not substitute help for another command

### Requirement: Help requests are side-effect-free
Horsepower SHALL resolve and render help before platform checks, command-specific validation, confirmation, external discovery, network activity, or business execution. A help request SHALL NOT mutate installation links, versions, settings, model slots, handoffs, OpenSpec artifacts, repository files, or process-lifetime orchestration state.

#### Scenario: Help targets a mutating command
- **WHEN** the user invokes help for `set`, `unset`, `configure`, `webhook configure`, `enable`, `disable`, `uninstall`, `purge`, or another mutating path
- **THEN** Horsepower returns help without writing files, prompting for confirmation, changing links, deleting state, or executing the command handler

#### Scenario: Help targets a networked or discovery command
- **WHEN** the user invokes help for `doctor`, `setup`, `skill-audit`, `webhook test`, `preflight`, or another path that normally reads external state or uses adapters
- **THEN** Horsepower returns help without invoking Pi model discovery, OpenSpec, webhook delivery, Skill audit resolution, provider probes, or network adapters

#### Scenario: Platform is unsupported
- **WHEN** a user on an otherwise unsupported platform requests help for a platform-restricted command
- **THEN** Horsepower still returns help successfully because no platform-specific business action is executed

### Requirement: Localized and machine-readable help
Human-facing help descriptions and headings SHALL use the effective `en` or `zh-CN` locale. Commands, flags, enum values, positional metavariables, IDs, paths, examples, and JSON field names SHALL remain untranslated. Every valid help path SHALL support `--json` with a stable bounded representation semantically equivalent to text help.

#### Scenario: Chinese help is requested
- **WHEN** effective locale is `zh-CN` and the user requests help
- **THEN** headings and descriptive guidance are Chinese while command paths, flags, enum values, and examples remain machine-stable

#### Scenario: English help is requested
- **WHEN** effective locale is `en` and the user requests the same help path
- **THEN** headings and descriptive guidance are English and expose the same command, argument, option, and nested-path facts

#### Scenario: JSON help is requested
- **WHEN** the user invokes a valid help path with `--json`
- **THEN** Horsepower exits with status 0 and returns the normal JSON success envelope containing stable bounded `commandPath`, `usage`, `description`, `arguments`, `options`, `subcommands`, and `examples` fields as applicable

### Requirement: Packaged CLI help parity
The built immutable release CLI SHALL expose the same complete help registry and path behavior as source-level CLI execution. Automated release verification SHALL cover every public path in the packaged binary and SHALL fail if any path is missing, stale, unsafe, or rendered only by source tests.

#### Scenario: Release CLI is verified
- **WHEN** the deterministic release archive is built and its CLI entry point is exercised
- **THEN** every registered first-level and nested command path accepts both help flags with exit status 0 and no side effects

#### Scenario: Packaged registry differs from source expectations
- **WHEN** the built CLI omits a command path or renders metadata inconsistent with the source registry contract
- **THEN** release E2E fails before installation or publication
