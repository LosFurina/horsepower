## MODIFIED Requirements

### Requirement: OpenSpec owns all change facts
Horsepower SHALL use the official OpenSpec workflow, CLI, schemas, generated skills, proposal, specs, design, tasks, apply progress, verification, archive facts, and current-project change inventory without creating a parallel planning, change-discovery, or task record. Campaign change discovery SHALL use supported official CLI facts rather than filesystem directory inference.

#### Scenario: Valid OpenSpec change executes
- **WHEN** official OpenSpec CLI validation and status say a discovered change is ready for apply and still has unfinished tasks
- **THEN** Horsepower may present it for explicit campaign selection and execute only explicitly authorized worker operations without redefining OpenSpec artifacts

#### Scenario: OpenSpec artifacts change
- **WHEN** OpenSpec updates its supported workflow behavior
- **THEN** Horsepower uses the supported official CLI contract rather than guessing, rewriting, or inferring readiness from the artifact or directory format

#### Scenario: Filesystem contains a change-like directory
- **WHEN** a directory resembles an OpenSpec change but supported official CLI facts do not establish it as an apply-ready unfinished change
- **THEN** Horsepower does not present it as an eligible campaign candidate

### Requirement: Advancing work requires valid OpenSpec context
Actions that create or advance work SHALL require a supported initialized OpenSpec project and a user-selected change from a bounded, valid, current-project inventory of apply-ready changes with unfinished tasks. Observation and cleanup actions SHALL remain available without valid OpenSpec context. Discovery SHALL be observational and SHALL NOT itself create campaign authority.

#### Scenario: Valid context advances work
- **WHEN** OpenSpec doctor, status, strict validation, and unfinished task inventory succeed for the selected discovered change
- **THEN** the user may select exact task scope and mode, after which `single`, `parallel`, `chain`, `create`, `send`, and `steer` may proceed under the resulting campaign

#### Scenario: No eligible unfinished changes exist
- **WHEN** official discovery returns no current-project change that is apply-ready, valid, and unfinished
- **THEN** Horsepower reports that no eligible campaign change exists and creates no campaign or execution side effect

#### Scenario: Discovery returns malformed or excessive results
- **WHEN** official discovery output is malformed, truncated, duplicated, ambiguous, unsupported, or exceeds configured candidate or byte bounds
- **THEN** Horsepower fails closed with a bounded actionable diagnostic and creates no campaign

#### Scenario: Selected change drifts before confirmation
- **WHEN** a discovered change becomes completed, unready, invalid, missing, archived, or task-drifted before campaign creation
- **THEN** Horsepower rejects stale authorization, creates no campaign, and requires a fresh discovery and selection

#### Scenario: Context unavailable
- **WHEN** OpenSpec is missing, invalid, uninitialized, or has no valid selected unfinished change
- **THEN** Horsepower blocks advancing actions but permits `status`, `list`, `read`, `abort`, `destroy`, and `doctor`
