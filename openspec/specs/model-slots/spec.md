# model-slots Specification

## Purpose
TBD - created by archiving change horsepower-alpha1. Update Purpose after archive.
## Requirements
### Requirement: Required capability slots
Horsepower SHALL require configured `judgment`, `craft`, and `utility` capability slots before creating or advancing work. It SHALL provide built-in fallback relationships `speed -> utility` and `context -> judgment` when users do not override them.

#### Scenario: Required slots configured
- **WHEN** all three required slots contain valid model and thinking bindings
- **THEN** Horsepower accepts the slot configuration

#### Scenario: Required slot missing
- **WHEN** any required slot is absent after global and project configuration are merged
- **THEN** Horsepower rejects advancing work with a precise missing-slot error

### Requirement: Explicit slot selection
Every one-shot task, chain step, and persistent worker creation SHALL name `modelSlot`; Horsepower SHALL NOT silently select a slot from an agent role or task type.

#### Scenario: Dispatch names a slot
- **WHEN** the captain dispatches work with a configured `modelSlot`
- **THEN** Horsepower resolves and reports the requested slot, resolved slot, concrete model, thinking level, and fallback path

#### Scenario: Dispatch omits a slot
- **WHEN** a creation or one-shot dispatch omits `modelSlot`
- **THEN** Horsepower rejects it before spawning a process

### Requirement: Deterministic configuration precedence and revision
Horsepower SHALL merge project bindings over global bindings, preserve unmentioned global bindings, detect fallback cycles, and compute a deterministic SHA-256 revision from normalized effective configuration.

#### Scenario: Project override resolves
- **WHEN** the project overrides one global slot
- **THEN** only that slot changes and the effective revision reflects the merged configuration

#### Scenario: Fallback cycle exists
- **WHEN** configured fallbacks form a cycle
- **THEN** Horsepower rejects resolution and reports the complete cycle path

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

### Requirement: Custom capability slots
Horsepower SHALL accept custom slot IDs matching `[a-z][a-z0-9-]{0,31}` and optional fallbacks to other slots.

#### Scenario: Valid custom slot
- **WHEN** a user configures `vision` with a valid model binding
- **THEN** the captain can explicitly request `vision`

#### Scenario: Invalid custom slot ID
- **WHEN** a slot ID violates the required pattern
- **THEN** configuration validation rejects it and identifies the invalid ID

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
