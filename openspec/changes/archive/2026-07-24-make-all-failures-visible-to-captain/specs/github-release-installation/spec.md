## ADDED Requirements

### Requirement: Installation and update failures identify transaction state
Installer, setup, configure, compatibility, ownership, download, integrity, extraction, activation, post-validation, rollback, uninstall, and purge failures SHALL return a bounded stable failure code, stage, remediation, and truthful transaction-state facts. Horsepower SHALL distinguish unchanged, partially staged, rolled back, and residual-state outcomes and SHALL NOT report installation or update success when a required verification or rollback step failed.

#### Scenario: Update verification fails before activation
- **WHEN** release identity, checksum, archive, manifest, digest, mode, layout, compatibility, ownership, or destination verification fails
- **THEN** update returns the specific failed stage and confirms which active installation facts remained unchanged without exposing network bodies or credentials

#### Scenario: Activation fails and rollback succeeds
- **WHEN** activation or post-validation fails and exact prior state is restored
- **THEN** Horsepower returns `rolled_back` with the primary failure, verified restored facts, and required user action

#### Scenario: Rollback or cleanup also fails
- **WHEN** update, install, enable, disable, uninstall, or purge encounters a secondary rollback or cleanup failure
- **THEN** Horsepower preserves the primary failure and reports bounded remaining version/link/staging state instead of claiming full rollback or cleanup

### Requirement: CLI and installer fallbacks disclose degradation
A documented safe fallback in CLI or installer execution SHALL disclose its degraded condition when a requested configured behavior could not be honored. Optional absence that is explicitly part of the interface MAY remain non-failing, but malformed, unreadable, unsupported, or conflicting state SHALL NOT be treated as absence.

#### Scenario: Configured locale cannot be read
- **WHEN** a CLI command cannot read or parse configured locale but can safely emit an English failure result
- **THEN** it emits the bounded operation failure or fallback diagnostic in English and identifies locale resolution as degraded

#### Scenario: Optional configuration is absent
- **WHEN** an optional configuration file does not exist and absence is explicitly supported
- **THEN** Horsepower uses the documented default without reporting a false error

#### Scenario: Configuration cannot be read
- **WHEN** the same configuration path exists but is unreadable, malformed, linked unsafely, or contains unsupported values
- **THEN** Horsepower reports a configuration failure and does not silently apply the absence default
