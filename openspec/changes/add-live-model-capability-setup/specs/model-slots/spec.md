## MODIFIED Requirements

### Requirement: Model and thinking validation
Before accepting setup configuration or dispatching work, Horsepower SHALL validate the resolved model against the current Pi model catalog and require current supported evidence for the exact requested thinking level. The boolean Pi `reasoning` property SHALL NOT be interpreted as support for every thinking level. Supported Horsepower thinking identifiers SHALL include `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, while provider-specific accepted values SHALL be established by authoritative exact metadata or bounded live probing.

#### Scenario: Unknown model
- **WHEN** a slot resolves to a model absent from Pi's current model catalog
- **THEN** Horsepower rejects configuration or dispatch without reading or printing API keys

#### Scenario: Registry unavailable to CLI doctor
- **WHEN** CLI doctor cannot query Pi's model registry
- **THEN** it reports that model and thinking validation was skipped rather than claiming success

#### Scenario: Reasoning model has unknown exact levels
- **WHEN** Pi reports only that a model supports reasoning but does not authoritatively enumerate accepted thinking values
- **THEN** Horsepower treats each exact level as unverified until a live probe succeeds

#### Scenario: Exact combination is not currently verified
- **WHEN** configuration or dispatch requests a model/thinking combination without fresh supported evidence
- **THEN** Horsepower probes it or rejects it as inconclusive without silently lowering thinking or changing models

## ADDED Requirements

### Requirement: Transactional required-slot setup
Horsepower SHALL provide guided and explicit setup for `judgment`, `craft`, and `utility`, validate all three model/thinking bindings before writing, and atomically preserve the previous configuration if any selection is unknown, unsupported, inconclusive, canceled, or cannot be committed.

#### Scenario: Guided setup succeeds
- **WHEN** the user chooses a visible model and a currently supported thinking level for every required slot
- **THEN** Horsepower atomically writes all three bindings and reports the effective configuration revision

#### Scenario: One slot fails validation
- **WHEN** any selected required-slot combination is unsupported or inconclusive
- **THEN** Horsepower writes none of the proposed bindings and preserves the prior configuration exactly

#### Scenario: Explicit non-interactive setup succeeds
- **WHEN** automation supplies all required bindings and live validation succeeds for every combination
- **THEN** Horsepower writes the configuration transactionally without interactive prompts
