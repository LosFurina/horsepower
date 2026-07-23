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
Horsepower SHALL NOT permit a change to be reported `completed` from unit-test evidence alone, stale evidence, failed evidence, partial evidence presented as complete, evidence unrelated to its declared acceptance claim, or a worker/reviewer success statement that the Captain has not independently inspected and verified. The Captain SHALL provide a bounded verification manifest containing fresh command evidence mapped to the current OpenSpec acceptance scope, or an `e2eWaiver` with a concrete reason and fresh alternative evidence mapped to that scope when E2E is genuinely inapplicable. Horsepower SHALL validate the current OpenSpec context and scoped acceptance snapshot at report time and SHALL reject completion if the active scope has drifted, any scoped acceptance item is unchecked, or any evidence reference is missing or unsuccessful.

#### Scenario: Captain-selected E2E passes
- **WHEN** the Captain declares E2E commands and each command completes successfully with bounded evidence
- **THEN** the verification gate permits the Captain to report `completed`

#### Scenario: Fresh Captain-selected E2E proves current acceptance
- **WHEN** the Captain reports `completed` with exact successful commands observed within the allowed freshness window, maps their evidence IDs to every acceptance item in the active OpenSpec task scope, and current OpenSpec validation and scope reconciliation succeed
- **THEN** the verification gate records bounded receipt and scope evidence and permits the Captain to report `completed`

#### Scenario: Captain waives E2E
- **WHEN** the Captain declares that E2E is unnecessary and supplies a non-empty waiver reason plus alternative verification evidence
- **THEN** the verification gate records the waiver evidence and permits completion

#### Scenario: Captain supplies a valid mapped E2E waiver
- **WHEN** the Captain declares E2E inapplicable with a non-empty concrete reason and maps fresh bounded alternative evidence to every acceptance item in the active OpenSpec task scope
- **THEN** the verification gate records the waiver and current scope evidence and permits completion without misrepresenting unit tests as E2E

#### Scenario: Unit tests are the only evidence
- **WHEN** the Captain attempts to report `completed` without successful declared E2E evidence or a valid waiver
- **THEN** Horsepower rejects the terminal report without changing OpenSpec facts

#### Scenario: Unit tests are the only unmapped evidence
- **WHEN** the Captain attempts to report `completed` with unit-test output but without successful E2E evidence or a valid waiver mapped to the current acceptance scope
- **THEN** Horsepower rejects the terminal report without changing OpenSpec or terminal runtime facts

#### Scenario: Evidence is stale or predates the active run
- **WHEN** a completion manifest contains evidence observed before the active implementation run or outside the documented freshness window
- **THEN** Horsepower rejects completion with a stable freshness diagnostic and records no terminal state

#### Scenario: Successful command does not cover all acceptance claims
- **WHEN** every supplied command exits successfully but one or more current scoped acceptance items has no valid mapped evidence
- **THEN** Horsepower rejects completion and identifies the unchecked acceptance references without extrapolating from unrelated success

#### Scenario: Evidence reports a failed or missing command
- **WHEN** an acceptance item maps to a command with non-zero exit status or to an evidence ID absent from the manifest
- **THEN** Horsepower rejects completion and reports the actual bounded evidence state

#### Scenario: OpenSpec scope changes after verification
- **WHEN** current OpenSpec artifacts or active task scope no longer match the scope snapshot reconciled by the completion manifest
- **THEN** Horsepower rejects completion until the Captain performs and reports verification against the current scope

#### Scenario: Worker claims success without Captain verification
- **WHEN** a worker or reviewer reports success but the Captain supplies only that report or artifact without fresh Captain-observed verification mapped to current acceptance
- **THEN** Horsepower treats the report as supporting input and rejects `completed`

#### Scenario: E2E requires human judgment
- **WHEN** selected E2E cannot proceed without a product or environment decision
- **THEN** the Captain may explicitly report `blocked_needs_human` without passing the completion gate

### Requirement: Explicit change terminal reporting
Horsepower SHALL consider a change terminal only when the Captain explicitly reports `completed`, `blocked_needs_human`, `failed`, or `canceled`. It SHALL NOT infer change completion from an assistant turn ending, becoming quiet, a worker or reviewer verdict, or an expression of confidence or satisfaction. A `completed` report SHALL use the current claim-matched verification manifest contract; non-complete terminal states SHALL truthfully describe the observed status and SHALL NOT require successful completion evidence.

#### Scenario: Captain reports completion
- **WHEN** the Captain reports `completed` in valid OpenSpec context and the E2E completion gate passes
- **THEN** Horsepower records process-lifetime terminal runtime evidence and triggers configured change notification

#### Scenario: Captain reports verified completion
- **WHEN** the Captain explicitly reports `completed` in valid current OpenSpec context and the fresh claim-matched completion gate passes
- **THEN** Horsepower records process-lifetime terminal runtime evidence and triggers configured change notification

#### Scenario: Legacy uncorrelated completion payload is used
- **WHEN** the Captain reports `completed` using bare E2E or waiver fields without freshness and acceptance mapping
- **THEN** Horsepower rejects the report with localized migration guidance and records no terminal state

#### Scenario: Captain reports a non-complete terminal state
- **WHEN** the Captain explicitly reports `blocked_needs_human`, `failed`, or `canceled`
- **THEN** Horsepower triggers configured change notification without requiring successful completion evidence and without implying that acceptance passed

#### Scenario: Assistant turn ends
- **WHEN** the main assistant finishes a turn without explicit terminal reporting
- **THEN** Horsepower sends no change-terminal notification and infers no terminal state

#### Scenario: Assistant turn or worker report ends
- **WHEN** the main assistant finishes a turn or receives a successful worker/reviewer report without explicit verified terminal reporting
- **THEN** Horsepower sends no change-terminal notification and infers no terminal state

### Requirement: Bounded current OpenSpec task inventory
Horsepower SHALL derive implementation campaign choices from the selected apply-ready change's official current OpenSpec tasks artifact. The OpenSpec boundary SHALL return a bounded ordered inventory of numbered sections and canonical checkbox task IDs with descriptions and pending/complete state, plus a digest of the validated inventory, without writing the artifact or creating a parallel task store. It SHALL reject duplicate IDs, malformed task syntax, ambiguous inventory, unsupported bounds, invalid change context, and an inventory with no recognizable tasks.

#### Scenario: Valid current task inventory is loaded
- **WHEN** an apply-ready strictly valid change has an official tasks artifact using supported numbered headings and checkbox task lines
- **THEN** Horsepower returns its ordered sections, canonical task IDs, bounded descriptions, completion states, and inventory digest for campaign selection

#### Scenario: Task artifact path is discovered
- **WHEN** Horsepower loads campaign tasks for a selected change
- **THEN** it obtains the resolved task artifact path from official OpenSpec status output rather than assuming a repository-relative location

#### Scenario: Task inventory is malformed or ambiguous
- **WHEN** the official task artifact contains duplicate IDs, malformed task checkbox lines, tasks outside recognized sections, unsupported size/count bounds, or no recognizable tasks
- **THEN** Horsepower creates no campaign and reports bounded actionable OpenSpec compatibility evidence without guessing the intended tasks

#### Scenario: Task inventory is observation-only
- **WHEN** Horsepower reads or revalidates task inventory
- **THEN** it does not modify OpenSpec artifacts, task completion, planning state, or archive facts

### Requirement: Dispatch-time OpenSpec task revalidation
Before a work-producing dispatch creates a run, worker, handoff, or consumes implementation/review budget, Horsepower SHALL reload the current official task inventory and verify the request against the active campaign's change, project, canonical selected pending task IDs, and confirmed inventory snapshot. Selected-task completion, removal, renaming, description/section change, digest conflict, invalid OpenSpec context, or requested unselected task SHALL fail closed and require a new explicit campaign; Horsepower SHALL NOT silently add, refresh, or broaden authorization.

#### Scenario: Selected tasks remain current and pending
- **WHEN** every requested task ID remains unchanged, pending, selected by the active campaign, and owned by its current valid OpenSpec change
- **THEN** task revalidation permits campaign authorization to continue under existing mode and budget rules

#### Scenario: Selected task changed after confirmation
- **WHEN** a selected task is completed, removed, renumbered, moved, redescribed, or otherwise conflicts with the confirmed task snapshot
- **THEN** Horsepower rejects work before accounting or process creation and directs the user to create a new campaign

#### Scenario: Request includes an unselected or nonexistent task
- **WHEN** a dispatch requests a task ID outside the campaign's canonical selected IDs or absent from current OpenSpec tasks
- **THEN** Horsepower rejects the request without extending campaign authority

#### Scenario: Unselected task changes
- **WHEN** only a task outside the campaign's selected scope changes and every selected task remains identical and pending
- **THEN** Horsepower may continue authorizing the unchanged selected scope without treating unrelated drift as new authority
