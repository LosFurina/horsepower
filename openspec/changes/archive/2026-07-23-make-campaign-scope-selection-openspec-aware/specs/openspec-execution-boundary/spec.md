## ADDED Requirements

### Requirement: Bounded current OpenSpec task inventory
Horsepower SHALL derive implementation campaign choices from the selected apply-ready change's official current OpenSpec tasks artifact. The OpenSpec boundary SHALL return a bounded ordered inventory of numbered sections and canonical checkbox task IDs with descriptions and pending/complete state, plus a digest of the validated inventory, without writing the artifact or creating a parallel task store. It SHALL reject duplicate IDs, malformed task syntax, ambiguous inventory, unsupported bounds, invalid change context, and an inventory with no recognizable tasks.

#### Scenario: Valid current task inventory is loaded
- **WHEN** an apply-ready strictly valid change has an official tasks artifact using supported numbered headings and checkbox task lines
- **THEN** Horsepower returns its ordered sections, canonical task IDs, bounded descriptions, completion states, and inventory digest for campaign selection

#### Scenario: Task artifact path is discovered
- **WHEN** Horsepower loads campaign tasks for a selected change
- **THEN** it obtains the resolved task artifact path from official OpenSpec status output rather than assuming a repository-relative location

#### Scenario: Task inventory is malformed or ambiguous
- **WHEN** the official task artifact contains duplicate IDs, malformed task checkbox lines, tasks outside recognized sections, unsupported size/count bounds, or no recognizable tasks
- **THEN** Horsepower creates no campaign and reports bounded actionable OpenSpec compatibility evidence without guessing the intended tasks

#### Scenario: Task inventory is observation-only
- **WHEN** Horsepower reads or revalidates task inventory
- **THEN** it does not modify OpenSpec artifacts, task completion, planning state, or archive facts

### Requirement: Dispatch-time OpenSpec task revalidation
Before a work-producing dispatch creates a run, worker, handoff, or consumes implementation/review budget, Horsepower SHALL reload the current official task inventory and verify the request against the active campaign's change, project, canonical selected pending task IDs, and confirmed inventory snapshot. Selected-task completion, removal, renaming, description/section change, digest conflict, invalid OpenSpec context, or requested unselected task SHALL fail closed and require a new explicit campaign; Horsepower SHALL NOT silently add, refresh, or broaden authorization.

#### Scenario: Selected tasks remain current and pending
- **WHEN** every requested task ID remains unchanged, pending, selected by the active campaign, and owned by its current valid OpenSpec change
- **THEN** task revalidation permits campaign authorization to continue under existing mode and budget rules

#### Scenario: Selected task changed after confirmation
- **WHEN** a selected task is completed, removed, renumbered, moved, redescribed, or otherwise conflicts with the confirmed task snapshot
- **THEN** Horsepower rejects work before accounting or process creation and directs the user to create a new campaign

#### Scenario: Request includes an unselected or nonexistent task
- **WHEN** a dispatch requests a task ID outside the campaign's canonical selected IDs or absent from current OpenSpec tasks
- **THEN** Horsepower rejects the request without extending campaign authority

#### Scenario: Unselected task changes
- **WHEN** only a task outside the campaign's selected scope changes and every selected task remains identical and pending
- **THEN** Horsepower may continue authorizing the unchanged selected scope without treating unrelated drift as new authority
