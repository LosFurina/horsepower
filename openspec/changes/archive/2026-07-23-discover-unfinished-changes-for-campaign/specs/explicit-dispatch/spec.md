## MODIFIED Requirements

### Requirement: User-selected implementation campaign mode
Before the first work-producing action in an implementation campaign, Horsepower SHALL discover eligible unfinished changes from the current official OpenSpec project and the user SHALL explicitly select one discovered change, a non-empty task scope, and either `multi_agent` or `main_agent`. Horsepower SHALL NOT require free-form change-ID entry, silently select a discovered change, infer scope or mode, persist either choice as a default, or reuse authorization across scope changes, campaigns, changes, or Pi processes.

#### Scenario: Campaign has no user choice
- **WHEN** the Captain attempts a work-producing action without a matching active implementation campaign
- **THEN** Horsepower rejects it before creating a run, worker, handoff, or task evidence and directs the user to the explicit campaign selection flow

#### Scenario: One eligible change is discovered
- **WHEN** current-project discovery returns exactly one apply-ready change with unfinished tasks
- **THEN** Horsepower presents that change for explicit user confirmation and does not silently select its task scope or execution mode

#### Scenario: Multiple eligible changes are discovered
- **WHEN** current-project discovery returns multiple apply-ready changes with unfinished tasks
- **THEN** Horsepower presents a bounded deterministic selection list with stable change IDs and bounded progress context

#### Scenario: User cancels change selection
- **WHEN** the user cancels or dismisses the discovered-change picker
- **THEN** Horsepower creates no implementation campaign, run, worker, handoff, or task evidence

#### Scenario: Campaign scope changes
- **WHEN** a work-producing action falls outside the campaign's declared task scope or belongs to another OpenSpec change
- **THEN** Horsepower rejects it until the user explicitly starts or switches an implementation campaign for that discovered change and scope

#### Scenario: Observation or cleanup occurs
- **WHEN** the Captain or user performs status, list, read, doctor, abort, destroy, or handoff inspection/cleanup
- **THEN** Horsepower permits the operation without requiring an implementation campaign
