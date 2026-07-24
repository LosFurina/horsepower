## ADDED Requirements

### Requirement: Persistent workers expose campaign observation identity
Active persistent campaign workers SHALL expose bounded campaign identity, active message identity, current status, next polling time, last substantive progress age, stall state, and authoritative telemetry through existing worker state and presentation surfaces.

#### Scenario: User lists active campaign workers
- **WHEN** `/horsepower-workers` is invoked while campaign-associated persistent workers exist
- **THEN** its durable snapshot shows bounded worker/campaign/message identity and current observation fields without exposing prompts, private paths, reports, credentials, reasoning, or raw provider output

### Requirement: Worker-list invocation is visibly acknowledged
`/horsepower-workers` SHALL provide visible localized success output in interactive TUI mode whether the persistent-worker list is populated or empty, and SHALL provide bounded fallback notification if durable append or rendering is unavailable.

#### Scenario: No persistent workers exist
- **WHEN** the user invokes `/horsepower-workers` with an empty process-lifetime inventory
- **THEN** Horsepower visibly reports that zero persistent workers exist and clarifies that one-shot children are outside this inventory

#### Scenario: Snapshot rendering fails
- **WHEN** the durable worker-list entry cannot be appended or rendered
- **THEN** Horsepower emits bounded localized fallback output and does not claim the snapshot was displayed

### Requirement: Persistent workers remain steerable during observation
Periodic observation SHALL not occupy the active message admission interface or prevent `status`, `read`, `steer`, `abort`, or `destroy` actions from addressing the stable worker identity.

#### Scenario: User steers an active worker
- **WHEN** the user provides steering for an unambiguous active campaign worker
- **THEN** Captain routes it to that worker without waiting for the next poll

#### Scenario: Natural-language target is ambiguous
- **WHEN** more than one active worker matches the requested name or role
- **THEN** Captain requests a `workerId` selection rather than guessing
