# live-model-capability Specification

## Purpose
TBD - created by archiving change add-live-model-capability-setup. Update Purpose after archive.
## Requirements
### Requirement: Current Pi model discovery
Horsepower SHALL derive selectable model identifiers from the current Pi installation and configuration without printing credentials or treating a manually typed unknown identifier as available. Discovery and every human-facing model-selection prompt SHALL use the effective output locale while provider/model identifiers remain unchanged. Discovery SHALL report when the Pi model catalog cannot be established.

#### Scenario: Current catalog is available
- **WHEN** interactive setup requests model choices
- **THEN** Horsepower lists the provider/model identifiers currently visible to Pi and localized selection instructions without exposing provider credentials

#### Scenario: Catalog cannot be established
- **WHEN** current Pi model discovery fails or returns no selectable model
- **THEN** Horsepower stops guided model selection with a localized inconclusive diagnostic and does not write slot configuration

### Requirement: No upstream capability preflight
Horsepower SHALL trust the user's existing Pi authentication and model configuration. Setup and pre-dispatch validation SHALL NOT send a prompt or other capability probe to the upstream provider.

#### Scenario: User selects a Pi-visible combination
- **WHEN** setup receives a Pi-visible model and valid Horsepower thinking identifier
- **THEN** Horsepower accepts the binding without an upstream request

#### Scenario: Dispatch uses a configured combination
- **WHEN** a worker dispatch resolves to a configured model/thinking binding
- **THEN** Horsepower starts the worker without a preliminary provider request

### Requirement: Capability rejection handling
Horsepower SHALL preserve the configured binding when an actual worker reports an explicit model/thinking capability rejection.

#### Scenario: Worker launch reveals changed support
- **WHEN** an upstream that previously accepted a combination explicitly rejects its thinking value during launch or execution
- **THEN** Horsepower reports the rejection and does not retry with a lower thinking level or another model

### Requirement: Redacted localized probe evidence
Every human-facing model selection, thinking-level selection, invalid-selection response, capability conclusion, retry/reselection/skip/cancel choice, cancellation message, and setup summary SHALL use the effective `en` or `zh-CN` locale. Model IDs, thinking IDs, status values, accepted stable action tokens, error codes, and bounded raw evidence SHALL remain stable and untranslated. Probe requests and output SHALL not be included in normal CLI, tool, webhook, or diagnostic output.

#### Scenario: Probe diagnostic is rendered
- **WHEN** a probe succeeds, is unsupported, or is inconclusive
- **THEN** Horsepower returns a localized bounded conclusion and stable machine fields without credentials, full prompts, or model output

#### Scenario: Chinese guided setup is used
- **WHEN** effective locale is `zh-CN` and the user enters guided model setup directly or through complete configuration
- **THEN** model-list headings, slot instructions, thinking instructions, invalid-selection help, capability action questions, cancellation, and completion guidance are Chinese while selectable identifiers and machine values remain unchanged

#### Scenario: English guided setup is used
- **WHEN** effective locale is `en`
- **THEN** every guided model interaction is English and exposes the same stable choices and machine outcomes as the Chinese flow
