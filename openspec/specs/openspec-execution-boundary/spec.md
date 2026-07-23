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

### Requirement: Campaign discovery is prompt and resource-bounded
Horsepower SHALL avoid repeated installation validation within one campaign discovery operation and SHALL inspect independent candidate changes with bounded concurrency. It SHALL preserve official candidate order, candidate and byte limits, strict eligibility validation, deterministic fail-closed diagnostics, privacy filtering, and fresh confirmation-time revalidation. Discovery acceleration SHALL NOT persist or reuse authorization across operations, campaigns, changes, task-state changes, or Pi processes.

#### Scenario: Multiple unfinished changes are discovered
- **WHEN** the current project contains multiple bounded apply-ready unfinished changes
- **THEN** Horsepower validates the installation and project once, inspects candidate-specific facts with a fixed concurrency bound, and presents eligible candidates in official list order

#### Scenario: Candidate count grows
- **WHEN** discovery receives more candidates than one inspection batch can process concurrently
- **THEN** Horsepower admits no more than the documented fixed concurrency bound and processes the remaining candidates without an unbounded process burst

#### Scenario: Concurrent candidates finish out of order
- **WHEN** candidate status or strict-validation operations settle in a different order than the official list
- **THEN** Horsepower presents successful candidates and selects any fatal diagnostic according to official list order rather than settlement order

#### Scenario: One candidate is invalid during concurrent discovery
- **WHEN** any candidate returns strict-invalid, malformed, truncated, timed-out, ambiguous, unsupported, or project-conflicting facts
- **THEN** Horsepower fails the whole discovery with a bounded actionable diagnostic and creates no campaign or execution side effect

#### Scenario: Selected candidate drifts after prompt discovery
- **WHEN** a promptly discovered candidate or its selected tasks change before campaign confirmation
- **THEN** Horsepower performs fresh selected-change and task-snapshot validation, rejects stale authorization, and creates no campaign or execution side effect

#### Scenario: Real Pi opens a bounded multi-change picker
- **WHEN** a fresh supported Pi process invokes `/horsepower-campaign` against the installed immutable release in a bounded fixture with multiple eligible changes
- **THEN** the first explicit changes picker appears within the documented acceptance budget without provider or network dependence

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
Horsepower SHALL consider a change terminal only when the Captain explicitly reports `completed`, `blocked_needs_human`, `failed`, or `canceled`. It SHALL NOT infer change completion from an assistant turn ending, becoming quiet, a worker or reviewer verdict, or an expression of confidence or satisfaction. A `completed` report SHALL use the current claim-matched verification manifest contract; non-complete terminal states SHALL truthfully describe the observed status and SHALL NOT require successful completion evidence. A configured change notification SHALL normalize the accepted terminal event once and deliver it through the explicitly selected `generic` or `discord` provider adapter without allowing provider outcome to alter terminal truth.

#### Scenario: Captain reports completion
- **WHEN** the Captain reports `completed` in valid OpenSpec context and the E2E completion gate passes
- **THEN** Horsepower records process-lifetime terminal runtime evidence and triggers the configured provider-aware change notification

#### Scenario: Captain reports verified completion
- **WHEN** the Captain explicitly reports `completed` in valid current OpenSpec context and the fresh claim-matched completion gate passes
- **THEN** Horsepower records process-lifetime terminal runtime evidence and triggers the configured provider-aware change notification

#### Scenario: Legacy uncorrelated completion payload is used
- **WHEN** the Captain reports `completed` using bare E2E or waiver fields without freshness and acceptance mapping
- **THEN** Horsepower rejects the report with localized migration guidance and records no terminal state

#### Scenario: Captain reports a non-complete terminal state
- **WHEN** the Captain explicitly reports `blocked_needs_human`, `failed`, or `canceled`
- **THEN** Horsepower triggers the configured provider-aware change notification without requiring successful completion evidence and without implying that acceptance passed

#### Scenario: Provider notification fails
- **WHEN** a generic or Discord receiver rejects or cannot receive the accepted change terminal event
- **THEN** Horsepower preserves the recorded change terminal state and records only bounded redacted delivery evidence

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

### Requirement: User-confirmed OpenSpec test-and-gate plan
Before Horsepower treats an OpenSpec change as eligible for implementation, Horsepower-assisted authoring SHALL present the user with an explicit bounded choice of `testIntensity` (`targeted`, `standard`, `exhaustive`, or `custom`) and `gateStrictness` (`required`, `strict`, `release`, or `custom`), explain the concrete consequences of each offered choice for the current change, and obtain affirmative confirmation of the fully expanded plan. Horsepower SHALL NOT silently select, inherit, or reuse a profile across changes or materially changed plans. No profile SHALL weaken mandatory OpenSpec validity, privacy, security, compatibility, lifecycle truth, current-scope claim matching, or E2E-or-valid-waiver requirements.

#### Scenario: User confirms recommended profiles
- **WHEN** Horsepower recommends profiles based on the current change and the user affirmatively selects and confirms them after seeing the expanded cases and gates
- **THEN** the official OpenSpec artifacts record those exact machine profile values and the confirmed expanded plan

#### Scenario: User selects custom profiles
- **WHEN** the user chooses `custom` for testing or gates
- **THEN** Horsepower requires bounded explicit test cases or gate entries that satisfy all mandatory floors before the plan can be confirmed

#### Scenario: User cancels or does not confirm
- **WHEN** the user cancels, declines, supplies an unsupported value, or does not affirm the expanded plan
- **THEN** Horsepower does not represent the plan as confirmed and does not treat the change as ready for Horsepower implementation

#### Scenario: A prior change had a confirmed plan
- **WHEN** Horsepower authors another change
- **THEN** it asks again and does not infer test intensity or gate strictness from the earlier change, global settings, agent output, or repository history

### Requirement: Concrete test-case explanation
A confirmed test-and-gate plan SHALL contain one or more stable unique test-case IDs and SHALL explain each case with bounded mappings to current OpenSpec requirement/scenario or task-acceptance references, test level, purpose or risk, preconditions and fixtures, action or command intent, expected observable result, and the meaning of failure. The plan SHALL cover every current acceptance scenario in scope or identify a concrete justified non-applicability entry; profile names alone, generic phrases such as “add tests,” and unmapped command lists SHALL NOT be sufficient.

#### Scenario: Test case is presented for confirmation
- **WHEN** Horsepower explains a proposed test case to the user
- **THEN** the explanation states what acceptance claim it proves, how it will be exercised, what result must be observed, and what defect or risk a failure would reveal

#### Scenario: Acceptance scenario has no case
- **WHEN** a current in-scope requirement scenario maps to neither a concrete test case nor a justified non-applicability entry
- **THEN** the plan is incomplete and Horsepower blocks implementation eligibility

#### Scenario: One case covers multiple scenarios
- **WHEN** one concrete case genuinely proves multiple acceptance scenarios
- **THEN** every covered reference is listed explicitly and no coverage is inferred for an unlisted scenario

#### Scenario: Planned command is not yet final
- **WHEN** exact implementation-specific command syntax cannot be known during planning
- **THEN** the case records a concrete test level, harness or command intent, setup, action, and expected result and requires the exact command to be reconciled before completion evidence is accepted

### Requirement: Explicit gate explanation and mandatory floors
A confirmed plan SHALL contain stable unique gate IDs and explain for each gate its explicit mapped current requirement/scenario or task-acceptance references, command or inspection intent, scope, pass condition, required/advisory disposition, execution phase, and any permitted waiver condition. Gate acceptance mappings SHALL be resolved and included in the semantic digest; Horsepower SHALL NOT infer them from scope prose. `required` SHALL include all repository-defined baseline checks and current completion requirements; `strict` SHALL additionally require applicable full regression suites and zero unresolved in-scope required failures; `release` SHALL additionally require applicable deterministic release, privacy, packaged artifact, installation, and real-environment acceptance checks. A `custom` plan SHALL enumerate its gates and SHALL remain at least as strict as every mandatory floor applicable to the change.

#### Scenario: Gate profile is explained
- **WHEN** Horsepower presents `required`, `strict`, `release`, or a custom gate profile
- **THEN** it shows the concrete current-change gate entries and pass, waiver, and execution expectations rather than only the profile label

#### Scenario: Release-affecting change selects release gates
- **WHEN** the confirmed plan uses `release` for a release or installation-affecting change
- **THEN** it includes applicable deterministic archive/privacy, packaged CLI, immutable installation, rollback or upgrade, and real acceptance gates

#### Scenario: Custom gate weakens a mandatory floor
- **WHEN** a custom plan omits or makes advisory an applicable mandatory OpenSpec, privacy, security, compatibility, terminal-truth, or completion-evidence gate
- **THEN** Horsepower rejects the plan and identifies the mandatory gate that cannot be weakened

#### Scenario: Waiver is permitted
- **WHEN** a gate explicitly allows waiver and its documented applicability condition is met
- **THEN** the eventual waiver still requires a concrete reason and mapped alternative evidence under the existing verification contract

### Requirement: Official-artifact ownership and bounded plan parsing
The expanded plan and selected profiles SHALL live in official OpenSpec planning artifacts using a documented bounded Markdown contract. Horsepower SHALL derive a normalized plan snapshot and digest from the current validated artifacts without creating a separate persistent planning, test, gate, acceptance, or confirmation registry. It SHALL reject missing sections, malformed or duplicate IDs, unknown profile values, unsafe or oversized fields, unresolved mappings, unsupported counts, symbolic-link or ownership violations, and ambiguous plans.

#### Scenario: Valid plan is loaded
- **WHEN** the current strict-valid OpenSpec change contains one unambiguous documented test-and-gate plan
- **THEN** Horsepower returns the selected profiles, ordered cases, ordered gates, coverage references, and normalized digest without modifying the artifacts

#### Scenario: Plan is malformed
- **WHEN** the plan has duplicate IDs, unknown enums, missing required fields, ambiguous mappings, unsupported bounds, or conflicting plan sections
- **THEN** Horsepower fails closed with actionable bounded diagnostics instead of guessing intent

#### Scenario: Agent or reviewer supplies a separate plan
- **WHEN** a worker, reviewer, report, prompt, settings file, or Horsepower runtime object contains testing or gate recommendations
- **THEN** those remain advisory until incorporated and confirmed in the official OpenSpec artifacts

#### Scenario: Plan is observed repeatedly
- **WHEN** Horsepower loads or revalidates the plan
- **THEN** it performs observation only and does not modify OpenSpec artifacts, confirmation, tasks, or archive facts

### Requirement: Relevant plan drift requires renewed confirmation
Horsepower SHALL compute confirmation against the normalized current profiles, test cases, gates, mappings, and acceptance scope. Adding, removing, reordering, or changing an in-scope requirement/scenario, task acceptance, profile, test case, gate, command intent, fixture/environment assumption, pass condition, waiver rule, or mapping SHALL invalidate prior confirmation. Unrelated prose or formatting changes that do not alter the normalized plan or acceptance scope SHALL NOT invalidate it.

#### Scenario: Test case or gate changes after confirmation
- **WHEN** a case, gate, mapping, profile, or relevant acceptance fact changes
- **THEN** Horsepower requires the user to review and affirm the newly expanded plan before campaign creation or advancing work

#### Scenario: Only unrelated prose changes
- **WHEN** an edit changes no normalized plan field and no mapped acceptance fact
- **THEN** the current plan digest remains valid and Horsepower does not demand confirmation solely because file bytes changed

#### Scenario: Drift occurs during implementation
- **WHEN** dispatch-time revalidation finds relevant drift from the campaign-confirmed plan snapshot
- **THEN** Horsepower blocks new work before budget or process creation and requires a newly confirmed campaign plan

### Requirement: Post-compaction OpenSpec revalidation
Immediately before enqueueing a Horsepower post-compaction continuation, the runtime SHALL use the supported official OpenSpec boundary to verify that the same change remains apply-ready and strictly valid, the active campaign's exact selected task IDs remain present, ordered, pending, and snapshot-equivalent, and the current inventory digest matches. The runtime SHALL repeat normal dispatch-time authorization before any later work-producing action and SHALL NOT repair or reinterpret drift automatically.

#### Scenario: Official scope is unchanged
- **WHEN** the active campaign's change, selected task order, descriptions, sections, pending states, and inventory digest still match current official OpenSpec facts
- **THEN** post-compaction continuation may proceed under the existing user authorization

#### Scenario: Selected task changed or completed
- **WHEN** a selected task is missing, reordered, completed, renamed, moved to another section, or otherwise differs from the campaign snapshot
- **THEN** Horsepower suppresses continuation and requires a fresh user-selected campaign rather than inferring a replacement scope

#### Scenario: OpenSpec context is invalid
- **WHEN** official OpenSpec status, doctor, strict validation, instructions, project ownership, or supported version checks fail
- **THEN** Horsepower suppresses continuation with bounded actionable evidence and changes no OpenSpec fact

#### Scenario: Drift occurs after continuation is queued
- **WHEN** official scope changes between continuation enqueue and a work-producing dispatch
- **THEN** existing dispatch-time revalidation rejects the action before worker, run, handoff, or budget side effects
