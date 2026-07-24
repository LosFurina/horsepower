## ADDED Requirements

### Requirement: Unified worker presentation retains reusable persistent workers
Horsepower SHALL include all process-lifetime persistent workers in the unified worker drawer, including running, idle, failed, and canceled states retained by the manager, while preserving existing explicit destroy and process-cleanup semantics.

#### Scenario: Persistent worker message completes
- **WHEN** a persistent worker returns to idle after message settlement
- **THEN** the unified drawer continues to show its stable worker identity and reusable idle status

### Requirement: Pi drawer does not expose worker controls
The worker drawer SHALL be read-only and SHALL not provide user-accessible send, steer, abort, destroy, retry, or lifecycle controls. Captain Horsepower tools and external CLI control remain separate interfaces.

#### Scenario: User views a worker ID
- **WHEN** a user sees a persistent worker in the drawer
- **THEN** the ID is informational and no drawer action can mutate that worker
