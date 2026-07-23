# agent-catalog Specification

## Purpose
TBD - created by archiving change horsepower-alpha1. Update Purpose after archive.
## Requirements
### Requirement: Model-neutral agent definitions
Horsepower SHALL load agent definitions that describe role, tools, standards, and prompt without binding a concrete provider, model, or recommended capability slot. Agent metadata SHALL NOT select, recommend, constrain, or otherwise create a second authority for dispatch `modelSlot`.

#### Scenario: Bundled definition loads
- **WHEN** a valid bundled agent definition is discovered
- **THEN** Horsepower exposes its role metadata without a concrete model binding or recommended-slot mapping

#### Scenario: Definition binds a model
- **WHEN** an agent definition contains a concrete `model` field
- **THEN** Horsepower rejects the definition with its source path

#### Scenario: Legacy definition recommends slots
- **WHEN** an agent definition contains the removed `recommendedSlots` field
- **THEN** Horsepower rejects the definition with source-attributed migration guidance to remove the field and keep `modelSlot` explicit at dispatch

### Requirement: Deterministic agent precedence
Horsepower SHALL resolve project definitions over global definitions and global definitions over bundled definitions, with deterministic ordering.

#### Scenario: Project agent overrides bundled agent
- **WHEN** project and bundled definitions share a name
- **THEN** the project definition is selected

### Requirement: Safe tool allowlists
Horsepower SHALL honor explicit agent tool allowlists while removing every known delegation tool. An explicit allowlist that becomes empty SHALL launch the worker with no tools.

#### Scenario: Delegation tools listed
- **WHEN** an agent allowlist includes `horsepower`, `horsepower_subagent`, or `subagent`
- **THEN** those tools are removed before process launch

#### Scenario: All tools excluded
- **WHEN** every explicitly allowed tool is a delegation tool
- **THEN** the worker launches with `--no-tools`
