## MODIFIED Requirements

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
