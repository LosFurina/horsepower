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
Before the first reviewer dispatch in a review campaign, the Captain SHALL provide a positive finite dispatch budget and a fixed acceptance scope. Horsepower SHALL count review and corrective dispatches against that campaign and SHALL NOT permit a worker, verdict, recommendation, or helper to increase, reset, replace, or automatically continue the budget.

#### Scenario: Campaign consumes its budget
- **WHEN** the Captain explicitly dispatches a reviewer or corrective worker in a review campaign
- **THEN** Horsepower consumes one unit from the Captain-defined budget and records the dispatch under the campaign ID

#### Scenario: Reviewer rejects work
- **WHEN** a reviewer reports `NOT APPROVED` or recommends another worker
- **THEN** Horsepower returns that evidence to the Captain without automatically dispatching a fixer or another reviewer

#### Scenario: Campaign budget is exhausted
- **WHEN** another review or corrective dispatch would exceed the Captain-defined budget
- **THEN** Horsepower rejects it until the Captain ends the campaign, changes official scope, reports `blocked_needs_human`, or supplies a human-authorized budget increase with a non-empty reason

### Requirement: Review finding deduplication and scope stability
The Captain SHALL classify campaign findings by root cause against the declared acceptance scope. Additional examples, syntax variants, or adversarial inputs for an existing root cause SHALL NOT create a new finding identity or silently expand campaign scope.

#### Scenario: Reviewer supplies another variant
- **WHEN** a later review reports a new reproduction of an already recorded root cause
- **THEN** Horsepower correlates it with the existing finding and leaves continuation judgment with the Captain

#### Scenario: Reviewer expands acceptance scope
- **WHEN** a reviewer proposes a requirement outside the campaign's declared OpenSpec-grounded acceptance scope
- **THEN** Horsepower records it as out-of-scope evidence and does not authorize another dispatch from that proposal

### Requirement: User-selected implementation campaign mode
Before the first work-producing action in an implementation campaign, the user SHALL explicitly select `multi_agent` or `main_agent` for one change ID and non-empty task scope. Horsepower SHALL NOT infer, persist as a default, or reuse that choice across scope changes, campaigns, changes, or Pi processes.

#### Scenario: Campaign has no user choice
- **WHEN** the Captain attempts a work-producing action without a matching active implementation campaign
- **THEN** Horsepower rejects it before creating a run, worker, handoff, or task evidence and returns the two user choices

#### Scenario: Campaign scope changes
- **WHEN** a work-producing action falls outside the campaign's declared task scope or belongs to another OpenSpec change
- **THEN** Horsepower rejects it until the user explicitly starts or switches an implementation campaign for that scope

#### Scenario: Observation or cleanup occurs
- **WHEN** the Captain or user performs status, list, read, doctor, abort, destroy, or handoff inspection/cleanup
- **THEN** Horsepower permits the operation without requiring an implementation campaign

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
In `multi_agent` mode Horsepower SHALL allow only explicit Captain dispatches and SHALL keep all creation, slot, budget, and acceptance authority with the Captain. Substantive Captain-direct work SHALL require a non-empty recorded reason, while small coordination, OpenSpec bookkeeping, integration, conflict resolution, and verification MAY remain Captain-direct without another user prompt.

#### Scenario: Captain explicitly delegates substantive work
- **WHEN** an active multi-Agent campaign contains the requested task scope and the Captain submits a valid explicit dispatch
- **THEN** Horsepower performs only that dispatch under existing slot, handoff, and review-budget rules

#### Scenario: Captain directly performs substantive work
- **WHEN** the Captain elects not to delegate substantive in-scope work in multi-Agent mode
- **THEN** Horsepower requires a non-empty reason in campaign evidence without changing the user's mode or prompting again

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
