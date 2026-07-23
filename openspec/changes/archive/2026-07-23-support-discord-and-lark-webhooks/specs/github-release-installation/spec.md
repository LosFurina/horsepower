## MODIFIED Requirements

### Requirement: Optional webhook setup
The complete interactive configuration journey invoked directly or by interactive installation SHALL offer optional webhook configuration and SHALL allow the user to preserve existing settings, disable notifications, or configure them. New configuration SHALL explicitly select `generic` or `discord`; SHALL support change notifications enabled by default and dispatch notifications disabled by default; and SHALL permit only authentication modes compatible with the selected provider. Existing configuration without a provider SHALL remain effective as `generic` until the user explicitly reconfigures it.

#### Scenario: User skips webhook
- **WHEN** no webhook exists and the user selects skip, or an existing webhook exists and the user selects preserve
- **THEN** complete configuration leaves the effective webhook state unchanged and reports that outcome

#### Scenario: User disables webhook
- **WHEN** the user explicitly selects disable
- **THEN** complete configuration uses the existing credential-removing disable transaction and reports notifications disabled

#### Scenario: User configures generic HMAC
- **WHEN** the user selects `generic`, provides a URL, selects `hmac`, and provides a secret
- **THEN** configuration writes the provider and secret only to mode-`0600` Horsepower configuration and diagnostics redact the URL and secret

#### Scenario: User configures generic Bearer authentication
- **WHEN** the user selects `generic`, provides a URL, selects `bearer`, and provides a token
- **THEN** webhook requests use the Authorization header and no prompt, diagnostic, summary, or delivery result prints the URL or token

#### Scenario: User configures Discord
- **WHEN** the user selects `discord` and supplies compatible URL and authentication settings
- **THEN** Horsepower validates the complete prospective provider configuration and persists it transactionally

#### Scenario: Provider and authentication are incompatible
- **WHEN** the user selects a provider/authentication combination that its adapter does not support
- **THEN** Horsepower rejects the update before writing settings and gives bounded localized remediation

### Requirement: Redacted non-blocking webhook delivery
Terminal webhook processing SHALL first create a canonical event containing event ID, timestamp, scope, opaque run/change identifiers, terminal status, and bounded redacted summary/evidence references. Generic delivery SHALL serialize that canonical event; Discord delivery SHALL adapt only that event into a provider-native bounded envelope. No delivery SHALL contain prompts, model output, reports, private paths, API keys, authentication values, or full command output. Delivery SHALL use bounded retries only within the current Pi process and SHALL never change the original terminal status.

#### Scenario: Generic HMAC notification
- **WHEN** a terminal event uses the generic provider with HMAC authentication
- **THEN** the request includes an event ID, timestamp, and HMAC-SHA256 signature over the canonical request body

#### Scenario: Provider-native notification
- **WHEN** a terminal event uses the Discord provider
- **THEN** Horsepower renders a valid Discord envelope from the canonical event without exposing additional lifecycle or private data

#### Scenario: Receiver remains unavailable
- **WHEN** all configured in-process delivery attempts fail
- **THEN** Horsepower records redacted notification failure for current-process status output and preserves the original terminal status

#### Scenario: Pi process exits during retry
- **WHEN** the host process exits before a retry completes
- **THEN** Horsepower does not persist or resume the notification and documentation states this limitation

#### Scenario: User explicitly tests delivery
- **WHEN** the user invokes the webhook test operation
- **THEN** Horsepower uses the effective production provider path and reports bounded success or failure without exposing the URL, credential, signature, or raw receiver body

#### Scenario: Doctor runs without a delivery probe
- **WHEN** doctor examines a syntactically valid enabled webhook
- **THEN** it reports static provider configuration health without making an outbound request or claiming receiver acceptance
