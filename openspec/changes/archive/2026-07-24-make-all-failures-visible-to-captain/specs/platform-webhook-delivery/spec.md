## ADDED Requirements

### Requirement: Webhook delivery degradation is Captain-inspectable
Webhook normalization, provider adaptation, signing, request construction, timeout, transport, receiver response, retry, and abandonment failures SHALL produce bounded redacted delivery diagnostics correlated to the original terminal event and provider. Delivery diagnostics SHALL NOT expose the URL, credentials, signature, raw receiver body, prompt, report, private path, or unrestricted evidence and SHALL NOT change terminal truth.

#### Scenario: Provider rendering fails
- **WHEN** a canonical terminal event cannot be rendered into the selected provider envelope
- **THEN** Horsepower records the provider and rendering failure class, makes it inspectable through the existing terminal/doctor or explicit test result surface, and preserves the original terminal event

#### Scenario: Receiver rejects all attempts
- **WHEN** every bounded delivery attempt receives a non-success response or transport failure
- **THEN** Horsepower exposes attempt count, provider, failure class, and remediation without the raw response body or destination

#### Scenario: Delivery is abandoned during shutdown
- **WHEN** process shutdown abandons an in-flight notification
- **THEN** Horsepower records bounded process-local abandonment evidence when possible and does not claim delivery or persist a retry
