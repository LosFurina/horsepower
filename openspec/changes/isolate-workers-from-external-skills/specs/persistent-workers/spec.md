## MODIFIED Requirements

### Requirement: Persistent RPC worker process
Each persistent worker SHALL run as a separate `pi --mode rpc --no-session --no-skills` child with `shell: false`, the resolved model and thinking level, a private prompt file, and all delegation tools excluded. Horsepower SHALL NOT pass an implicit `--skill` path or provide a configuration escape hatch that enables Skill discovery for persistent workers.

#### Scenario: Worker starts successfully
- **WHEN** Pi acknowledges the startup state request
- **THEN** the worker transitions from `starting` to `idle` with its explicit persona, prompt, tools, model, and thinking configuration intact and with no discovered Skills loaded

#### Scenario: Startup fails
- **WHEN** startup RPC fails
- **THEN** Horsepower kills and removes the child and cleans temporary prompt resources

#### Scenario: External Skill exists
- **WHEN** a global, project, settings, package, or extension-contributed Skill is visible in the worker's environment
- **THEN** Pi Skill discovery remains disabled and the worker does not receive that Skill's instructions
