## ADDED Requirements

### Requirement: Active one-shot dispatches publish safe observational cards
Horsepower SHALL publish bounded active one-shot worker projections from canonical admission/progress events into a process-local observational inventory and SHALL remove them after authoritative tool settlement.

#### Scenario: One-shot child is admitted
- **WHEN** a single, parallel, or chain child becomes active
- **THEN** its safe identity and progress card become available to the unified worker drawer without exposing task prompts or creating terminal authority

#### Scenario: One-shot tool settles
- **WHEN** the enclosing one-shot tool execution reaches authoritative settlement
- **THEN** all associated active one-shot projections are removed even if observational rendering or cleanup reports degradation
