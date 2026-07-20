## ADDED Requirements

### Requirement: Captain-only dispatch
Only the main Pi agent SHALL be able to create or advance workers. Worker command lines and prompts SHALL prohibit nested delegation.

#### Scenario: Captain dispatches work
- **WHEN** the main agent calls `horsepower_subagent` with valid OpenSpec context and an explicit slot
- **THEN** Horsepower performs exactly the requested dispatch

#### Scenario: Worker attempts delegation
- **WHEN** a worker would otherwise have access to a delegation tool
- **THEN** the tool is excluded and no nested worker can be created

### Requirement: Explicit one-shot modes
Horsepower SHALL support `single`, `parallel`, and `chain` one-shot modes. Parallel input SHALL contain at most eight tasks and run at most four child processes concurrently.

#### Scenario: Parallel tasks are explicit
- **WHEN** the captain supplies multiple named tasks
- **THEN** Horsepower runs only those tasks and does not expand the request

#### Scenario: Chain step consumes prior output
- **WHEN** a chain step contains `{previous}`
- **THEN** Horsepower substitutes the previous successful step output before dispatch

#### Scenario: Chain step fails
- **WHEN** one chain step fails
- **THEN** Horsepower stops and does not run subsequent steps

### Requirement: Bounded one-shot output
Horsepower SHALL limit displayed one-shot output to 50 KiB per task while preserving the full bounded structured result details.

#### Scenario: Output exceeds display cap
- **WHEN** a task produces more than 50 KiB of text
- **THEN** displayed text is truncated with an omission notice and structured details retain the full captured result within configured bounds

### Requirement: No implicit expansion
Workflow helpers, fanout, debate, recommendations, and health fallback SHALL NOT create an additional worker.

#### Scenario: Helper recommends multiple workers
- **WHEN** a helper produces dispatch proposals
- **THEN** proposals remain inert until the captain explicitly dispatches each requested task
