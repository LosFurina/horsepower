## MODIFIED Requirements

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
