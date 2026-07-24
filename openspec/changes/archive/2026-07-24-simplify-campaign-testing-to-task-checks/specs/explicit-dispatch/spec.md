## MODIFIED Requirements

### Requirement: Implementation campaign includes explicit testing-guidance confirmation
Before creating an implementation campaign, `/horsepower-campaign` SHALL present the exact selected change, normalized current task scope, selected task descriptions and task-local checks, and execution mode; ask the user for one non-empty bounded testing-intensity prompt; and require affirmative combined confirmation. Campaign authority SHALL snapshot the normalized prompt and exact selected task/check records for one change. Horsepower SHALL NOT silently select, infer, reuse, or constrain the prompt to a fixed testing profile. Cancellation or failed confirmation SHALL create no campaign, replace no active campaign, and trigger no Captain turn.

#### Scenario: User confirms campaign testing guidance
- **WHEN** the user reviews the current tasks, checks, mode, and normalized testing-intensity prompt and affirmatively confirms the combined scope
- **THEN** Horsepower creates one campaign containing that exact bounded guidance and starts exactly one kickoff under the existing delivery rules

#### Scenario: User cancels testing prompt or confirmation
- **WHEN** the user cancels, supplies an empty or invalid prompt, or declines combined confirmation
- **THEN** Horsepower creates no campaign, preserves any current campaign unchanged, and starts no Captain turn

#### Scenario: Selected task has no local check
- **WHEN** one or more selected tasks contain no `Check:` child bullet
- **THEN** Horsepower explicitly presents `none` for those tasks without blocking confirmation

#### Scenario: Chinese campaign confirmation
- **WHEN** effective output locale is `zh-CN`
- **THEN** human-facing prompts, check labels, confirmation, and diagnostics are Chinese while change IDs, task IDs, commands, paths, modes, and user-authored check text remain untranslated

### Requirement: Dispatch revalidates confirmed task and testing guidance authority
Before any work-producing action consumes budget or creates a run, worker, or handoff, Horsepower SHALL reload the official selected tasks and compare their IDs, descriptions, sections, pending states, ordering, and task-local checks with the active implementation campaign snapshot. A removed, completed, broadened, or drifted selected task or check SHALL revoke authorization until the user explicitly confirms a new campaign. The confirmed testing-intensity prompt SHALL remain immutable for the campaign and worker/reviewer recommendations or automatic continuation SHALL NOT alter it.

#### Scenario: Tasks and checks remain current
- **WHEN** the current official selected task/check snapshot equals campaign authority
- **THEN** dispatch authorization may continue under the existing mode, task, slot, handoff, budget, and confirmed testing guidance

#### Scenario: Task check drifts before dispatch
- **WHEN** a selected task-local check is added, removed, reordered, or changed
- **THEN** Horsepower rejects the action before accounting or process creation and requires explicit campaign reconfirmation

#### Scenario: Reviewer recommends different testing
- **WHEN** a reviewer or worker recommends broader, narrower, or different tests
- **THEN** Horsepower treats the recommendation as advisory and does not mutate campaign authority or the confirmed prompt

#### Scenario: Automatic campaign continuation occurs
- **WHEN** eligible automatic Pi compaction continues an existing campaign
- **THEN** continuation carries only the already confirmed prompt and selected task/check authority and still fails closed on official task drift

### Requirement: Task checks guide completion evidence
At terminal completion, Horsepower SHALL reconcile fresh claim-matched Captain-observed evidence with current selected task acceptance and the confirmed task-local checks. A selected task check requiring a command or observable outcome SHALL have fresh matching evidence before completion. When a selected task has no check, Horsepower SHALL still require fresh evidence appropriate to the current task. The testing-intensity prompt SHALL guide execution breadth but SHALL NOT waive platform invariants or independently count as completion evidence.

#### Scenario: Every selected task check is evidenced
- **WHEN** current selected task acceptance and every concrete task-local check map to fresh successful Captain-observed evidence
- **THEN** the existing completion gate may permit `completed`

#### Scenario: Required task check lacks evidence
- **WHEN** a current selected task check has no fresh matching evidence
- **THEN** Horsepower rejects completion and identifies the uncovered task and check

#### Scenario: Selected task has no check
- **WHEN** a selected task has no task-local check
- **THEN** Captain supplies fresh task-appropriate evidence without fabricating a planned check or treating worker claims alone as sufficient

#### Scenario: Prompt requests weak testing
- **WHEN** the confirmed testing-intensity prompt asks for minimal or no testing
- **THEN** Horsepower may limit discretionary test breadth but continues enforcing official OpenSpec validity, privacy, security, compatibility, scope, lifecycle truth, and claim-matched terminal evidence

## REMOVED Requirements

### Requirement: Implementation campaign includes explicit test-and-gate confirmation
**Reason**: Replaced by combined confirmation of task-local checks and a bounded free-form testing-intensity prompt.
**Migration**: Remove profile and plan-entry presentation; confirm exact tasks, checks, mode, and user prompt.

### Requirement: Dispatch revalidates confirmed plan authority
**Reason**: Independent plan authority is removed.
**Migration**: Revalidate selected official tasks and their checks through task inventory identity.

### Requirement: Planned gates constrain completion evidence
**Reason**: `TC-*` and `G-*` no longer define completion claims.
**Migration**: Match fresh Captain evidence to selected task acceptance and task-local checks.
