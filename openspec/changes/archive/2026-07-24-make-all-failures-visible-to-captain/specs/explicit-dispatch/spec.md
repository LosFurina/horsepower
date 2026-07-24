## ADDED Requirements

### Requirement: Dispatch input failures identify the exact requested field
Before creating a run, worker, process, handoff, or consuming campaign or review budget, Horsepower SHALL validate each dispatch item and return the exact safe input path and requested value identity for an invalid agent, model slot, task, handoff mode, campaign correlation, or required field. For implementation dispatch guidance, the bundled Horsepower Skill SHALL show `agent: "coder"` explicitly and SHALL require `agent`, `workKind`, and `modelSlot` to remain independent explicit inputs.

#### Scenario: First parallel implementation item names an unknown agent
- **WHEN** the first parallel item omits `agent`, uses an unknown agent name, or uses a work kind in place of an agent name
- **THEN** Horsepower creates no child and returns a structured failure attributed to `$.tasks[0].agent` with safe available-agent remediation including `coder` for implementation work

#### Scenario: Parallel item names an unknown slot
- **WHEN** any parallel item supplies a missing or unknown `modelSlot`
- **THEN** Horsepower creates no child and returns the corresponding `$.tasks[index].modelSlot`, requested slot, and bounded available-slot remediation without deriving a slot from its agent or work kind

### Requirement: Dispatch failure results retain child identity
Every admitted one-shot dispatch failure SHALL return a bounded structured result containing action, run identity, stage, primary failure, and complete known child outcomes. Parallel and chain failure results SHALL identify a child by canonical index, name, agent, requested and resolved slot, model, thinking, invocation ID, and terminal state when those facts were resolved before failure.

#### Scenario: One parallel child fails to spawn
- **WHEN** one child process cannot spawn while another parallel child completes
- **THEN** the parent reports `failed`, preserves the successful child outcome, and identifies the failed child's canonical identity and `worker` stage cause

#### Scenario: Preflight fails before run creation
- **WHEN** dispatch validation fails before lifecycle creation
- **THEN** Horsepower returns a structured failed result with no fabricated run or child terminal identity

#### Scenario: Tool delivery or final rendering fails
- **WHEN** execution settles but final tool delivery or card rendering fails
- **THEN** Horsepower preserves the authoritative dispatch terminal result and exposes a bounded delivery diagnostic through an available fallback surface
