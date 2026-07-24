## ADDED Requirements

### Requirement: Campaigns configure a polling interval
Before implementation campaign confirmation, Horsepower SHALL prompt for a positive-integer worker polling interval in seconds, SHALL resolve accepted default input to 30 seconds, and SHALL include the resolved value in the immutable combined confirmation and campaign scope digest.

#### Scenario: User accepts the default interval
- **WHEN** the user accepts the polling prompt without entering a custom value
- **THEN** Horsepower confirms and stores `pollIntervalSeconds=30`

#### Scenario: User enters a valid interval
- **WHEN** the user enters a positive integer number of seconds
- **THEN** Horsepower confirms and stores that exact integer without silent coercion

#### Scenario: User enters an invalid interval
- **WHEN** the user enters zero, a negative value, a fraction, non-numeric input, or a value outside safe timer representation
- **THEN** Horsepower rejects it with localized remediation and does not create campaign authority

### Requirement: Long-running campaign work is admitted without blocking Captain
Horsepower SHALL use persistent workers with `send(wait=false)` for campaign work expected to exceed one polling interval, multi-agent implementation/test/review work, externally waiting work, steerable work, or work that previously stalled. Admission SHALL return stable worker/message identities without waiting for settlement.

#### Scenario: Multi-agent campaign work is dispatched
- **WHEN** Captain delegates campaign implementation to multiple agents
- **THEN** each worker is created and sent work asynchronously and Captain regains control after admissions settle

#### Scenario: Short bounded work uses one-shot
- **WHEN** work is demonstrably short, bounded, non-steerable, and not expected to exceed one polling interval
- **THEN** Captain may use one-shot dispatch without violating campaign policy

### Requirement: Runtime periodically probes active campaign workers
Horsepower SHALL use runtime-owned process-local timers to probe existing bounded persistent worker state at the confirmed interval and SHALL invalidate stale callbacks after worker/message terminalization, destruction, campaign replacement, project/session replacement, or shutdown.

#### Scenario: Poll interval elapses
- **WHEN** an active campaign-associated message remains running for one confirmed interval
- **THEN** Horsepower observes its bounded status and telemetry without requiring an LLM turn or holding an admission tool call open

#### Scenario: Stale timer fires
- **WHEN** a timer callback belongs to an obsolete generation or no longer-current worker/message/campaign identity
- **THEN** it performs no delivery, state mutation, worker recreation, or task resend

### Requirement: Two unchanged polls produce one bounded soft stall episode
Horsepower SHALL emit `WORKER_PROGRESS_STALLED` after two consecutive polls without substantive progress. The diagnostic SHALL retain `dispatchStatus=running`, bounded `elapsedMs`, `lastProgressAgeMs`, and `lastOperation`, and SHALL not authorize terminal settlement or lifecycle actions.

#### Scenario: Worker has no substantive progress for two polls
- **WHEN** the same substantive progress revision is observed at two consecutive polling boundaries
- **THEN** Horsepower records and surfaces one deduplicated `WORKER_PROGRESS_STALLED` diagnostic for that stall episode

#### Scenario: Worker resumes progress
- **WHEN** a stalled worker produces substantive progress
- **THEN** Horsepower clears the unchanged-poll count and may recognize a later stall as a new episode

#### Scenario: Worker is later canceled
- **WHEN** a worker with prior stall context reaches authoritative canceled status
- **THEN** Horsepower preserves bounded prior stall context while reporting canceled terminal truth

### Requirement: Automatic wake-ups are actionable and race-safe
Horsepower SHALL wake Captain only for a first stall episode, classified asynchronous failure, or terminal settlement. Routine polls SHALL remain observational, and pending user messages or active turns SHALL take precedence over automatic follow-up.

#### Scenario: Routine progress is observed
- **WHEN** a poll observes ordinary running progress without a stall or terminal boundary
- **THEN** Horsepower updates bounded observation output without starting a Captain turn

#### Scenario: User message races with terminal follow-up
- **WHEN** a pending user message exists before automatic terminal delivery
- **THEN** Horsepower does not overtake the user message and revalidates before any later bounded follow-up

#### Scenario: Terminal follow-up is delivered
- **WHEN** a current campaign worker settles and no user, session, project, or authority race suppresses delivery
- **THEN** Horsepower sends bounded stable identity and instructs Captain to inspect existing status/read surfaces without embedding private reports or claiming task completion
