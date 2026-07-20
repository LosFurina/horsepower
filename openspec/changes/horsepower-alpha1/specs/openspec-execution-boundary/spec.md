## ADDED Requirements

### Requirement: Official OpenSpec is mandatory
Horsepower SHALL require the official Fission-AI/OpenSpec CLI at version 1.6.0 or newer and SHALL NOT install, bundle, patch, or replace OpenSpec.

#### Scenario: OpenSpec CLI missing
- **WHEN** Horsepower installation or doctor cannot find `openspec`
- **THEN** it fails with the detected state and official OpenSpec installation guidance

#### Scenario: Unsupported OpenSpec version
- **WHEN** the installed CLI is older than the supported baseline
- **THEN** Horsepower blocks advancing work and reports the required version

### Requirement: OpenSpec owns all change facts
Horsepower SHALL use the official OpenSpec workflow, CLI, schemas, generated skills, proposal, specs, design, tasks, apply progress, verification, and archive facts without creating a parallel planning or task record.

#### Scenario: Valid OpenSpec change executes
- **WHEN** official OpenSpec CLI validation and status say a change is ready for apply
- **THEN** Horsepower may execute explicitly dispatched worker operations without redefining OpenSpec artifacts

#### Scenario: OpenSpec artifacts change
- **WHEN** OpenSpec updates its supported workflow behavior
- **THEN** Horsepower uses the supported official CLI contract rather than guessing or rewriting the artifact format

### Requirement: Advancing work requires valid OpenSpec context
Actions that create or advance work SHALL require a supported initialized OpenSpec project and valid active change. Observation and cleanup actions SHALL remain available without valid OpenSpec context.

#### Scenario: Valid context advances work
- **WHEN** OpenSpec doctor, status, and validation succeed for the selected change
- **THEN** `single`, `parallel`, `chain`, `create`, `send`, and `steer` may proceed

#### Scenario: Context unavailable
- **WHEN** OpenSpec is missing, invalid, uninitialized, or has no valid selected change
- **THEN** Horsepower blocks advancing actions but permits `status`, `list`, `read`, `abort`, `destroy`, and `doctor`

### Requirement: OpenSpec Pi integration remains official
Horsepower SHALL NOT modify or overwrite OpenSpec-generated `.pi/skills` or `.pi/prompts`. It SHALL direct users to `openspec init --tools pi` or `openspec update` when official project integration is absent or stale.

#### Scenario: Project not initialized for Pi
- **WHEN** OpenSpec CLI exists but the project lacks official Pi integration
- **THEN** Horsepower reports the official initialization command and does not generate replacement skills

### Requirement: External planning sources cannot compete
Before Horsepower executes a change imported from external Markdown, the approved content SHALL be represented in official OpenSpec artifacts and the imported source files SHALL be removed after digest-checked user confirmation.

#### Scenario: Imported source remains
- **WHEN** an imported source document still exists
- **THEN** execution remains blocked to prevent competing facts

#### Scenario: Source changed before deletion
- **WHEN** a source digest differs from the imported digest
- **THEN** deletion is refused and execution remains blocked
