## ADDED Requirements

### Requirement: Automatic-compaction campaign continuation
Horsepower SHALL preserve the currently active user-authorized implementation campaign across successful Pi automatic `threshold` or `overflow` compaction and SHALL continue the same change ID, exact selected task IDs, inventory authorization, and user-selected mode without requiring `go` or repeated campaign selection. Continuation state SHALL be bounded and process-local and SHALL NOT authorize new scope, mode, budget, workers, completion, or terminal claims.

#### Scenario: Threshold compaction settles without Pi retry
- **WHEN** successful automatic threshold compaction occurs during an active campaign, Pi has no native retry or queued continuation, and the same campaign remains eligible when the agent settles
- **THEN** Horsepower enqueues exactly one follow-up turn that identifies the unchanged campaign and instructs the Captain to continue from official OpenSpec and current repository state

#### Scenario: Overflow compaction will retry
- **WHEN** Pi reports `willRetry: true` for successful overflow compaction
- **THEN** Horsepower relies on Pi's native retry and enqueues no duplicate campaign continuation

#### Scenario: Existing continuation is pending
- **WHEN** Pi or another extension already has a steering/follow-up continuation or the same compaction generation was already handled
- **THEN** Horsepower enqueues no additional continuation

#### Scenario: Manual compaction completes
- **WHEN** the user invokes `/compact`
- **THEN** Horsepower does not infer that the user wants automatic campaign execution to resume

#### Scenario: Compaction fails or is aborted
- **WHEN** automatic compaction produces no successful compaction entry, fails, or is aborted
- **THEN** Horsepower enqueues no campaign continuation and does not fabricate progress or terminal state

### Requirement: Post-compaction continuation authority
Only an active process-local campaign lease created from explicit user selection SHALL authorize post-compaction continuation. The lease SHALL be invalidated or suppressed by campaign switching/ending, explicit pause, blocked or terminal change state, project/session replacement, scope drift, task completion/drift, or invalid official OpenSpec context. Assistant silence alone SHALL NOT be treated as a terminal or pause decision.

#### Scenario: Same campaign remains eligible
- **WHEN** automatic compaction settles and the process-local lease still matches the current project, active campaign, change, exact tasks, inventory, and mode
- **THEN** Horsepower may issue the single bounded continuation without another user authorization prompt

#### Scenario: Campaign was switched or ended
- **WHEN** the user selects another campaign or the current campaign ends during compaction
- **THEN** Horsepower invalidates the old continuation lease and never resumes it

#### Scenario: Work is explicitly paused, blocked, or terminal
- **WHEN** the Captain or user records an explicit pause, `blocked_needs_human`, `failed`, `canceled`, or `completed` state
- **THEN** Horsepower suppresses post-compaction continuation for that campaign

#### Scenario: Assistant becomes quiet without terminal evidence
- **WHEN** compaction succeeds and the assistant turn ends without an explicit pause or terminal report
- **THEN** quietness alone does not suppress an otherwise eligible continuation

#### Scenario: Session or project is replaced
- **WHEN** Pi starts a new/resumed unrelated session, forks to another execution context, or changes project ownership
- **THEN** Horsepower does not carry the old campaign continuation lease into that context

### Requirement: Bounded private continuation message
A Horsepower post-compaction follow-up SHALL contain only bounded stable campaign identity, change ID, exact task IDs, mode, and continuation guidance. It SHALL NOT contain full prior prompts, raw provider payloads, credentials, private handoff paths, full worker reports, full compaction summaries, or inferred OpenSpec facts.

#### Scenario: Continuation is queued
- **WHEN** Horsepower emits an eligible post-compaction follow-up
- **THEN** the message provides enough stable identity to continue the existing authorization while requiring current official OpenSpec/repository inspection

#### Scenario: Compaction summary contains sensitive content
- **WHEN** the Pi-generated summary contains prompts, credentials, private paths, provider data, or full report text
- **THEN** Horsepower does not copy that content into its continuation message or structured details
