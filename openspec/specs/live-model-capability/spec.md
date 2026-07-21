# live-model-capability Specification

## Purpose
TBD - created by archiving change add-live-model-capability-setup. Update Purpose after archive.
## Requirements
### Requirement: Current Pi model discovery
Horsepower SHALL derive selectable model identifiers from the current Pi installation and configuration without printing credentials or treating a manually typed unknown identifier as available. Discovery SHALL report when the Pi model catalog cannot be established.

#### Scenario: Current catalog is available
- **WHEN** interactive setup requests model choices
- **THEN** Horsepower lists the provider/model identifiers currently visible to Pi without exposing provider credentials

#### Scenario: Catalog cannot be established
- **WHEN** current Pi model discovery fails or returns no selectable model
- **THEN** Horsepower stops guided model selection with an inconclusive diagnostic and does not write slot configuration

### Requirement: Live selected-combination probe
When exact thinking-level support is not authoritatively available from current Pi model metadata, Horsepower SHALL make a bounded live upstream probe for the user-selected model/thinking combination before accepting it. A probe SHALL use a fixed minimal prompt, no session, no Skills, no tools, bounded output, and the exact selected model and thinking value.

#### Scenario: Selected combination succeeds
- **WHEN** the live upstream probe completes successfully using the selected model and thinking level
- **THEN** Horsepower records supported evidence for that exact combination and may accept the selection

#### Scenario: Upstream explicitly rejects thinking
- **WHEN** the upstream or Pi adapter explicitly rejects the selected thinking value or reports a supported-value set that excludes it
- **THEN** Horsepower reports the combination as unsupported and asks for another selection without silently changing model or thinking

#### Scenario: Probe cannot establish support
- **WHEN** the probe fails because of authentication, authorization, quota, rate limiting, transport, timeout, service availability, malformed response, or an unclassified error
- **THEN** Horsepower reports the result as inconclusive and does not classify the combination as supported or unsupported

### Requirement: Bounded process-local capability evidence
Successful live-probe evidence SHALL be keyed by provider/model, thinking level, and a non-secret model-catalog revision, retained only in the current Horsepower process for at most ten minutes, and never written to settings, model-slot configuration, handoffs, webhooks, or telemetry. Unsupported and inconclusive results SHALL NOT become positive cache entries.

#### Scenario: Fresh matching evidence exists
- **WHEN** the same exact combination is required within ten minutes under the same catalog revision
- **THEN** Horsepower may reuse the successful process-local evidence without another upstream request

#### Scenario: Evidence is absent, stale, or mismatched
- **WHEN** no successful evidence exists, it is older than ten minutes, or the model catalog revision changed
- **THEN** Horsepower performs a new live probe before treating the combination as supported

### Requirement: Capability rejection invalidation
Horsepower SHALL invalidate matching successful evidence immediately when an actual setup probe or worker launch receives an explicit model/thinking capability rejection. It SHALL preserve the configured binding for user inspection but SHALL block new work until the combination is successfully reprobed or the user changes configuration.

#### Scenario: Worker launch reveals changed support
- **WHEN** an upstream that previously accepted a combination explicitly rejects its thinking value during launch or execution
- **THEN** Horsepower invalidates matching evidence, reports the rejection, and does not retry with a lower thinking level or another model

### Requirement: Redacted localized probe evidence
Human probe conclusions SHALL use the effective `en` or `zh-CN` locale, while model IDs, thinking IDs, status values, error codes, and bounded raw evidence remain stable and untranslated. Probe requests and output SHALL not be included in normal CLI, tool, webhook, or diagnostic output.

#### Scenario: Probe diagnostic is rendered
- **WHEN** a probe succeeds, is unsupported, or is inconclusive
- **THEN** Horsepower returns a localized bounded conclusion and stable machine fields without credentials, full prompts, or model output

