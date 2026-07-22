## MODIFIED Requirements

### Requirement: Captain-controlled E2E completion gate
Horsepower SHALL NOT permit a change to be reported `completed` from unit-test evidence alone, stale evidence, failed evidence, partial evidence presented as complete, evidence unrelated to its declared acceptance claim, or a worker/reviewer success statement that the Captain has not independently inspected and verified. The Captain SHALL provide a bounded verification manifest containing fresh command evidence mapped to the current OpenSpec acceptance scope, or an `e2eWaiver` with a concrete reason and fresh alternative evidence mapped to that scope when E2E is genuinely inapplicable. Horsepower SHALL validate the current OpenSpec context and scoped acceptance snapshot at report time and SHALL reject completion if the active scope has drifted, any scoped acceptance item is unchecked, or any evidence reference is missing or unsuccessful.

#### Scenario: Fresh Captain-selected E2E proves current acceptance
- **WHEN** the Captain reports `completed` with exact successful commands observed within the allowed freshness window, maps their evidence IDs to every acceptance item in the active OpenSpec task scope, and current OpenSpec validation and scope reconciliation succeed
- **THEN** the verification gate records bounded receipt and scope evidence and permits the Captain to report `completed`

#### Scenario: Captain supplies a valid mapped E2E waiver
- **WHEN** the Captain declares E2E inapplicable with a non-empty concrete reason and maps fresh bounded alternative evidence to every acceptance item in the active OpenSpec task scope
- **THEN** the verification gate records the waiver and current scope evidence and permits completion without misrepresenting unit tests as E2E

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

#### Scenario: Captain reports verified completion
- **WHEN** the Captain explicitly reports `completed` in valid current OpenSpec context and the fresh claim-matched completion gate passes
- **THEN** Horsepower records process-lifetime terminal runtime evidence and triggers configured change notification

#### Scenario: Legacy uncorrelated completion payload is used
- **WHEN** the Captain reports `completed` using bare E2E or waiver fields without freshness and acceptance mapping
- **THEN** Horsepower rejects the report with localized migration guidance and records no terminal state

#### Scenario: Captain reports a non-complete terminal state
- **WHEN** the Captain explicitly reports `blocked_needs_human`, `failed`, or `canceled`
- **THEN** Horsepower triggers configured change notification without requiring successful completion evidence and without implying that acceptance passed

#### Scenario: Assistant turn or worker report ends
- **WHEN** the main assistant finishes a turn or receives a successful worker/reviewer report without explicit verified terminal reporting
- **THEN** Horsepower sends no change-terminal notification and infers no terminal state
