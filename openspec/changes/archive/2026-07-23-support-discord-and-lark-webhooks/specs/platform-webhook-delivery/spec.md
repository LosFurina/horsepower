## ADDED Requirements

### Requirement: Explicit webhook provider
Horsepower SHALL support exactly `generic` and `discord` webhook providers. New configuration SHALL select a provider explicitly, while an existing enabled configuration with no provider SHALL resolve to `generic` without mutating stored settings or inferring a platform from the URL.

#### Scenario: New Discord configuration
- **WHEN** the user configures a Discord incoming webhook
- **THEN** Horsepower persists `provider: "discord"` only after the complete prospective configuration is valid

#### Scenario: Legacy configuration has no provider
- **WHEN** an existing webhook configuration is enabled and omits `provider`
- **THEN** Horsepower preserves current generic JSON behavior and reports `generic` as the effective provider

#### Scenario: Provider is unsupported
- **WHEN** configuration names a provider other than `generic` or `discord`
- **THEN** Horsepower rejects the update transactionally without changing effective settings

### Requirement: Canonical privacy boundary before adaptation
Horsepower SHALL normalize every terminal notification into the existing bounded redacted canonical event before provider rendering. The Discord adapter SHALL receive no prompt, report, command output, model output, credential, private path, raw terminal manifest, or unbounded evidence.

#### Scenario: Discord event is rendered
- **WHEN** a terminal event is delivered through the Discord adapter
- **THEN** the adapter receives only the normalized event and emits no raw run/change identifier, authentication value, prompt, report, private path, or raw evidence

### Requirement: Discord incoming webhook rendering
The Discord adapter SHALL render a non-empty bounded Discord-compatible JSON message, SHALL suppress mass mentions, and SHALL use `auth.mode=none` for direct Discord incoming webhook delivery.

#### Scenario: Discord accepts terminal notification
- **WHEN** a normalized terminal event is rendered for Discord
- **THEN** the request contains a non-empty bounded `content` field and an allowed-mentions policy that prevents unintended mentions

#### Scenario: Discord is configured with generic authentication
- **WHEN** a direct Discord provider configuration uses HMAC or Bearer authentication
- **THEN** Horsepower rejects the prospective configuration before persistence or delivery

#### Scenario: Discord text exceeds its bound
- **WHEN** the localized message and bounded identifiers exceed the Discord adapter limit
- **THEN** Horsepower truncates deterministically on a valid text boundary and includes a localized omission marker

### Requirement: Provider-aware delivery preserves terminal truth
Discord rendering and delivery SHALL reuse bounded current-process attempts, timeout, cancellation, and abandonment behavior. Rendering failure, non-2xx response, timeout, rate limit, or exhausted retries SHALL NOT change the originating change or dispatch terminal status and SHALL NOT create another terminal event.

#### Scenario: Discord returns a non-success status
- **WHEN** Discord rejects every bounded attempt
- **THEN** Horsepower records a redacted delivery failure while preserving the original terminal status

#### Scenario: Pi exits during retry
- **WHEN** Pi exits before a Discord retry completes
- **THEN** Horsepower does not persist or resume the delivery

### Requirement: Explicit production-path webhook probe
Horsepower SHALL provide an explicit webhook test operation that uses the effective provider configuration and the production normalization, adapter, timeout, and HTTP delivery path. Ordinary `doctor`, startup, and settings reads SHALL remain free of outbound webhook side effects.

#### Scenario: Discord probe succeeds
- **WHEN** the user explicitly tests a valid Discord webhook and the receiver accepts the provider-native request
- **THEN** Horsepower reports a bounded localized success containing the provider and attempt count without printing the URL or token

#### Scenario: Receiver rejects payload
- **WHEN** the explicit test reaches the receiver but Discord rejects the message
- **THEN** Horsepower reports a bounded provider-aware failure class and remediation without printing the raw response body, URL, or token

#### Scenario: Doctor examines valid settings
- **WHEN** doctor validates an enabled Discord configuration
- **THEN** doctor reports static configuration health and does not claim successful delivery or send a probe

### Requirement: Provider protocol acceptance coverage
Horsepower SHALL verify generic and Discord request envelopes through deterministic local receiver tests and SHALL keep real webhook URLs and tokens outside repository and release fixtures.

#### Scenario: Local protocol receiver captures requests
- **WHEN** provider delivery E2E tests run
- **THEN** they assert exact bounded request shape, redaction, authentication compatibility, retry behavior, and terminal-status independence without external credentials

#### Scenario: Release privacy scan runs
- **WHEN** a release candidate includes the Discord adapter tests and documentation
- **THEN** scanning rejects concrete webhook URLs, tokens, private paths, or captured external payloads before publication
