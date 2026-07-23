# persistent-workers Specification

## Purpose
TBD - created by archiving change horsepower-alpha1. Update Purpose after archive.
## Requirements
### Requirement: Persistent RPC worker process
Each persistent worker SHALL run as a separate `pi --mode rpc --no-session --no-skills` child with `shell: false`, the resolved model and thinking level, a private prompt file, and all delegation tools excluded. Horsepower SHALL NOT pass an implicit `--skill` path or provide a configuration escape hatch that enables Skill discovery for persistent workers.

#### Scenario: Worker starts successfully
- **WHEN** Pi acknowledges the startup state request
- **THEN** the worker transitions from `starting` to `idle` with its explicit persona, prompt, tools, model, and thinking configuration intact and with no discovered Skills loaded

#### Scenario: Startup fails
- **WHEN** startup RPC fails
- **THEN** Horsepower kills and removes the child and cleans temporary prompt resources

#### Scenario: External Skill exists
- **WHEN** a global, project, settings, package, or extension-contributed Skill is visible in the worker's environment
- **THEN** Pi Skill discovery remains disabled and the worker does not receive that Skill's instructions

### Requirement: Persistent worker population
Horsepower SHALL allow at most eight persistent workers per host Pi process and SHALL NOT evict or automatically expire idle workers.

#### Scenario: Ninth worker requested
- **WHEN** eight persistent workers already exist
- **THEN** Horsepower rejects creation without destroying an existing worker

#### Scenario: Worker becomes idle
- **WHEN** a turn completes
- **THEN** the worker remains alive and available indefinitely within the host process

#### Scenario: Idle worker has no active dispatch
- **WHEN** a persistent worker remains idle after its dispatch terminal event
- **THEN** Horsepower sends no additional terminal webhook merely because the worker is idle

### Requirement: Multi-turn message delivery
Horsepower SHALL assign each initial and follow-up message a unique message ID and support `reject`, `followUp`, and `steer` delivery with per-message completion correlation. Persistent `create` SHALL return after process/initial-message admission without intentionally awaiting the initial turn's completion. Delivery with `wait: false` SHALL return after message acceptance or queuing without intentionally awaiting worker completion. Both acknowledgements SHALL expose stable worker/message identity and current status and SHALL leave the same persistent worker available for Captain work, observation, and later follow-ups until explicit destruction or process cleanup.

#### Scenario: Persistent create remains independent
- **WHEN** the Captain creates a persistent worker whose controlled initial turn remains unresolved
- **THEN** Horsepower returns accepted worker and initial-message identity without invoking the completion waiter, and `status`/`read` can observe that same running turn

#### Scenario: Non-waited send remains independent
- **WHEN** the Captain sends a message with `wait: false` to a controlled worker whose turn remains active
- **THEN** Horsepower returns the accepted message identity without invoking the completion waiter, the main Agent can perform unrelated work, and later `status` or `read` observes the same active message

#### Scenario: Fast non-waited send races completion
- **WHEN** a worker completes after acceptance but before the non-waited acknowledgement is rendered
- **THEN** Horsepower may return the truthful completed snapshot without having intentionally awaited completion

#### Scenario: Waited send completes
- **WHEN** the caller waits for one message
- **THEN** Horsepower returns only that message's completion result

#### Scenario: Wait timeout expires
- **WHEN** `timeoutMs` expires before completion
- **THEN** waiting stops but the worker turn continues

#### Scenario: Busy send rejected
- **WHEN** a worker is busy and delivery is `reject`
- **THEN** Horsepower rejects the new send without queuing it

#### Scenario: Persistent worker receives another follow-up
- **WHEN** a prior message is terminal and the worker is idle
- **THEN** the Captain can send another correlated message to the same worker ID and conversation without recreating the worker

### Requirement: Abort differs from destroy
`abort` SHALL stop the active turn while preserving the worker and conversation; `destroy` SHALL terminate and remove the worker. Transport acknowledgement alone SHALL NOT be reported as completed cancellation.

#### Scenario: Active turn aborted
- **WHEN** Pi emits evidence that the turn was aborted or settled after abort
- **THEN** the message becomes `canceled` and the worker returns to `idle`

#### Scenario: Worker destroyed
- **WHEN** the captain explicitly destroys a worker
- **THEN** active and queued waiters are rejected, the child exits, temporary resources are removed, and the worker disappears from `list`

### Requirement: Cursor event stream
Each worker SHALL expose monotonically increasing cursors and a byte-bounded event buffer of 10 MiB by default, with compact and detailed projections. Eligible progress projections SHALL include a bounded per-message telemetry snapshot with monotonic elapsed milliseconds, authoritative aggregate input/output token usage when reported by Pi, and at most the latest completed privacy-safe assistant utterance.

#### Scenario: Incremental read
- **WHEN** the caller reads after a known cursor
- **THEN** only later eligible events are returned with pagination metadata

#### Scenario: Old events evicted
- **WHEN** the event byte limit requires eviction
- **THEN** the next read reports truncation and the oldest retained cursor

#### Scenario: Persistent message telemetry updates
- **WHEN** a persistent turn emits eligible progress and authoritative Pi usage records
- **THEN** status/read projections expose non-negative monotonic elapsed time, per-message aggregate input/output tokens, and the newest eligible normalized assistant utterance without exposing raw provider events

#### Scenario: Follow-up begins
- **WHEN** the same persistent worker accepts a later substantive message
- **THEN** per-message elapsed time, usage, and latest utterance reset for the new message without destroying the worker or losing its conversation

### Requirement: Failure semantics
Unexpected child exit SHALL mark the worker `failed`, reject active and queued waiters, and never automatically restart the process. Provider retries SHALL not prematurely complete a message.

#### Scenario: Child crashes
- **WHEN** the child exits without destroy being requested
- **THEN** status becomes `failed` and future sends are rejected

#### Scenario: Provider retries
- **WHEN** an agent-end event declares `willRetry`
- **THEN** the active message remains running until a non-retrying completion arrives

### Requirement: Process-lifetime reuse and cleanup
Workers SHALL survive Pi `new`, `resume`, and `fork` by using a process-global singleton, and SHALL be destroyed on Pi `reload`, `quit`, and host process exit.

#### Scenario: Pi session changes
- **WHEN** Pi starts a new, resumed, or forked session in the same process
- **THEN** the new extension instance reuses the same worker manager

#### Scenario: Pi reloads
- **WHEN** the extension receives reload shutdown
- **THEN** it destroys all workers and removes the process-global singleton

### Requirement: Persistent managed handoff continuity
A persistent worker created with `handoffMode: managed` SHALL use a private handoff workspace for its initial brief and substantive message reports. Follow-up delivery SHALL reuse the associated managed workspace, while `steer` SHALL remain a control operation that creates no handoff artifact.

#### Scenario: Managed persistent send
- **WHEN** the Captain sends substantive work to a managed persistent worker
- **THEN** Horsepower records the message/run association and requires a validated report artifact for successful completion

#### Scenario: Managed follow-up
- **WHEN** the Captain delivers a follow-up to an existing managed dispatch
- **THEN** Horsepower reuses that dispatch's handoff workspace and records the new message evidence without creating an unrelated workspace

#### Scenario: Worker is destroyed
- **WHEN** a managed persistent worker is destroyed
- **THEN** its retained handoff artifacts remain available until explicit handoff cleanup or purge

### Requirement: Private retained handoff storage
Horsepower SHALL store managed handoffs beneath a mode-`0700` Horsepower state directory partitioned by opaque project identity and run ID. Handoff files SHALL be mode `0600`, transactionally written, regular files with relative manifest paths, and protected from traversal, symlink, hardlink, and cross-project access.

#### Scenario: Handoff path escapes
- **WHEN** a requested brief, report, attachment, or manifest path is absolute, traverses upward, crosses project/run ownership, or encounters a link
- **THEN** Horsepower rejects it without reading, writing, or deleting the external target

#### Scenario: Handoff exceeds bounds
- **WHEN** a brief or report exceeds 1 MiB, an attachment exceeds 10 MiB, more than sixteen attachments are present, or run artifacts exceed 20 MiB total
- **THEN** Horsepower rejects the artifact without silently truncating the managed file

### Requirement: Handoff retention is not conversation recovery
Managed handoffs SHALL be retained across Pi process exits by default and SHALL support explicit list, inspect, per-run clean, and terminal-run clean operations. Retention SHALL NOT restore worker conversations, automatically resume execution, or replace OpenSpec facts.

#### Scenario: Pi process exits
- **WHEN** the host Pi process exits after a managed dispatch
- **THEN** the handoff remains inspectable while the worker conversation is not resumable

#### Scenario: Handoff is explicitly cleaned
- **WHEN** the user cleans a verified handoff run or terminal handoffs
- **THEN** Horsepower removes only owned artifacts using no-follow semantics and leaves OpenSpec artifacts unchanged
