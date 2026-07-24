## ADDED Requirements

### Requirement: Persistent worker failures retain structured message and process cause
Persistent worker startup, admission, RPC, message, cancellation, queue, exit, cleanup, and destruction failures SHALL remain attached to the existing worker and message identities with bounded structured code, boundary, stage, message, and remediation. `status`, `read`, and `list` SHALL NOT reduce an actionable failure to an unclassified string when classified cause exists.

#### Scenario: Worker startup RPC fails
- **WHEN** Pi starts but startup state acknowledgement fails
- **THEN** creation fails with bounded process/RPC cause and cleanup outcome, no worker remains registered, and Captain is not shown a successful creation

#### Scenario: Accepted message later fails
- **WHEN** an accepted or queued persistent message later fails or is canceled
- **THEN** its message state, worker event stream, and status projection retain the same message ID and structured terminal cause

#### Scenario: Unexpected worker exit affects queued messages
- **WHEN** a persistent child exits unexpectedly with active or queued messages
- **THEN** every affected message receives an attributable failed result and future sends return the worker's bounded process failure rather than only `unknown error`

### Requirement: Persistent cleanup degradation is reported without deleting state truth
When abort, destroy, shutdown, or temporary-resource cleanup partially fails, Horsepower SHALL preserve the most authoritative worker/message state it established and report bounded residual-state and cleanup diagnostics. It SHALL NOT claim destruction, cleanup, or cancellation succeeded unless the required semantic evidence exists.

#### Scenario: Destroy escalation does not terminate the child
- **WHEN** termination and bounded escalation fail to observe process exit
- **THEN** the worker remains inspectably failed with explicit residual-process diagnostics and Horsepower does not report `destroyed: true`

#### Scenario: Worker exits but temporary cleanup fails
- **WHEN** process termination is established but private temporary resource cleanup fails
- **THEN** worker execution remains terminal, Captain receives a bounded cleanup diagnostic, and private paths are not exposed
