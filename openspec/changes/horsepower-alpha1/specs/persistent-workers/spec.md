## ADDED Requirements

### Requirement: Persistent RPC worker process
Each persistent worker SHALL run as a separate `pi --mode rpc --no-session` child with `shell: false`, the resolved model and thinking level, a private prompt file, and all delegation tools excluded.

#### Scenario: Worker starts successfully
- **WHEN** Pi acknowledges the startup state request
- **THEN** the worker transitions from `starting` to `idle`

#### Scenario: Startup fails
- **WHEN** startup RPC fails
- **THEN** Horsepower kills and removes the child and cleans temporary prompt resources

### Requirement: Persistent worker population
Horsepower SHALL allow at most eight persistent workers per host Pi process and SHALL NOT evict or automatically expire idle workers.

#### Scenario: Ninth worker requested
- **WHEN** eight persistent workers already exist
- **THEN** Horsepower rejects creation without destroying an existing worker

#### Scenario: Worker becomes idle
- **WHEN** a turn completes
- **THEN** the worker remains alive and available indefinitely within the host process

### Requirement: Multi-turn message delivery
Horsepower SHALL assign each send a unique message ID and support `reject`, `followUp`, and `steer` delivery with per-message completion correlation.

#### Scenario: Waited send completes
- **WHEN** the caller waits for one message
- **THEN** Horsepower returns only that message's completion result

#### Scenario: Wait timeout expires
- **WHEN** `timeoutMs` expires before completion
- **THEN** waiting stops but the worker turn continues

#### Scenario: Busy send rejected
- **WHEN** a worker is busy and delivery is `reject`
- **THEN** Horsepower rejects the new send without queuing it

### Requirement: Abort differs from destroy
`abort` SHALL stop the active turn while preserving the worker and conversation; `destroy` SHALL terminate and remove the worker. Transport acknowledgement alone SHALL NOT be reported as completed cancellation.

#### Scenario: Active turn aborted
- **WHEN** Pi emits evidence that the turn was aborted or settled after abort
- **THEN** the message becomes `canceled` and the worker returns to `idle`

#### Scenario: Worker destroyed
- **WHEN** the captain explicitly destroys a worker
- **THEN** active and queued waiters are rejected, the child exits, temporary resources are removed, and the worker disappears from `list`

### Requirement: Cursor event stream
Each worker SHALL expose monotonically increasing cursors and a byte-bounded event buffer of 10 MiB by default, with compact and detailed projections.

#### Scenario: Incremental read
- **WHEN** the caller reads after a known cursor
- **THEN** only later eligible events are returned with pagination metadata

#### Scenario: Old events evicted
- **WHEN** the event byte limit requires eviction
- **THEN** the next read reports truncation and the oldest retained cursor

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
