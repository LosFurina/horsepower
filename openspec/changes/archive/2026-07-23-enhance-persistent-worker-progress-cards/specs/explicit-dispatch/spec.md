## ADDED Requirements

### Requirement: Bounded worker operation-card telemetry
Horsepower SHALL render stable attributed operation cards for one-shot and persistent dispatches with non-negative elapsed time, authoritative aggregate input/output token counts when available, and at most the latest completed privacy-safe worker utterance. Structured progress details SHALL retain bounded machine-stable telemetry fields while human formatting MAY be localized. Telemetry collection and rendering SHALL remain observational and SHALL NOT alter execution, managed handoff validation, persistent-worker lifetime, or terminal truth.

#### Scenario: Worker produces progress and usage
- **WHEN** an eligible worker dispatch emits normalized progress plus authoritative Pi input/output usage
- **THEN** its operation card identifies the existing worker identity and shows elapsed time, aggregate input tokens, aggregate output tokens, and the latest eligible utterance without guessing unavailable values

#### Scenario: Latest worker utterance changes
- **WHEN** a newer completed assistant utterance passes normalization
- **THEN** the card replaces the previous utterance with the newer bounded value rather than accumulating a transcript

#### Scenario: Telemetry is unavailable
- **WHEN** Pi supplies no authoritative input or output usage or no eligible assistant utterance
- **THEN** Horsepower omits the unavailable fields and preserves truthful execution status

#### Scenario: Progress callback or rendering fails
- **WHEN** telemetry normalization, progress callback, or operation-card rendering throws
- **THEN** the dispatch continues and reaches the same execution-derived and handoff-derived terminal result it would have reached without rendering

### Requirement: Human cancellation is observable and orphan-free
When a human cancels a blocking Horsepower dispatch wait, Horsepower SHALL settle the admitted invocation with structured `canceled` identity, SHALL NOT accept an absent managed report, and SHALL ensure the corresponding child/run is no longer active. Cancellation SHALL NOT reinterpret partial repository edits as accepted completion.

#### Scenario: Human presses Esc during a slow one-shot dispatch
- **WHEN** a one-shot worker has been admitted and the human cancels the Captain's blocking wait before worker completion
- **THEN** Horsepower returns or records the same run/invocation identity as `canceled`, terminates the child with bounded escalation, and leaves no hidden active execution

#### Scenario: Canceled managed worker has no report
- **WHEN** cancellation occurs before a managed worker writes and validates `report.md`
- **THEN** Horsepower records `reportPresent: false` or equivalent structured absence and never presents the handoff as completed

#### Scenario: Cancellation races successful completion
- **WHEN** worker completion and human cancellation occur concurrently
- **THEN** Horsepower preserves the first authoritative terminal settlement and never reports contradictory completed and canceled truth for the same invocation

### Requirement: Privacy-safe latest worker utterance
Horsepower SHALL derive the latest worker utterance only from completed eligible assistant text, normalize control characters and whitespace, redact credentials and private paths, truncate on a UTF-8 boundary to a documented small bound, and account for it within aggregate progress event and byte limits. Horsepower SHALL NOT project reasoning, partial text deltas, user/system prompts, raw provider payloads, unrestricted tool output, private handoff paths, full reports, credentials, or complete conversation history into an operation card.

#### Scenario: Eligible assistant utterance is safe
- **WHEN** a worker emits a completed assistant utterance containing ordinary bounded text
- **THEN** the newest normalized text may appear in the operation card as the latest utterance

#### Scenario: Assistant utterance contains sensitive or oversized content
- **WHEN** a completed assistant utterance contains credential-shaped data, absolute private paths, control characters, or text beyond the display bound
- **THEN** Horsepower redacts and UTF-8-safely truncates it before projection without forwarding the original bytes

#### Scenario: Raw or private event is observed
- **WHEN** a worker emits reasoning, partial deltas, prompts, provider metadata, tool results, a full managed report, or a private handoff path
- **THEN** Horsepower excludes that content from latest-utterance telemetry and operation-card details

#### Scenario: Progress limits are exhausted
- **WHEN** latest-utterance or telemetry updates would exceed the aggregate event or byte budget
- **THEN** Horsepower drops further observational updates without changing worker execution or terminal truth
