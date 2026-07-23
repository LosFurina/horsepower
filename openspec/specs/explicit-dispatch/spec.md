# explicit-dispatch Specification

## Purpose
TBD - created by archiving change horsepower-alpha1. Update Purpose after archive.
## Requirements
### Requirement: Captain-only dispatch
Only the main Pi agent SHALL be able to create or advance workers. Worker command lines and prompts SHALL prohibit nested delegation.

#### Scenario: Captain dispatches work
- **WHEN** the main agent calls `horsepower_subagent` with valid OpenSpec context and an explicit slot
- **THEN** Horsepower performs exactly the requested dispatch

#### Scenario: Worker attempts delegation
- **WHEN** a worker would otherwise have access to a delegation tool
- **THEN** the tool is excluded and no nested worker can be created

### Requirement: Explicit one-shot modes
Horsepower SHALL support `single`, `parallel`, and `chain` one-shot modes. Parallel input SHALL contain at most eight tasks and run at most four child processes concurrently.

#### Scenario: Parallel tasks are explicit
- **WHEN** the captain supplies multiple named tasks
- **THEN** Horsepower runs only those tasks and does not expand the request

#### Scenario: Chain step consumes prior output
- **WHEN** a chain step contains `{previous}`
- **THEN** Horsepower substitutes the previous successful step output before dispatch

#### Scenario: Chain step fails
- **WHEN** one chain step fails
- **THEN** Horsepower stops and does not run subsequent steps

### Requirement: Bounded one-shot output
Horsepower SHALL limit displayed one-shot output to 50 KiB per task while preserving the full bounded structured result details.

#### Scenario: Output exceeds display cap
- **WHEN** a task produces more than 50 KiB of text
- **THEN** displayed text is truncated with an omission notice and structured details retain the full captured result within configured bounds

### Requirement: No implicit expansion
Workflow helpers, fanout, debate, recommendations, and health fallback SHALL NOT create an additional worker.

#### Scenario: Helper recommends multiple workers
- **WHEN** a helper produces dispatch proposals
- **THEN** proposals remain inert until the captain explicitly dispatches each requested task

### Requirement: Dispatch terminal lifecycle
Each explicit `single`, `parallel`, `chain`, or persistent message dispatch SHALL have a process-lifetime run ID and reach exactly one terminal status: `completed`, `failed`, or `canceled`. A persistent worker becoming `idle` without an active dispatch SHALL NOT create another terminal event.

#### Scenario: Dispatch completes
- **WHEN** an explicitly requested dispatch produces truthful completion evidence
- **THEN** its run becomes `completed` and optional dispatch notification may be emitted

#### Scenario: Dispatch fails or is canceled
- **WHEN** execution fails or semantic cancellation is observed
- **THEN** its run becomes `failed` or `canceled` respectively and optional dispatch notification may be emitted

### Requirement: Optional dispatch notification
Dispatch-level webhook notification SHALL be disabled by default and MAY be enabled by user configuration. Notification delivery failure SHALL NOT change the dispatch terminal status.

#### Scenario: Dispatch notification disabled
- **WHEN** a dispatch reaches terminal status under default configuration
- **THEN** no dispatch webhook is sent

#### Scenario: Dispatch notification enabled
- **WHEN** a dispatch reaches terminal status and dispatch notification is enabled
- **THEN** Horsepower sends one logical terminal notification through bounded in-process delivery attempts

### Requirement: Explicit handoff mode
Every work-producing dispatch SHALL explicitly declare `handoffMode` as `managed` or `inline`. Horsepower SHALL NOT infer a mode from prompt length, role, action text, or keywords. `parallel` and `chain` SHALL require `managed` mode.

#### Scenario: Mode omitted
- **WHEN** a one-shot task, persistent creation, or substantive persistent send omits required `handoffMode`
- **THEN** Horsepower rejects the request before creating a process, worker, run artifact, or implicit handoff

#### Scenario: Parallel requests inline mode
- **WHEN** the Captain requests `parallel` or `chain` with `handoffMode: inline`
- **THEN** Horsepower rejects the request without dispatching any child

### Requirement: Managed brief and report contract
A managed dispatch SHALL use a private Horsepower handoff workspace containing a Captain-produced brief, a worker-produced report, a relative-path manifest, and optional bounded attachments. Successful managed completion SHALL require a validated report artifact.

#### Scenario: Managed dispatch completes
- **WHEN** a managed worker produces a valid report within its assigned workspace
- **THEN** Horsepower validates its regular-file path, mode, UTF-8 content, size, SHA-256, media type, and producer metadata before marking the dispatch completed

#### Scenario: Managed report is missing
- **WHEN** execution otherwise succeeds without a valid managed report
- **THEN** Horsepower does not report successful managed completion

#### Scenario: Managed dispatch fails or is canceled
- **WHEN** a managed dispatch fails or receives semantic cancellation before producing a report
- **THEN** Horsepower records the truthful terminal state and explicit report absence without fabricating an artifact

### Requirement: Bounded opaque handoff references
Managed handoff tool output and webhook evidence SHALL expose only bounded summaries and opaque artifact references. It SHALL NOT expose absolute handoff paths, full report content, prompts, model output, or credentials.

#### Scenario: Captain receives managed result
- **WHEN** a managed report is validated
- **THEN** the tool result returns its artifact ID, SHA-256, byte count, media type, and bounded summary without returning the managed filesystem path

### Requirement: Captain-defined review campaign budget
Before the first reviewer dispatch in a review campaign, the Captain SHALL provide a positive finite dispatch budget and a fixed acceptance scope. Horsepower SHALL count review and corrective dispatches against that campaign and SHALL NOT permit a worker, verdict, recommendation, helper, finding disposition, or finding resolution to increase, reset, replace, or automatically continue the budget. Corrective dispatch SHALL additionally require an explicit accepted unresolved in-scope root cause before budget is consumed.

#### Scenario: Campaign consumes its budget
- **WHEN** the Captain explicitly dispatches a reviewer or corrective worker in a review campaign
- **THEN** Horsepower consumes one unit from the Captain-defined budget and records the dispatch under the campaign ID

#### Scenario: Campaign consumes its budget for review
- **WHEN** the Captain explicitly dispatches a reviewer in a review campaign
- **THEN** Horsepower consumes one unit from the Captain-defined budget and records the dispatch under the campaign ID

#### Scenario: Campaign consumes its budget for an accepted finding fix
- **WHEN** the Captain explicitly dispatches corrective work naming an accepted unresolved in-scope root cause in the same review campaign
- **THEN** Horsepower validates the correlation before consuming one unit and creating work

#### Scenario: Corrective dispatch lacks accepted finding authority
- **WHEN** corrective work names no root cause or names a pending, rejected, unclear, blocked, out-of-scope, resolved, unknown, or cross-campaign finding
- **THEN** Horsepower rejects the dispatch before consuming budget or creating work

#### Scenario: Reviewer rejects work
- **WHEN** a reviewer reports `NOT APPROVED` or recommends another worker
- **THEN** Horsepower returns that evidence to the Captain without changing finding disposition or automatically dispatching a fixer or another reviewer

#### Scenario: Campaign budget is exhausted
- **WHEN** another review or corrective dispatch would exceed the Captain-defined budget
- **THEN** Horsepower rejects it until the Captain ends the campaign, changes official scope, reports `blocked_needs_human`, or supplies a human-authorized budget increase with a non-empty reason

### Requirement: Review finding deduplication and scope stability
The Captain SHALL classify campaign findings by root cause against the declared acceptance scope. Additional examples, syntax variants, adversarial inputs, or reviewer restatements for an existing root cause SHALL NOT create a new finding identity, silently change its technical disposition, or expand campaign scope. Reviewer output SHALL remain evidence for Captain evaluation rather than implementation authority.

#### Scenario: Reviewer supplies another variant
- **WHEN** a later review reports a new reproduction of an already recorded root cause
- **THEN** Horsepower correlates it with the existing finding, preserves its current disposition and resolution state, appends bounded non-duplicate evidence, and leaves continuation judgment with the Captain

#### Scenario: New evidence materially conflicts with a disposition
- **WHEN** a duplicate occurrence supplies evidence that materially calls an existing accepted or rejected disposition into question
- **THEN** Horsepower surfaces the conflict for Captain judgment without automatically reopening, resolving, or dispatching work

#### Scenario: Reviewer expands acceptance scope
- **WHEN** a reviewer proposes a requirement outside the campaign's declared OpenSpec-grounded acceptance scope
- **THEN** Horsepower records it as out-of-scope evidence and does not authorize corrective dispatch or campaign-scope expansion from that proposal

#### Scenario: Reviewer success statement is the only evidence
- **WHEN** a reviewer states that a root cause is fixed without fresh Captain-observed targeted verification
- **THEN** Horsepower leaves the accepted finding unresolved

### Requirement: User-selected implementation campaign mode
Before the first work-producing action in an implementation campaign, Horsepower SHALL discover eligible unfinished changes from the current official OpenSpec project and the user SHALL explicitly select one discovered change, a non-empty canonical set of current unfinished OpenSpec task IDs, and either `multi_agent` or `main_agent`. Horsepower SHALL present the selected change's bounded task inventory, offer all unfinished tasks, unfinished tasks by section, or manually selected exact task IDs, and show the normalized tasks for confirmation before creating the campaign. Horsepower SHALL NOT require free-form change-ID entry, silently select a discovered change, infer scope or mode, persist either choice as a default, or reuse authorization across scope changes, task drift, campaigns, changes, or Pi processes. Arbitrary strings, numeric ranges, nonexistent IDs, and completed tasks SHALL NOT become campaign authority.

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
- **THEN** Horsepower rejects it before creating a run, worker, handoff, or task evidence and directs the user to the explicit discovered-change campaign selection flow

#### Scenario: One eligible change is discovered
- **WHEN** current-project discovery returns exactly one apply-ready change with unfinished tasks
- **THEN** Horsepower presents that change for explicit user confirmation and does not silently select its task scope or execution mode

#### Scenario: Multiple eligible changes are discovered
- **WHEN** current-project discovery returns multiple apply-ready changes with unfinished tasks
- **THEN** Horsepower presents a bounded deterministic selection list with stable change IDs and bounded progress context

#### Scenario: User cancels change selection
- **WHEN** the user cancels or dismisses the discovered-change picker
- **THEN** Horsepower creates no implementation campaign, run, worker, handoff, or task evidence

#### Scenario: Campaign scope changes
- **WHEN** a work-producing action falls outside the campaign's declared task scope or belongs to another OpenSpec change
- **THEN** Horsepower rejects it until the user explicitly starts or switches an implementation campaign for that discovered change and scope

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

### Requirement: Main-Agent execution enforcement
In `main_agent` mode Horsepower SHALL deny worker creation or advancement by default. It SHALL permit only a separately user-authorized reviewer budget with fixed acceptance scope; that authorization SHALL NOT permit implementers, researchers, testers, fixers, parallel/chain work, automatic continuation, or an execution-mode switch.

#### Scenario: Main Agent attempts ordinary delegation
- **WHEN** a Captain in `main_agent` mode requests a worker for implementation, research, testing, fixing, parallel, or chain work
- **THEN** Horsepower rejects the dispatch before consuming execution resources

#### Scenario: User authorizes bounded review
- **WHEN** the user explicitly grants a positive finite reviewer budget and acceptance scope for the current main-Agent campaign
- **THEN** Horsepower permits only reviewer dispatches within that authorization and consumes both reviewer authorization and review-campaign budget before worker creation

#### Scenario: Reviewer recommends a fixer
- **WHEN** an authorized reviewer returns `NOT APPROVED` or recommends corrective delegation
- **THEN** Horsepower creates no fixer and leaves implementation and fixes with the main Agent

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

### Requirement: Localized Captain-facing conclusions
Horsepower SHALL render its human-facing tool status, summary, and conclusion text in the effective `outputLocale`, which SHALL be `en` or `zh-CN`. Structured machine fields and internal worker artifacts SHALL remain stable and untranslated.

#### Scenario: Chinese output is effective
- **WHEN** project or global configuration resolves `outputLocale` to `zh-CN`
- **THEN** `horsepower_subagent` returns Chinese human-readable conclusions plus stable action, status, ID, digest, evidence, and artifact-reference fields and explicitly reports `outputLocale: "zh-CN"`

#### Scenario: Internal report is English
- **WHEN** a worker produces an English brief, report, reviewer result, or raw evidence under Chinese output configuration
- **THEN** Horsepower preserves that artifact unchanged while the Captain-facing principal conclusion remains Chinese

### Requirement: One-shot workers disable Skill discovery
Every `single`, `parallel`, and `chain` child SHALL run with Pi Skill discovery disabled by exactly one `--no-skills` argument and with no implicit `--skill` path. Explicit agent persona, task, model, thinking, tools, output bounds, and managed handoff behavior SHALL remain available.

#### Scenario: One-shot task starts
- **WHEN** the Captain dispatches a valid single task or a valid parallel or chain step
- **THEN** Horsepower starts the child with `--no-skills` and executes only the explicit task under its selected agent persona

#### Scenario: External workflow Skill is present
- **WHEN** a Skill in the child environment would otherwise require another planning, orchestration, delegation, or completion workflow
- **THEN** the one-shot child does not load the Skill and remains governed by Horsepower's explicit dispatch contract

### Requirement: User-owned model capability
Before spawning a one-shot or persistent worker, Horsepower SHALL use the user's resolved Pi model/thinking binding without contacting the upstream provider for a preflight probe. The user SHALL remain responsible for valid Pi authentication and model configuration.

#### Scenario: Dispatch uses configured binding
- **WHEN** dispatch resolves to a configured model/thinking combination
- **THEN** Horsepower creates the requested worker without a capability probe

#### Scenario: Worker rejects configured capability
- **WHEN** the actual worker reports an explicit model/thinking capability rejection
- **THEN** Horsepower reports the rejection without silently changing the binding or automatically retrying through a fallback

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
Every `single`, `parallel`, and `chain` dispatch SHALL emit ordered bounded progress through the active Pi tool update callback from authorization through exactly one terminal event. Progress SHALL distinguish accepted, starting, assistant, tool start/update/end, managed-handoff creation/report validation, completed, failed, and canceled stages as applicable. A parallel dispatch SHALL project one bounded parent summary and a stable simultaneously visible child state for every admitted invocation; interleaved events SHALL update only the child selected by authoritative invocation identity and SHALL NOT replace, erase, or reattribute another child's latest state. Horsepower SHALL normalize and redact worker events and SHALL NOT expose raw prompts, provider payloads, credentials, unbounded tool output, report bodies, or private handoff paths. Progress delivery failure SHALL NOT change worker execution or terminal truth.

#### Scenario: One-shot worker uses tools
- **WHEN** a worker emits assistant and tool lifecycle events while executing a valid one-shot dispatch
- **THEN** the user sees ordered non-empty bounded updates attributed to that worker before the final result

#### Scenario: Parallel workers emit interleaved progress
- **WHEN** two or more parallel workers make progress concurrently
- **THEN** the parent summary and every admitted child remain visible and each event updates only the stable child state matching its invocation identity without serializing the workers

#### Scenario: One parallel child becomes terminal
- **WHEN** a parallel child completes, fails, or is canceled while another child remains active
- **THEN** the terminal child retains its final visible state, the active child continues updating independently, and the parent counts reflect both states

#### Scenario: Progress contains sensitive or oversized fields
- **WHEN** raw Pi events contain prompts, credentials, private paths, provider payloads, or output beyond configured bounds
- **THEN** Horsepower redacts or omits those fields and emits only the normalized bounded event

#### Scenario: Tool update consumer fails
- **WHEN** Pi's partial-result callback throws or cannot render an update
- **THEN** Horsepower continues the dispatch, records bounded delivery evidence, and reports the worker's actual terminal status

### Requirement: Complete resolved worker identity
Before worker spawn, Horsepower SHALL construct an immutable identity from resolved runtime facts and SHALL include it in the tool title, every progress event, and terminal result. The identity SHALL contain dispatch name, agent name, agent role as the human-readable horse class/level, requested model slot, resolved model slot, concrete model, thinking level, handoff mode, and stable invocation ID; it SHALL add the opaque run ID after lifecycle creation. For a parallel dispatch, the operation-card projection SHALL retain the complete identity for every child in canonical input order for the lifetime of the parent tool call, bounded by the existing eight-child limit. Human labels SHALL use `outputLocale`, while names, roles, slots, model IDs, thinking values, modes, and IDs remain untranslated machine values.

#### Scenario: Single worker title is rendered
- **WHEN** a single dispatch resolves its agent and model slot
- **THEN** its visible title identifies the dispatch name, agent and role, requested-to-resolved slot mapping, concrete model, thinking level, and handoff mode before spawn

#### Scenario: Slot uses a fallback
- **WHEN** the requested slot resolves through a fallback to another slot
- **THEN** title and structured identity show both requested and resolved slots without hiding the fallback

#### Scenario: Parallel or chain identities are rendered
- **WHEN** a parent dispatch contains multiple invocations
- **THEN** Horsepower shows a bounded parent summary and a complete stable identity for each child

#### Scenario: Parallel events arrive out of child order
- **WHEN** child progress events interleave in an order different from the submitted task order
- **THEN** Horsepower preserves canonical child presentation order and correlates each update by stable invocation ID rather than arrival position

#### Scenario: Caller supplies misleading display text
- **WHEN** caller-provided names contain control characters, excessive text, or conflict with resolved agent/model facts
- **THEN** Horsepower bounds and sanitizes the human title while structured identity remains derived from authoritative resolved facts

### Requirement: Parallel operation-card state is bounded and terminally truthful
Horsepower SHALL maintain an observational per-tool-call projection for at most eight parallel children. The projection SHALL expose stable machine details for parent totals and each child's latest normalized operation, status, telemetry, and terminal state, and SHALL render equivalent bounded human-facing content in `en` or `zh-CN`. Projection state SHALL be discarded when the tool call settles and SHALL never become execution, lifecycle, campaign, handoff, or verification authority.

#### Scenario: Parallel dispatch is admitted
- **WHEN** a valid parallel dispatch admits multiple children
- **THEN** the visible parent summary reports total, pending or running, completed, failed, and canceled counts and presents every child in canonical input order

#### Scenario: Child telemetry changes
- **WHEN** one child receives newer authoritative usage or a newer eligible latest utterance
- **THEN** only that child's elapsed, usage, utterance, operation, and status snapshot changes while all other child snapshots remain intact

#### Scenario: Final result is rendered
- **WHEN** the parallel tool call reaches its first authoritative terminal settlement
- **THEN** the final projection and structured result agree on each child identity and known terminal outcome without fabricating missing usage or completion

#### Scenario: Projection exceeds display space
- **WHEN** eight children and their bounded identities or telemetry approach configured display limits
- **THEN** Horsepower applies deterministic per-field and aggregate bounds without omitting a child identity or exposing hidden raw content

#### Scenario: Rendering fails
- **WHEN** projection construction or Pi rendering throws
- **THEN** worker scheduling, execution, cancellation, managed-report validation, and first-terminal-wins truth remain unchanged

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

### Requirement: Captain technical disposition of review findings
Every in-scope review finding SHALL begin `pending` and SHALL receive an explicit Captain disposition of `accepted`, `rejected`, `needs_clarification`, or `blocked_needs_human` with a bounded technical rationale before it can authorize corrective work or permit campaign acceptance. Horsepower SHALL verify that the finding belongs to the current project, change, campaign, root cause, and fixed acceptance scope. Disposition actions SHALL be Captain-only and SHALL NOT dispatch work.

#### Scenario: Captain accepts a technically valid finding
- **WHEN** the Captain verifies a finding against the current codebase and records `accepted` with a technical rationale and optional supporting evidence
- **THEN** Horsepower marks the in-scope finding accepted and open without creating corrective work

#### Scenario: Captain rejects an invalid finding
- **WHEN** the Captain verifies that a suggestion is incorrect, incompatible, unnecessary, or outside the applicable requirement and records `rejected` with technical rationale
- **THEN** Horsepower preserves the finding and evidence as technically rejected and does not allow it to authorize corrective work

#### Scenario: Finding is unclear
- **WHEN** the Captain cannot establish the requested behavior or its relationship to acceptance scope and records `needs_clarification`
- **THEN** Horsepower blocks corrective dispatch and campaign acceptance for that finding until the Captain records a new explicit disposition

#### Scenario: Finding requires human judgment
- **WHEN** technical evaluation reveals an unresolved product, architecture, security, or scope decision and the Captain records `blocked_needs_human`
- **THEN** Horsepower blocks corrective dispatch and campaign acceptance without inferring a decision

#### Scenario: Worker attempts to disposition a finding
- **WHEN** a worker, reviewer, verdict, recommendation, or helper attempts to set or change a finding disposition
- **THEN** Horsepower rejects the action and preserves Captain authority

### Requirement: Evidence-backed review finding resolution
An accepted in-scope finding SHALL remain open until the Captain explicitly resolves it with fresh targeted verification evidence mapped to that root cause. Horsepower SHALL validate evidence freshness, successful command results or a concrete targeted waiver, evidence-reference integrity, and current finding correlation. Resolving a finding SHALL NOT dispatch another worker or consume review budget.

#### Scenario: Captain verifies an accepted fix
- **WHEN** the Captain inspects the current change and supplies fresh successful targeted verification mapped to an accepted open root cause
- **THEN** Horsepower records the finding resolved with bounded evidence and receipt time

#### Scenario: Targeted verification fails
- **WHEN** a resolution attempt contains a failed command, stale evidence, missing evidence reference, or evidence mapped to another root cause
- **THEN** Horsepower reports the actual evidence state and leaves the finding open

#### Scenario: Worker report is supplied without independent verification
- **WHEN** the Captain cites only a fixer or reviewer success report as resolution evidence
- **THEN** Horsepower treats it as supporting input and leaves the finding open

#### Scenario: Non-accepted finding is resolved
- **WHEN** a caller attempts to resolve a pending, rejected, unclear, blocked, out-of-scope, already resolved, unknown, or cross-campaign finding
- **THEN** Horsepower rejects the transition without changing review state

### Requirement: Review campaign acceptance requires adjudicated closure
Horsepower SHALL permit a review campaign to end `accepted` only when every in-scope finding has an explicit technical disposition and each accepted finding is resolved with fresh targeted evidence. Rejected findings with rationale are adjudicated; pending, needs-clarification, blocked-needs-human, or accepted-open findings prevent acceptance. Non-accepted campaign outcomes SHALL remain available without fabricating closure.

#### Scenario: All in-scope findings are adjudicated and closed
- **WHEN** every in-scope finding is either rejected with technical rationale or accepted and resolved with valid targeted evidence
- **THEN** the Captain may end the review campaign `accepted`

#### Scenario: Finding remains undecided or unresolved
- **WHEN** any in-scope finding is pending, needs clarification, blocked for human judgment, or accepted but open
- **THEN** Horsepower rejects an `accepted` campaign outcome and returns the blocking root-cause IDs and states

#### Scenario: Campaign cannot continue safely
- **WHEN** budget, scope, evidence, or human judgment prevents adjudicated closure
- **THEN** the Captain may end with `scope_changed`, `blocked_needs_human`, or `canceled` as applicable without claiming review acceptance

### Requirement: Bounded worker operation-card telemetry
Horsepower SHALL render stable attributed operation cards for one-shot and persistent dispatches with non-negative elapsed time, authoritative aggregate input/output token counts when available, and at most the latest completed privacy-safe worker utterance. Structured progress details SHALL retain bounded machine-stable telemetry fields while human formatting MAY be localized. Telemetry collection and rendering SHALL remain observational and SHALL NOT alter execution, managed handoff validation, persistent-worker lifetime, or terminal truth.

#### Scenario: Worker produces progress and usage
- **WHEN** an eligible worker dispatch emits normalized progress plus authoritative Pi input/output usage
- **THEN** its operation card identifies the existing worker identity and shows elapsed time, aggregate input tokens, aggregate output tokens, and the latest eligible utterance without guessing unavailable values

#### Scenario: Latest worker utterance changes
- **WHEN** a newer completed assistant utterance passes normalization
- **THEN** the card replaces the previous utterance with the newer bounded value rather than accumulating a transcript

#### Scenario: Telemetry is unavailable
- **WHEN** Pi supplies no authoritative input or output usage or no eligible assistant utterance
- **THEN** Horsepower omits the unavailable fields and preserves truthful execution status

#### Scenario: Progress callback or rendering fails
- **WHEN** telemetry normalization, progress callback, or operation-card rendering throws
- **THEN** the dispatch continues and reaches the same execution-derived and handoff-derived terminal result it would have reached without rendering

### Requirement: Human cancellation is observable and orphan-free
When a human cancels a blocking Horsepower dispatch wait, Horsepower SHALL settle the admitted invocation with structured `canceled` identity, SHALL NOT accept an absent managed report, and SHALL ensure the corresponding child/run is no longer active. Cancellation SHALL NOT reinterpret partial repository edits as accepted completion.

#### Scenario: Human presses Esc during a slow one-shot dispatch
- **WHEN** a one-shot worker has been admitted and the human cancels the Captain's blocking wait before worker completion
- **THEN** Horsepower returns or records the same run/invocation identity as `canceled`, terminates the child with bounded escalation, and leaves no hidden active execution

#### Scenario: Canceled managed worker has no report
- **WHEN** cancellation occurs before a managed worker writes and validates `report.md`
- **THEN** Horsepower records `reportPresent: false` or equivalent structured absence and never presents the handoff as completed

#### Scenario: Cancellation races successful completion
- **WHEN** worker completion and human cancellation occur concurrently
- **THEN** Horsepower preserves the first authoritative terminal settlement and never reports contradictory completed and canceled truth for the same invocation

### Requirement: Privacy-safe latest worker utterance
Horsepower SHALL derive the latest worker utterance only from completed eligible assistant text, normalize control characters and whitespace, redact credentials and private paths, truncate on a UTF-8 boundary to a documented small bound, and account for it within aggregate progress event and byte limits. Horsepower SHALL NOT project reasoning, partial text deltas, user/system prompts, raw provider payloads, unrestricted tool output, private handoff paths, full reports, credentials, or complete conversation history into an operation card.

#### Scenario: Eligible assistant utterance is safe
- **WHEN** a worker emits a completed assistant utterance containing ordinary bounded text
- **THEN** the newest normalized text may appear in the operation card as the latest utterance

#### Scenario: Assistant utterance contains sensitive or oversized content
- **WHEN** a completed assistant utterance contains credential-shaped data, absolute private paths, control characters, or text beyond the display bound
- **THEN** Horsepower redacts and UTF-8-safely truncates it before projection without forwarding the original bytes

#### Scenario: Raw or private event is observed
- **WHEN** a worker emits reasoning, partial deltas, prompts, provider metadata, tool results, a full managed report, or a private handoff path
- **THEN** Horsepower excludes that content from latest-utterance telemetry and operation-card details

#### Scenario: Progress limits are exhausted
- **WHEN** latest-utterance or telemetry updates would exceed the aggregate event or byte budget
- **THEN** Horsepower drops further observational updates without changing worker execution or terminal truth

### Requirement: Implementation campaign includes explicit test-and-gate confirmation
Before creating an implementation campaign, `/horsepower-campaign` SHALL load the current official OpenSpec test-and-gate plan, present the selected test intensity, gate strictness, every bounded concrete test case and gate consequence in the effective locale, and require affirmative user confirmation together with the normalized task scope and execution mode. Campaign authority SHALL snapshot the normalized plan digest and acceptance mappings for exactly one change and selected current tasks. Cancellation or failed plan confirmation SHALL create no campaign, replace no active campaign, and trigger no Captain turn.

#### Scenario: User confirms campaign and test plan
- **WHEN** the user reviews the current tasks, mode, testing profile, gate profile, concrete cases, and gates and affirmatively confirms the combined scope
- **THEN** Horsepower creates one campaign containing the official plan digest and starts exactly one kickoff under the existing delivery rules

#### Scenario: User rejects plan during campaign creation
- **WHEN** the user declines or cancels the test-and-gate confirmation
- **THEN** Horsepower creates no campaign, preserves any current campaign unchanged, and directs the user to revise the official OpenSpec plan

#### Scenario: Plan is absent or invalid
- **WHEN** the selected change has no current complete confirmed plan or Horsepower cannot parse and map it unambiguously
- **THEN** campaign creation fails before state mutation and reports the exact planning remediation

#### Scenario: Chinese campaign confirmation
- **WHEN** effective output locale is `zh-CN`
- **THEN** profile consequences, case explanations, gate explanations, confirmation, and diagnostics are Chinese while IDs, profile values, commands, paths, and acceptance references remain untranslated

### Requirement: Dispatch revalidates confirmed plan authority
Before any work-producing action consumes budget or creates a run, worker, or handoff, Horsepower SHALL reload the official test-and-gate plan and compare its normalized digest and selected-task acceptance mappings with the active implementation campaign snapshot. A missing, invalid, unconfirmed, broadened, weakened, or drifted plan SHALL revoke authorization until the user explicitly confirms a new campaign. Worker/reviewer recommendations and automatic continuation SHALL NOT update or renew test-and-gate authority.

#### Scenario: Plan remains current
- **WHEN** the current official plan digest and selected-task mappings equal the campaign snapshot
- **THEN** dispatch authorization may continue under the existing mode, task, slot, handoff, and budget rules

#### Scenario: Plan drifts before dispatch
- **WHEN** the current normalized plan or mapped acceptance differs from the campaign snapshot
- **THEN** Horsepower rejects the action before accounting or process creation and requires explicit user reconfirmation

#### Scenario: Reviewer recommends stronger tests
- **WHEN** a reviewer or worker recommends changing cases or gates
- **THEN** Horsepower treats the recommendation as advisory and does not alter campaign authority until official OpenSpec artifacts are revised and the user confirms a new campaign

#### Scenario: Automatic campaign continuation occurs
- **WHEN** eligible automatic Pi compaction continues an existing campaign
- **THEN** continuation carries only the already confirmed digest and still fails closed if the current official plan has drifted

### Requirement: Planned gates constrain completion evidence
At terminal completion, Horsepower SHALL reconcile the fresh claim-matched verification manifest not only with current acceptance scope but also with every applicable required gate and test-case mapping in the campaign-confirmed current plan. Planned advisory checks MAY be reported without blocking completion; a required check SHALL have fresh successful mapped evidence or an explicitly permitted valid waiver. Profile selection SHALL NOT allow stale, failed, worker-only, unmapped, or fabricated evidence.

#### Scenario: Every required planned gate passes
- **WHEN** current acceptance, required test cases, and required gates all map to fresh successful Captain-observed evidence
- **THEN** the existing completion gate may permit `completed`

#### Scenario: Required planned gate is missing
- **WHEN** a required gate or case has no fresh successful evidence and no plan-permitted valid waiver
- **THEN** Horsepower rejects completion and identifies the uncovered test-case or gate ID

#### Scenario: Advisory planned check fails
- **WHEN** a check explicitly confirmed as advisory fails
- **THEN** Horsepower reports the truthful failure but does not treat that check alone as satisfying or blocking a required acceptance claim unless another mandatory contract applies

#### Scenario: Plan permits an applicable waiver
- **WHEN** a required planned check has a documented waiver condition that currently applies
- **THEN** Horsepower still requires the existing concrete-reason and mapped-alternative-evidence waiver contract before completion
