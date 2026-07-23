## MODIFIED Requirements

### Requirement: Observable bounded one-shot execution
Every `single`, `parallel`, and `chain` dispatch SHALL emit ordered bounded progress through the active Pi tool update callback from authorization through exactly one terminal event. Progress SHALL distinguish accepted, starting, assistant, tool start/update/end, managed-handoff creation/report validation, completed, failed, and canceled stages as applicable. A parallel dispatch SHALL project one bounded parent summary and a stable simultaneously visible child state for every admitted invocation; interleaved events SHALL update only the child selected by authoritative invocation identity and SHALL NOT replace, erase, or reattribute another child's latest state. Horsepower SHALL normalize and redact worker events and SHALL NOT expose raw prompts, provider payloads, credentials, unbounded tool output, report bodies, or private handoff paths. Progress delivery failure SHALL NOT change worker execution or terminal truth.

#### Scenario: One-shot worker uses tools
- **WHEN** a worker emits assistant and tool lifecycle events while executing a valid one-shot dispatch
- **THEN** the user sees ordered non-empty bounded updates attributed to that worker before the final result

#### Scenario: Parallel workers emit interleaved progress
- **WHEN** two or more parallel workers make progress concurrently
- **THEN** the parent summary and every admitted child remain visible and each event updates only the stable child state matching its invocation identity without serializing the workers

#### Scenario: One parallel child becomes terminal
- **WHEN** a parallel child completes, fails, or is canceled while another child remains active
- **THEN** the terminal child retains its final visible state, the active child continues updating independently, and the parent counts reflect both states

#### Scenario: Progress contains sensitive or oversized fields
- **WHEN** raw Pi events contain prompts, credentials, private paths, provider payloads, or output beyond configured bounds
- **THEN** Horsepower redacts or omits those fields and emits only the normalized bounded event

#### Scenario: Tool update consumer fails
- **WHEN** Pi's partial-result callback throws or cannot render an update
- **THEN** Horsepower continues the dispatch, records bounded delivery evidence, and reports the worker's actual terminal status

### Requirement: Complete resolved worker identity
Before worker spawn, Horsepower SHALL construct an immutable identity from resolved runtime facts and SHALL include it in the tool title, every progress event, and terminal result. The identity SHALL contain dispatch name, agent name, agent role as the human-readable horse class/level, requested model slot, resolved model slot, concrete model, thinking level, handoff mode, and stable invocation ID; it SHALL add the opaque run ID after lifecycle creation. For a parallel dispatch, the operation-card projection SHALL retain the complete identity for every child in canonical input order for the lifetime of the parent tool call, bounded by the existing eight-child limit. Human labels SHALL use `outputLocale`, while names, roles, slots, model IDs, thinking values, modes, and IDs remain untranslated machine values.

#### Scenario: Single worker title is rendered
- **WHEN** a single dispatch resolves its agent and model slot
- **THEN** its visible title identifies the dispatch name, agent and role, requested-to-resolved slot mapping, concrete model, thinking level, and handoff mode before spawn

#### Scenario: Slot uses a fallback
- **WHEN** the requested slot resolves through a fallback to another slot
- **THEN** title and structured identity show both requested and resolved slots without hiding the fallback

#### Scenario: Parallel or chain identities are rendered
- **WHEN** a parent dispatch contains multiple invocations
- **THEN** Horsepower shows a bounded parent summary and a complete stable identity for each child

#### Scenario: Parallel events arrive out of child order
- **WHEN** child progress events interleave in an order different from the submitted task order
- **THEN** Horsepower preserves canonical child presentation order and correlates each update by stable invocation ID rather than arrival position

#### Scenario: Caller supplies misleading display text
- **WHEN** caller-provided names contain control characters, excessive text, or conflict with resolved agent/model facts
- **THEN** Horsepower bounds and sanitizes the human title while structured identity remains derived from authoritative resolved facts

## ADDED Requirements

### Requirement: Parallel operation-card state is bounded and terminally truthful
Horsepower SHALL maintain an observational per-tool-call projection for at most eight parallel children. The projection SHALL expose stable machine details for parent totals and each child's latest normalized operation, status, telemetry, and terminal state, and SHALL render equivalent bounded human-facing content in `en` or `zh-CN`. Projection state SHALL be discarded when the tool call settles and SHALL never become execution, lifecycle, campaign, handoff, or verification authority.

#### Scenario: Parallel dispatch is admitted
- **WHEN** a valid parallel dispatch admits multiple children
- **THEN** the visible parent summary reports total, pending or running, completed, failed, and canceled counts and presents every child in canonical input order

#### Scenario: Child telemetry changes
- **WHEN** one child receives newer authoritative usage or a newer eligible latest utterance
- **THEN** only that child's elapsed, usage, utterance, operation, and status snapshot changes while all other child snapshots remain intact

#### Scenario: Final result is rendered
- **WHEN** the parallel tool call reaches its first authoritative terminal settlement
- **THEN** the final projection and structured result agree on each child identity and known terminal outcome without fabricating missing usage or completion

#### Scenario: Projection exceeds display space
- **WHEN** eight children and their bounded identities or telemetry approach configured display limits
- **THEN** Horsepower applies deterministic per-field and aggregate bounds without omitting a child identity or exposing hidden raw content

#### Scenario: Rendering fails
- **WHEN** projection construction or Pi rendering throws
- **THEN** worker scheduling, execution, cancellation, managed-report validation, and first-terminal-wins truth remain unchanged
