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
Before dispatch, Horsepower SHALL validate the resolved model against Pi's model registry and validate the requested thinking level against model capabilities when registry access is available. Supported thinking identifiers SHALL include `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

#### Scenario: Unknown model
- **WHEN** a slot resolves to a model absent from Pi's registry
- **THEN** Horsepower rejects dispatch without reading or printing API keys

#### Scenario: Registry unavailable to CLI doctor
- **WHEN** CLI doctor cannot query Pi's model registry
- **THEN** it reports that model and thinking validation was skipped rather than claiming success

### Requirement: Custom capability slots
Horsepower SHALL accept custom slot IDs matching `[a-z][a-z0-9-]{0,31}` and optional fallbacks to other slots.

#### Scenario: Valid custom slot
- **WHEN** a user configures `vision` with a valid model binding
- **THEN** the captain can explicitly request `vision`

#### Scenario: Invalid custom slot ID
- **WHEN** a slot ID violates the required pattern
- **THEN** configuration validation rejects it and identifies the invalid ID
