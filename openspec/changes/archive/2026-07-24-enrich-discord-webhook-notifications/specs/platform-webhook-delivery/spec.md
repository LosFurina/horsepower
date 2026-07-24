## ADDED Requirements

### Requirement: Terminal notifications carry bounded operational context
Horsepower SHALL optionally attach bounded, allowlisted campaign, task, worker, agent, model, operation, timing, diagnostic, failure, and action-required context to terminal webhook events from authoritative lifecycle state without reading prompts, reasoning, transcripts, reports, raw provider payloads, unrestricted tool output, stderr, credentials, webhook URLs, or private paths.

#### Scenario: Dispatch terminal context is available
- **WHEN** an authoritative dispatch settles with campaign, selected-task, worker, model, operation, timing, or failure context
- **THEN** the terminal event includes only the available normalized bounded fields in deterministic form

#### Scenario: Context is unavailable
- **WHEN** a terminal run lacks task-specific or worker-specific context
- **THEN** delivery remains valid and no missing value is guessed or represented as authoritative fact

### Requirement: Discord notifications use structured status embeds
For provider `discord`, Horsepower SHALL send a non-empty localized `content` fallback, exactly one structured status-colored embed, and `allowed_mentions.parse=[]`.

#### Scenario: Dispatch completes
- **WHEN** a dispatch terminal event has status `completed`
- **THEN** Discord receives a green completion embed identifying available change, task, agent/worker/model, operation/timing, run context, and that no action is required

#### Scenario: Dispatch fails or requires attention
- **WHEN** a terminal event is failed, canceled, blocked, or carries a stall diagnostic
- **THEN** Discord receives the corresponding stable status color, bounded explanation, and explicit bounded action guidance without claiming a different terminal state

### Requirement: Discord fields are orderly and bounded
Horsepower SHALL render Discord fields in deterministic outcome/action, change/task, worker/model, operation/timing, failure/diagnostic, and identifier groups; omit unavailable fields; and remain within Discord content, embed, field-count, field-value, and aggregate text limits using Unicode-safe redaction and truncation.

#### Scenario: Enriched context is large or unsafe
- **WHEN** enriched context contains oversized Unicode text, credential-like material, URLs with secrets, control characters, or private paths
- **THEN** the Discord request contains only bounded redacted text, remains within protocol limits, and disables mentions

#### Scenario: Many optional fields are present
- **WHEN** all supported safe context fields are available
- **THEN** the codec preserves deterministic grouping with no more than one embed and 25 fields and avoids an unstructured text dump

### Requirement: Generic webhook compatibility is retained
The `generic` provider SHALL retain the existing authenticated normalized Horsepower JSON contract and SHALL treat enriched context as optional without provider inference or mutation of legacy settings.

#### Scenario: Legacy generic receiver is configured
- **WHEN** a terminal event is delivered with provider `generic`
- **THEN** required legacy fields and HMAC/Bearer behavior remain compatible and Discord embed structure is not substituted

#### Scenario: Legacy Discord event lacks enriched context
- **WHEN** provider `discord` receives an event containing only the pre-existing required terminal fields
- **THEN** the codec still emits a valid bounded embed using available outcome, change, scope, run, summary, and timestamp data

### Requirement: Rich delivery remains observational
Discord rendering, HTTP delivery, and visual formatting SHALL NOT create planning, task, acceptance, evidence, failure, or terminal authority and SHALL NOT reverse authoritative settlement when delivery fails.

#### Scenario: Discord rejects an enriched payload
- **WHEN** the receiver returns a non-success response or the codec cannot produce a request
- **THEN** Horsepower records a bounded attributable delivery failure while preserving the run's authoritative terminal status

#### Scenario: Operator checks configuration
- **WHEN** the operator runs `doctor`
- **THEN** Horsepower performs static provider/auth/schema checks only and does not claim visual or delivery health
