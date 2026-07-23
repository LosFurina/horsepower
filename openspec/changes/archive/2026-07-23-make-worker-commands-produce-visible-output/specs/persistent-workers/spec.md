## ADDED Requirements

### Requirement: Durable visible persistent-worker command output
`/horsepower-workers` SHALL always produce a bounded durable visible result in interactive Pi for the current process-lifetime persistent-worker list. The result SHALL be stored and rendered as TUI-only extension content that does not enter LLM context, rather than relying solely on a transient notification. Command presentation and rendering SHALL remain observational and SHALL NOT create, advance, abort, destroy, or otherwise alter a worker or message.

#### Scenario: Worker command lists active workers
- **WHEN** the user invokes `/horsepower-workers` while one or more persistent workers exist
- **THEN** Pi retains a visible bounded result containing every current worker in deterministic order

#### Scenario: Worker command lists no workers
- **WHEN** the user invokes `/horsepower-workers` while no persistent worker exists
- **THEN** Pi retains an explicit localized empty result instead of showing a blank or disappearing command outcome

#### Scenario: Another TUI render occurs
- **WHEN** the editor, a tool card, another notification, or another extension causes Pi to render after the command completes
- **THEN** the worker-list result remains present in the transcript as durable TUI-only content

#### Scenario: Command output is produced
- **WHEN** the durable worker-list entry is appended and rendered
- **THEN** it is not delivered to the model as user, assistant, system, custom-message, prompt, or tool context

### Requirement: Persistent-worker list identity and telemetry
Each visible persistent-worker entry SHALL contain bounded stable worker identity and current lifecycle facts: worker ID, dispatch name, agent and role when available, requested and resolved slot, concrete model, thinking level, handoff mode, worker status, active message ID and queued-message count when available, and non-negative elapsed time plus authoritative aggregate input/output usage and latest privacy-safe assistant utterance when available. Unavailable telemetry SHALL be omitted rather than guessed, and ordering SHALL match the runtime's deterministic worker-list ordering.

#### Scenario: Running worker has telemetry
- **WHEN** a listed persistent worker has an active message and authoritative telemetry
- **THEN** its durable entry shows current identity, status, message correlation, elapsed time, available usage, and latest eligible utterance

#### Scenario: Idle worker has no active telemetry
- **WHEN** a listed worker is idle and a field is unavailable
- **THEN** the output preserves truthful identity/status and omits the unavailable field without displaying a fabricated zero or stale active-message claim

#### Scenario: Multiple workers exist
- **WHEN** multiple persistent workers are listed
- **THEN** every worker appears exactly once in deterministic order and one worker's status or telemetry does not replace another worker's entry

### Requirement: One-shot and persistent-worker boundary is explicit
The worker-list result SHALL explain that `/horsepower-workers` and the `list` action show only current process-lifetime workers created by persistent `create`. Completed or terminal `single`, `parallel`, and `chain` children SHALL NOT be represented as persistent workers. An empty persistent list SHALL NOT imply that no one-shot execution occurred.

#### Scenario: Parallel one-shot children have completed
- **WHEN** a parallel dispatch produced terminal child runs but no persistent worker was created
- **THEN** `/horsepower-workers` shows the explicit empty persistent-worker state and explains that one-shot children are not included

#### Scenario: Persistent worker exists after one-shot completion
- **WHEN** terminal one-shot children and a current persistent worker both exist
- **THEN** the command lists only the persistent worker and does not merge one-shot identities into the process-lifetime worker list

### Requirement: Localized bounded and privacy-safe worker output
Worker-list headings, empty-state guidance, status explanation, and failures SHALL use the effective `en` or `zh-CN` locale. Worker IDs, message IDs, names, agent/role values, slot/model/thinking identifiers, modes, statuses, commands, and structured field names SHALL remain untranslated. The output SHALL exclude prompts, message bodies, reasoning, raw provider payloads, unrestricted events/tool output, credentials, absolute private paths, managed handoff paths, report bodies, and complete conversation history, and SHALL apply deterministic UTF-8-safe field and aggregate bounds.

#### Scenario: Chinese empty state is rendered
- **WHEN** effective locale is `zh-CN` and no persistent worker exists
- **THEN** the durable explanation is Chinese while `create`, `single`, `parallel`, and `chain` remain untranslated machine tokens

#### Scenario: Worker summary contains sensitive or oversized data
- **WHEN** a worker summary or telemetry contains private, credential-shaped, control-character, or oversized content
- **THEN** the durable projection redacts, normalizes, or omits it within documented bounds and never appends the original bytes

#### Scenario: Maximum worker population is listed
- **WHEN** all eight allowed persistent workers exist with bounded telemetry
- **THEN** every worker identity remains present within the deterministic aggregate bound without leaking excluded content

### Requirement: Worker command failures are visible and observational
Runtime listing, locale resolution, durable-entry append, and custom rendering failures SHALL not appear as silent success. Horsepower SHALL present a bounded actionable error through the available Pi UI surface and SHALL preserve the underlying worker/runtime state. A renderer failure SHALL NOT recursively append entries, retry without bound, or change the list result's machine truth.

#### Scenario: Runtime list fails
- **WHEN** the runtime rejects the `list` action
- **THEN** `/horsepower-workers` displays a localized bounded error and leaves all workers unchanged

#### Scenario: Durable entry append fails
- **WHEN** Pi cannot append the worker-list entry
- **THEN** Horsepower falls back to an explicit bounded error notification and does not claim that durable output was recorded

#### Scenario: Custom renderer fails
- **WHEN** the TUI-only entry renderer cannot render a stored result
- **THEN** the failure remains observational, workers remain unchanged, and the extension exposes a bounded fallback rather than throwing into worker execution

### Requirement: Worker command behavior is defined outside interactive TUI
The underlying `horsepower_subagent` `list` action SHALL continue returning bounded structured current-worker data to tool callers. RPC command discovery SHALL continue exposing `/horsepower-workers`; where Pi supports invoking extension commands without an interactive TUI, the command SHALL emit a bounded structured command outcome or explicit UI-unavailable diagnostic instead of silently succeeding. Tests SHALL exercise the supported real Pi command path, not only registration metadata.

#### Scenario: Tool caller requests list
- **WHEN** the Captain invokes `horsepower_subagent` with `action: "list"`
- **THEN** it receives the bounded structured persistent-worker list independently of the TUI entry renderer

#### Scenario: RPC exposes command registration
- **WHEN** official Pi RPC enumerates extension commands
- **THEN** `horsepower-workers` remains registered with an accurate persistent-worker description

#### Scenario: Non-interactive command invocation is supported by Pi
- **WHEN** the command handler runs without interactive TUI capabilities
- **THEN** Horsepower returns or reports an explicit bounded result according to that Pi mode rather than relying on an unavailable transient notification
