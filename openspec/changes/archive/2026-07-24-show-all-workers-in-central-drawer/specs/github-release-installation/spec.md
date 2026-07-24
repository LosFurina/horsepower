## ADDED Requirements

### Requirement: Update summaries use dynamic result identity
The CLI SHALL render update success, already-current, rollback, and failure summaries from the command result's dynamic summary variables when available, and SHALL never display `undefined` as a release version or reason.

#### Scenario: Update activates a release
- **WHEN** `horsepower update` successfully activates the resolved official release
- **THEN** localized human-readable output names the actual resolved version and does not contain `undefined`

#### Scenario: Installation is already current
- **WHEN** update resolution finds the active release is already current
- **THEN** localized output truthfully reports the current state without an undefined placeholder
