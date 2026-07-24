## ADDED Requirements

### Requirement: CLI operational failures use stable actionable envelopes
Every executable CLI command path SHALL return a non-empty bounded failure result when parsing, validation, configuration, compatibility, ownership, filesystem, process, network, adapter, rollback, or handler execution fails. Text and JSON output SHALL preserve equivalent stable code, command path, stage, localized explanation, remediation, and truthful mutation/rollback state when available. Help requests SHALL retain their existing side-effect-free behavior.

#### Scenario: Command argument is invalid
- **WHEN** a public command receives an unknown option, invalid positional value, missing required value, or unsupported combination
- **THEN** Horsepower exits non-zero and identifies the exact command path and argument with bounded usage remediation

#### Scenario: Command handler fails
- **WHEN** a registered handler throws or returns a failed operational outcome
- **THEN** the CLI emits the owning boundary code and stage rather than an empty result, stack trace, or unrelated generic help

#### Scenario: JSON failure is requested
- **WHEN** `--json` is active and an operational failure occurs
- **THEN** Horsepower returns the normal bounded JSON failure envelope without mixing human prose on stdout or exposing raw exception data

### Requirement: CLI failure reporting itself fails safely
If locale resolution, text rendering, JSON serialization, terminal output, or secondary diagnostic formatting fails while reporting another CLI error, Horsepower SHALL preserve the primary failure and use a minimal bounded machine-stable fallback on an available output stream. It SHALL NOT recursively retry without bound or replace the primary failure with the renderer failure.

#### Scenario: Localized rendering fails during error output
- **WHEN** a command has a classified primary failure and localized rendering throws
- **THEN** Horsepower exits non-zero with a minimal stable code, command path, and remediation while retaining a bounded reporting diagnostic where possible
