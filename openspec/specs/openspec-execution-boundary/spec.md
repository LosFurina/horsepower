# openspec-execution-boundary Specification

## Purpose
TBD - created by archiving change horsepower-alpha1. Update Purpose after archive.
## Requirements
### Requirement: Official OpenSpec is mandatory
Horsepower SHALL require the official Fission-AI/OpenSpec CLI at a stable semantic version in the range `>=1.6.0 <2.0.0` and SHALL NOT install, bundle, patch, replace, or automatically upgrade OpenSpec. Installer bootstrap, release manifest and preflight, doctor, and runtime work authorization SHALL enforce the same compatibility contract.

#### Scenario: OpenSpec CLI missing
- **WHEN** Horsepower installation or doctor cannot find `openspec`
- **THEN** it fails with the detected state and official OpenSpec installation guidance

#### Scenario: Unsupported OpenSpec version
- **WHEN** the installed CLI is outside the stable semantic version range `>=1.6.0 <2.0.0`
- **THEN** Horsepower blocks advancing work and reports the required version range

#### Scenario: Unsupported OpenSpec version during installation
- **WHEN** `openspec --version` fails, is not strict semantic version output, is a prerelease, is older than `1.6.0`, or is `2.0.0` or newer
- **THEN** installation exits before downloading a Horsepower release and does not offer a warning-confirmation bypass

#### Scenario: Unsupported OpenSpec version during operation
- **WHEN** doctor or a work-advancing runtime action observes an OpenSpec version outside `>=1.6.0 <2.0.0`
- **THEN** Horsepower blocks the incompatible operation and reports the required range without changing OpenSpec facts

#### Scenario: Compatibility declarations drift
- **WHEN** installer bootstrap, source compatibility, release manifest, doctor, or runtime boundary declare different OpenSpec ranges
- **THEN** release verification fails before publication

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

### Requirement: Captain-controlled E2E completion gate
Horsepower SHALL NOT permit a change to be reported `completed` from unit-test evidence alone. The Captain SHALL explicitly select change-specific E2E verification and provide successful command evidence, or provide an `e2eWaiver` with a concrete reason and alternative verification evidence.

#### Scenario: Captain-selected E2E passes
- **WHEN** the Captain declares E2E commands and each command completes successfully with bounded evidence
- **THEN** the verification gate permits the Captain to report `completed`

#### Scenario: Captain waives E2E
- **WHEN** the Captain declares that E2E is unnecessary and supplies a non-empty waiver reason plus alternative verification evidence
- **THEN** the verification gate records the waiver evidence and permits completion

#### Scenario: Unit tests are the only evidence
- **WHEN** the Captain attempts to report `completed` without successful declared E2E evidence or a valid waiver
- **THEN** Horsepower rejects the terminal report without changing OpenSpec facts

#### Scenario: E2E requires human judgment
- **WHEN** selected E2E cannot proceed without a product or environment decision
- **THEN** the Captain may explicitly report `blocked_needs_human` without passing the completion gate

### Requirement: Explicit change terminal reporting
Horsepower SHALL consider a change terminal only when the Captain explicitly reports `completed`, `blocked_needs_human`, `failed`, or `canceled`. It SHALL NOT infer change completion from an assistant turn ending or becoming quiet.

#### Scenario: Captain reports completion
- **WHEN** the Captain reports `completed` in valid OpenSpec context and the E2E completion gate passes
- **THEN** Horsepower records process-lifetime terminal runtime evidence and triggers configured change notification

#### Scenario: Captain reports a non-complete terminal state
- **WHEN** the Captain explicitly reports `blocked_needs_human`, `failed`, or `canceled`
- **THEN** Horsepower triggers configured change notification without requiring successful E2E evidence

#### Scenario: Assistant turn ends
- **WHEN** the main assistant finishes a turn without explicit terminal reporting
- **THEN** Horsepower sends no change-terminal notification and infers no terminal state
