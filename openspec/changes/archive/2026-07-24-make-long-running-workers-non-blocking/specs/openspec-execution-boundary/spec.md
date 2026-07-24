## ADDED Requirements

### Requirement: Polling interval participates in campaign authority
The exact confirmed `pollIntervalSeconds` SHALL be part of implementation campaign authority, confirmation, persistence, scope digest, and drift comparison. Horsepower SHALL not change it within an active campaign or infer a new value after compaction.

#### Scenario: Campaign is confirmed
- **WHEN** the user confirms change, selected tasks/checks, execution mode, testing guidance, and polling interval
- **THEN** the resulting campaign binds the exact positive integer polling interval with those other scope facts

#### Scenario: Polling interval would change
- **WHEN** execution attempts to use a polling interval different from the active campaign snapshot
- **THEN** Horsepower fails closed and requires fresh campaign authorization

### Requirement: Automatic continuation resumes observation without creating authority
Eligible automatic compaction continuation SHALL revalidate and reuse the same campaign polling interval and active worker observation identities. It SHALL not create workers, resend tasks, reset stall episodes, alter the interval, or claim settlement.

#### Scenario: Eligible automatic compaction completes
- **WHEN** the same process-local active campaign and workers survive an eligible automatic compaction
- **THEN** Horsepower resumes bounded observation using the exact authorized interval after lifecycle revalidation

#### Scenario: Worker or campaign identity drifted
- **WHEN** continuation revalidation finds replaced campaign authority, missing or replaced worker/message identity, project/session replacement, terminal state, or pending user work
- **THEN** Horsepower suppresses automatic observation continuation without recreating or resending work
