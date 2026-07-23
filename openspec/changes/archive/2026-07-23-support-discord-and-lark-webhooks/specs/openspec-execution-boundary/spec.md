## MODIFIED Requirements

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
