## MODIFIED Requirements

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

## ADDED Requirements

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
