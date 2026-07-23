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
Every one-shot task, chain step, and persistent worker creation SHALL name `modelSlot`; Horsepower SHALL NOT silently select or derive a slot from an agent name, agent role, task type, `workKind`, prompt, or agent metadata. The requested slot SHALL resolve from the current configured, custom, or built-in fallback slot registry.

#### Scenario: Dispatch names a slot
- **WHEN** the captain dispatches work with a configured or built-in fallback `modelSlot`
- **THEN** Horsepower resolves and reports the requested slot, resolved slot, concrete model, thinking level, and fallback path

#### Scenario: Dispatch omits a slot
- **WHEN** a creation or one-shot dispatch omits `modelSlot`
- **THEN** Horsepower rejects it before spawning a process

#### Scenario: Captain derives a slot from work kind or agent name
- **WHEN** a dispatch requests an unknown slot such as `test` because `workKind` is `test` or the agent is `tester`
- **THEN** Horsepower rejects it before capability accounting, run, handoff, or worker creation; lists the bounded current available slot IDs; and explains that slot names must not be derived from agent or work-kind names

#### Scenario: Tester uses an explicit existing capability slot
- **WHEN** a dispatch names `agent=tester`, `workKind=test`, and `modelSlot=craft` and `craft` is currently configured
- **THEN** Horsepower resolves `craft` normally without consulting any agent-to-slot recommendation mapping

### Requirement: Deterministic configuration precedence and revision
Horsepower SHALL merge project bindings over global bindings, preserve unmentioned global bindings, detect fallback cycles, and compute a deterministic SHA-256 revision from normalized effective configuration.

#### Scenario: Project override resolves
- **WHEN** the project overrides one global slot
- **THEN** only that slot changes and the effective revision reflects the merged configuration

#### Scenario: Fallback cycle exists
- **WHEN** configured fallbacks form a cycle
- **THEN** Horsepower rejects resolution and reports the complete cycle path

### Requirement: Model and thinking validation
Before accepting setup configuration, Horsepower SHALL validate the resolved model against the current Pi model catalog and validate authoritative exact thinking metadata when present. Horsepower SHALL NOT contact the upstream provider during setup or before dispatch; the user is responsible for valid Pi authentication and model configuration. Supported Horsepower thinking identifiers SHALL include `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

#### Scenario: Unknown model
- **WHEN** a slot resolves to a model absent from Pi's current model catalog
- **THEN** Horsepower rejects configuration or dispatch without reading or printing API keys

#### Scenario: Registry unavailable to CLI doctor
- **WHEN** CLI doctor cannot query Pi's model registry
- **THEN** it reports that model and thinking validation was skipped rather than claiming success

#### Scenario: Model has unknown exact levels
- **WHEN** Pi reports only that a model supports reasoning but does not authoritatively enumerate accepted thinking values
- **THEN** Horsepower accepts the user's selected Horsepower thinking identifier without probing upstream

#### Scenario: Upstream capability is not preflighted
- **WHEN** configuration or dispatch requests a Pi-visible model/thinking combination
- **THEN** Horsepower preserves the user selection and does not probe, silently lower thinking, or change models

### Requirement: Custom capability slots
Horsepower SHALL accept custom slot IDs matching `[a-z][a-z0-9-]{0,31}` and optional fallbacks to other slots.

#### Scenario: Valid custom slot
- **WHEN** a user configures `vision` with a valid model binding
- **THEN** the captain can explicitly request `vision`

#### Scenario: Invalid custom slot ID
- **WHEN** a slot ID violates the required pattern
- **THEN** configuration validation rejects it and identifies the invalid ID

### Requirement: Transactional required-slot setup
Horsepower SHALL provide guided and explicit setup for `judgment`, `craft`, and `utility`, validate all three bindings locally before writing, and atomically preserve the previous configuration if any selection is unknown, authoritatively excluded, canceled, or cannot be committed.

#### Scenario: Guided setup succeeds
- **WHEN** the user chooses a visible model and a currently supported thinking level for every required slot
- **THEN** Horsepower atomically writes all three bindings and reports the effective configuration revision

#### Scenario: One slot fails validation
- **WHEN** any selected required-slot combination is unsupported or inconclusive
- **THEN** Horsepower writes none of the proposed bindings and preserves the prior configuration exactly

#### Scenario: Explicit non-interactive setup succeeds
- **WHEN** automation supplies all required Pi-visible bindings
- **THEN** Horsepower writes the configuration transactionally without interactive prompts
