## ADDED Requirements

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
