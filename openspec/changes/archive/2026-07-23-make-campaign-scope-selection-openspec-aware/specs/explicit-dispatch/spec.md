## MODIFIED Requirements

### Requirement: User-selected implementation campaign mode
Before the first work-producing action in an implementation campaign, the user SHALL explicitly select `multi_agent` or `main_agent` for one apply-ready change and a non-empty canonical set of current unfinished OpenSpec task IDs. Horsepower SHALL discover and present the selected change's bounded task inventory, offer all unfinished tasks, unfinished tasks by section, or manually selected exact task IDs, and show the normalized tasks for confirmation before creating the campaign. Horsepower SHALL NOT infer, persist as a default, or reuse mode or task selection across scope changes, task drift, campaigns, changes, or Pi processes. Arbitrary strings, numeric ranges, nonexistent IDs, and completed tasks SHALL NOT become campaign authority.

#### Scenario: User selects all unfinished tasks
- **WHEN** the user chooses all unfinished tasks for an apply-ready change and confirms the normalized task list and execution mode
- **THEN** Horsepower creates a process-lifetime campaign containing the ordered unique canonical IDs and current task snapshot for exactly those unfinished tasks

#### Scenario: User selects unfinished sections
- **WHEN** the user chooses one or more displayed sections containing unfinished tasks and confirms the normalized selection
- **THEN** Horsepower creates campaign authority for the unique unfinished task IDs in those sections and no others

#### Scenario: User manually selects exact tasks
- **WHEN** the user enters comma-separated exact task IDs that all exist and remain unfinished in the displayed current inventory
- **THEN** Horsepower removes duplicates, preserves canonical order, displays the normalized IDs and descriptions for confirmation, and creates authority only after confirmation

#### Scenario: Manual selection is invalid
- **WHEN** manual input contains a numeric range, arbitrary scope text, unknown ID, completed task, cross-change task, or no unfinished task
- **THEN** Horsepower identifies the invalid entries and creates no campaign

#### Scenario: User cancels or declines confirmation
- **WHEN** the user cancels task selection, mode selection, or final normalized-scope confirmation
- **THEN** Horsepower creates no campaign and does not end or alter the currently active campaign

#### Scenario: Campaign has no user choice
- **WHEN** the Captain attempts a work-producing action without a matching active implementation campaign
- **THEN** Horsepower rejects it before creating a run, worker, handoff, or task evidence and returns the explicit campaign-selection remediation

#### Scenario: Campaign scope changes
- **WHEN** a work-producing action falls outside the campaign's declared task scope or belongs to another OpenSpec change
- **THEN** Horsepower rejects it until the user explicitly starts or switches an implementation campaign for that scope

#### Scenario: Campaign scope or selected tasks change
- **WHEN** a work-producing action falls outside the campaign's canonical selected task IDs or current selected-task state differs from its confirmed snapshot
- **THEN** Horsepower rejects it until the user explicitly starts or switches an implementation campaign for the current scope

#### Scenario: Observation or cleanup occurs
- **WHEN** the Captain or user performs status, list, read, doctor, abort, destroy, or handoff inspection/cleanup
- **THEN** Horsepower permits the operation without requiring an implementation campaign

#### Scenario: Successful campaign creation starts work
- **WHEN** the user confirms normalized unfinished task IDs and execution mode and Horsepower successfully creates the implementation campaign while Pi is idle
- **THEN** Horsepower injects the structured campaign context and triggers exactly one immediate Captain turn without requiring another user message

#### Scenario: Campaign command runs while an Agent turn is active
- **WHEN** a successful campaign is created while Pi is processing an Agent turn
- **THEN** Horsepower queues exactly one campaign kickoff as a follow-up that starts after the active work settles without steering or interrupting that work

#### Scenario: Campaign creation does not complete
- **WHEN** the user cancels, declines confirmation, supplies invalid scope, or campaign creation fails
- **THEN** Horsepower triggers no Captain turn and queues no campaign kickoff

#### Scenario: Campaign command is run again
- **WHEN** the user explicitly creates a later campaign after a prior campaign kickoff was already delivered
- **THEN** Horsepower starts exactly one turn for the newly confirmed campaign without replaying the prior campaign kickoff

### Requirement: Multi-Agent execution enforcement
In `multi_agent` mode Horsepower SHALL allow only explicit Captain dispatches for canonical current task IDs selected by the active campaign and SHALL keep all creation, slot, budget, and acceptance authority with the Captain. Substantive Captain-direct work SHALL require a non-empty recorded reason correlated to selected exact task IDs, while small coordination, OpenSpec bookkeeping, integration, conflict resolution, and verification MAY remain Captain-direct without another user prompt.

#### Scenario: Captain explicitly delegates substantive work
- **WHEN** an active multi-Agent campaign contains the requested task scope and the Captain submits a valid explicit dispatch
- **THEN** Horsepower performs only that dispatch under existing slot, handoff, and review-budget rules

#### Scenario: Captain explicitly delegates selected tasks
- **WHEN** an active multi-Agent campaign contains every requested canonical current task ID and the Captain submits a valid explicit dispatch
- **THEN** Horsepower performs only that dispatch under existing slot, handoff, OpenSpec-revalidation, and review-budget rules

#### Scenario: Captain requests a range or free-form scope
- **WHEN** the Captain submits a numeric range, arbitrary label, nonexistent ID, completed ID, or mixed selected/unselected task list
- **THEN** Horsepower rejects the dispatch before accounting or process creation and returns the exact-ID task-scope contract

#### Scenario: Captain directly performs substantive work
- **WHEN** the Captain elects not to delegate substantive in-scope work in multi-Agent mode
- **THEN** Horsepower requires a non-empty reason correlated to canonical selected task IDs in campaign evidence without changing the user's mode or prompting again

## ADDED Requirements

### Requirement: Localized OpenSpec-aware campaign interaction
The `/horsepower-campaign` command SHALL render task inventory, selection choices, validation errors, normalized confirmation, cancellation, and result summaries in the effective `en` or `zh-CN` output locale while preserving change IDs, task IDs, commands, digests, statuses, and other machine fields untranslated. Prompt labels SHALL NOT combine languages or use translated display labels as behavior tokens.

#### Scenario: Chinese campaign selection
- **WHEN** effective output locale is `zh-CN`
- **THEN** task headings, selection instructions, invalid-entry diagnostics, confirmation, and campaign conclusion are Chinese while OpenSpec task/change identifiers remain unchanged

#### Scenario: English campaign selection
- **WHEN** effective output locale is `en`
- **THEN** the same interaction and machine outcomes are presented with English human-facing text

#### Scenario: Large valid inventory is displayed
- **WHEN** a valid inventory approaches supported section, task, or description bounds
- **THEN** Horsepower presents a bounded grouped selection experience without truncating machine task IDs or silently omitting selectable unfinished tasks

#### Scenario: Localized campaign kickoff is delivered
- **WHEN** successful campaign creation triggers the Captain turn
- **THEN** the custom campaign context uses the effective output locale for its human instruction while preserving campaign ID, change ID, canonical task IDs, mode, and other machine fields unchanged

### Requirement: Observable bounded one-shot execution
Every `single`, `parallel`, and `chain` dispatch SHALL emit ordered bounded progress through the active Pi tool update callback from authorization through exactly one terminal event. Progress SHALL distinguish accepted, starting, assistant, tool start/update/end, managed-handoff creation/report validation, completed, failed, and canceled stages as applicable. Horsepower SHALL normalize and redact worker events and SHALL NOT expose raw prompts, provider payloads, credentials, unbounded tool output, report bodies, or private handoff paths. Progress delivery failure SHALL NOT change worker execution or terminal truth.

#### Scenario: One-shot worker uses tools
- **WHEN** a worker emits assistant and tool lifecycle events while executing a valid one-shot dispatch
- **THEN** the user sees ordered non-empty bounded updates attributed to that worker before the final result

#### Scenario: Parallel workers emit interleaved progress
- **WHEN** two or more parallel workers make progress concurrently
- **THEN** every update carries a stable invocation identity so interleaved events remain attributable without serializing the workers

#### Scenario: Progress contains sensitive or oversized fields
- **WHEN** raw Pi events contain prompts, credentials, private paths, provider payloads, or output beyond configured bounds
- **THEN** Horsepower redacts or omits those fields and emits only the normalized bounded event

#### Scenario: Tool update consumer fails
- **WHEN** Pi's partial-result callback throws or cannot render an update
- **THEN** Horsepower continues the dispatch, records bounded delivery evidence, and reports the worker's actual terminal status

### Requirement: Complete resolved worker identity
Before worker spawn, Horsepower SHALL construct an immutable identity from resolved runtime facts and SHALL include it in the tool title, every progress event, and terminal result. The identity SHALL contain dispatch name, agent name, agent role as the human-readable horse class/level, requested model slot, resolved model slot, concrete model, thinking level, handoff mode, and stable invocation ID; it SHALL add the opaque run ID after lifecycle creation. Human labels SHALL use `outputLocale`, while names, roles, slots, model IDs, thinking values, modes, and IDs remain untranslated machine values.

#### Scenario: Single worker title is rendered
- **WHEN** a single dispatch resolves its agent and model slot
- **THEN** its visible title identifies the dispatch name, agent and role, requested-to-resolved slot mapping, concrete model, thinking level, and handoff mode before spawn

#### Scenario: Slot uses a fallback
- **WHEN** the requested slot resolves through a fallback to another slot
- **THEN** title and structured identity show both requested and resolved slots without hiding the fallback

#### Scenario: Parallel or chain identities are rendered
- **WHEN** a parent dispatch contains multiple invocations
- **THEN** Horsepower shows a bounded parent summary and a complete stable identity for each child

#### Scenario: Caller supplies misleading display text
- **WHEN** caller-provided names contain control characters, excessive text, or conflict with resolved agent/model facts
- **THEN** Horsepower bounds and sanitizes the human title while structured identity remains derived from authoritative resolved facts

### Requirement: Terminally reliable dispatch and managed handoff
Every accepted work-producing dispatch SHALL return a non-empty structured result and reach exactly one terminal status of `completed`, `failed`, or `canceled`. If a dispatch run or managed handoff has been created, validation, capability, spawn, stream, worker, report, cleanup, or tool-delivery failure SHALL pass through an idempotent finalizer that terminalizes all created lifecycle artifacts before returning. Horsepower SHALL NOT return an absent tool result or leave `report: null` and `terminal: null` as an orphan after failure.

#### Scenario: Worker fails after managed handoff creation
- **WHEN** Horsepower creates a managed brief but worker spawn or execution fails
- **THEN** the dispatch and handoff are marked `failed`, the tool returns structured stage/error/remediation evidence, and no active worker or non-terminal orphan remains

#### Scenario: Failure occurs before lifecycle creation
- **WHEN** agent, model, task, capability, or scope validation fails before a run or handoff is created
- **THEN** Horsepower returns a non-empty structured `failed` result without fabricating lifecycle artifacts

#### Scenario: Managed report is missing or invalid
- **WHEN** a worker exits without the required valid managed report
- **THEN** Horsepower terminalizes the dispatch and handoff as `failed` and identifies `handoff_report` as the failure stage

#### Scenario: Cleanup also fails
- **WHEN** terminalization or cleanup encounters a secondary failure
- **THEN** Horsepower preserves the primary failure, appends bounded cleanup evidence, and still makes the lifecycle state terminal or explicitly reports the remaining invariant violation

### Requirement: Truthful worker readiness diagnostics
Horsepower SHALL NOT describe a configured model slot as valid or dispatch-ready when the current Pi model catalog is unavailable, the configured model is absent, or exact thinking support cannot be established under the current capability contract. Doctor and dispatch preflight SHALL distinguish `verified`, `unverified`, `unsupported`, and `unavailable`, preserve stable evidence, and SHALL fail before creating a managed handoff when the selected binding is not currently dispatchable.

#### Scenario: Configured model is absent from current Pi catalog
- **WHEN** a required slot names a model not present in the current Pi catalog
- **THEN** doctor reports the binding unavailable or unsupported and dispatch fails before run, handoff, or worker creation with `horsepower setup --interactive` remediation

#### Scenario: Pi model catalog cannot be established
- **WHEN** Horsepower cannot obtain the current Pi model catalog
- **THEN** doctor reports model readiness as unverified rather than configuration `ok`, and dispatch fails closed without creating work

#### Scenario: Exact model and thinking are verified
- **WHEN** the current catalog and capability evidence confirm the selected model/thinking combination
- **THEN** doctor and dispatch expose the verified binding and may proceed under campaign authorization

### Requirement: Bundled agent discovery follows the immutable release
Horsepower SHALL discover bundled agent definitions from the canonical immutable release root even when Pi loads the extension through the managed integration symlink. It SHALL NOT derive the agent directory from an unresolved symlink surface path or silently continue with an empty bundled catalog.

#### Scenario: Pi loads managed extension symlink
- **WHEN** `~/.pi/agent/extensions/horsepower` resolves through `current` to an immutable release extension
- **THEN** Horsepower resolves the real extension entry and discovers that release's bundled `architect`, `coder`, `researcher`, `reviewer`, and `tester` definitions

#### Scenario: Bundled catalog cannot be found
- **WHEN** the canonical release has no valid bundled agent directory
- **THEN** doctor and dispatch report a structured installation/catalog failure before campaign budget, run, handoff, or worker creation
