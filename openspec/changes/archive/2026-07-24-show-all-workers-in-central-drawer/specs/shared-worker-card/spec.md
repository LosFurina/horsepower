## ADDED Requirements

### Requirement: Worker surfaces use one shared card contract
Parallel Agent Cards and worker drawer cards SHALL use the same bounded `WorkerCardModel` projection and themed width-aware renderer for common worker fields.

#### Scenario: Common field changes
- **WHEN** identity, lifecycle status, operation, slot/model/thinking, telemetry, progress, stall, failure, localization, privacy, or width behavior is changed in the shared card contract
- **THEN** parallel cards and drawer cards render the same updated semantics without duplicate field-specific implementations

### Requirement: Shared cards preserve source-specific lifecycle semantics
The shared model SHALL normalize presentation without merging execution authority: one-shot and persistent adapters SHALL retain their distinct identity, retention, and status semantics.

#### Scenario: Persistent worker is idle
- **WHEN** a persistent adapter projects a reusable idle worker
- **THEN** the shared card renders `kind=persistent` and `status=idle` without converting it to completed

#### Scenario: One-shot operation is running
- **WHEN** a one-shot adapter projects an admitted active child
- **THEN** the shared card renders `kind=one-shot` and the authoritative dispatch status independently from the latest operation status

### Requirement: Shared cards are bounded and private
The shared projection and renderer SHALL bound item count, field bytes, aggregate bytes, and terminal width, and SHALL redact or omit prompts, credentials, reasoning, raw provider payloads, raw tool output, reports, and private paths.

#### Scenario: Unsafe source text reaches an adapter
- **WHEN** a summary, operation, target, failure, or identity field contains unsafe or oversized content
- **THEN** the shared projection emits only bounded redacted presentation data

### Requirement: Shared renderer supports compact and detailed containers
The renderer SHALL support a compact parallel-tool context and a drawer context without duplicating field formatting, status color semantics, or localization.

#### Scenario: Same worker renders in two containers
- **WHEN** an equivalent worker model is shown in a parallel card and the drawer
- **THEN** common labels and values match while container-specific framing and viewport controls may differ
