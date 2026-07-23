## ADDED Requirements

### Requirement: Post-compaction OpenSpec revalidation
Immediately before enqueueing a Horsepower post-compaction continuation, the runtime SHALL use the supported official OpenSpec boundary to verify that the same change remains apply-ready and strictly valid, the active campaign's exact selected task IDs remain present, ordered, pending, and snapshot-equivalent, and the current inventory digest matches. The runtime SHALL repeat normal dispatch-time authorization before any later work-producing action and SHALL NOT repair or reinterpret drift automatically.

#### Scenario: Official scope is unchanged
- **WHEN** the active campaign's change, selected task order, descriptions, sections, pending states, and inventory digest still match current official OpenSpec facts
- **THEN** post-compaction continuation may proceed under the existing user authorization

#### Scenario: Selected task changed or completed
- **WHEN** a selected task is missing, reordered, completed, renamed, moved to another section, or otherwise differs from the campaign snapshot
- **THEN** Horsepower suppresses continuation and requires a fresh user-selected campaign rather than inferring a replacement scope

#### Scenario: OpenSpec context is invalid
- **WHEN** official OpenSpec status, doctor, strict validation, instructions, project ownership, or supported version checks fail
- **THEN** Horsepower suppresses continuation with bounded actionable evidence and changes no OpenSpec fact

#### Scenario: Drift occurs after continuation is queued
- **WHEN** official scope changes between continuation enqueue and a work-producing dispatch
- **THEN** existing dispatch-time revalidation rejects the action before worker, run, handoff, or budget side effects
