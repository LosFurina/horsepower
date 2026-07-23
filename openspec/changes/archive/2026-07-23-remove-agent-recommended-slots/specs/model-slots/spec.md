## MODIFIED Requirements

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
