## Context

Horsepower normalizes terminal events into a bounded privacy-safe canonical event and currently serializes that event directly as JSON for every receiver. This is appropriate for a generic integration endpoint, including HMAC or Bearer authentication, but Discord incoming webhooks require a `content`-bearing request body. A live diagnostic against the configured Discord URL reached the receiver but returned HTTP 400 / code 50006 because the request lacked message content.

The change crosses configuration parsing and precedence, CLI prompts, notifier delivery, diagnostics, localization, documentation, and release privacy controls. The canonical event remains the sole notification truth; the Discord adapter is a presentation codec and cannot alter run lifecycle or terminal status.

## Goals / Non-Goals

**Goals:**
- Retain one bounded redacted canonical terminal event.
- Add explicit `generic` and `discord` provider selection.
- Convert canonical events into a Discord-native text envelope with deterministic bounded output.
- Validate provider, URL, authentication compatibility, and overrides before transactional persistence.
- Offer an explicit delivery probe that exercises the selected adapter and reports a bounded credential-free result.
- Preserve current retry, cancellation, localization, project override, and terminal-truth behavior.

**Non-Goals:**
- Supporting Lark, Slack, Teams, rich embeds, attachments, threads, mentions, or inbound webhook events in this change.
- Discovering a provider solely from URL at runtime or silently changing a configured provider.
- Persisting failed deliveries, adding a notification daemon, or guaranteeing delivery after Pi exits.
- Exposing raw receiver bodies, webhook URLs, tokens, prompts, reports, or command output in diagnostics.

## Decisions

### Use an explicit provider discriminator

Effective webhook settings include `provider: "generic" | "discord"`. Existing configurations without `provider` resolve to `generic` for backward compatibility. Interactive configuration requires an explicit selection for newly configured webhooks.

URL-based auto-detection is rejected as authority because proxies and future endpoint changes make inference ambiguous. The CLI may provide a bounded advisory hint, but it must not persist or execute a different provider without user selection.

### Keep canonical normalization before provider rendering

The notifier continues to validate, redact, hash opaque IDs, localize the human summary, and enforce the 8 KiB canonical event cap before choosing an adapter. The Discord adapter receives only this normalized event and cannot access credentials, prompts, reports, private paths, or raw terminal manifests.

### Isolate the Discord codec from retry transport

A provider codec returns a bounded request body and required non-secret headers:

- `generic`: current canonical JSON and Horsepower event headers; existing HMAC/Bearer/none authentication remains supported.
- `discord`: JSON with bounded non-empty `content` and `allowed_mentions: { parse: [] }`; direct Discord delivery requires `auth.mode=none` because the webhook URL already carries its credential.

The existing bounded retry loop sends the rendered body. Any non-2xx result remains a redacted delivery failure and never changes terminal truth.

### Format Discord text deterministically

Discord messages contain only a concise localized summary plus stable machine fields needed by operators: scope, status, opaque run/change IDs, and timestamp. Rendering obeys a conservative bound no greater than Discord's content limit, truncates safely, uses a localized omission marker, and disables all parsed mentions.

Rich embeds are deferred to keep escaping, privacy review, and acceptance small.

### Add an explicit safe probe

`doctor` continues to validate effective configuration without network side effects. A separate webhook test operation sends a marked privacy-safe test event through the exact production normalization, adapter, timeout, and HTTP path with bounded attempts. It reports provider, success/failure class, safe status code, attempts, and remediation, but never the URL, token, or raw response body.

### Preserve transactional global/project settings

Provider participates in existing global/project merge and shadowing. Configure/disable updates validate complete prospective settings before atomic write and preserve mode-`0600` handling. A project override can select a different provider and URL but cannot inherit incompatible credentials from a shadowed global provider.

## Test and Gate Plan

### Profiles
- testIntensity: targeted
- gateStrictness: required

### Test Cases

#### TC-1: provider configuration and compatibility
- maps: scenario:Explicit webhook provider/New Discord configuration, scenario:Explicit webhook provider/Legacy configuration has no provider, scenario:Explicit webhook provider/Provider is unsupported, scenario:Optional webhook setup/User skips webhook, scenario:Optional webhook setup/User disables webhook, scenario:Optional webhook setup/User configures generic HMAC, scenario:Optional webhook setup/User configures generic Bearer authentication, scenario:Optional webhook setup/User configures Discord, scenario:Optional webhook setup/Provider and authentication are incompatible, task:1.1, task:1.2, task:1.3, task:1.4
- level: unit
- purpose: prove provider selection, legacy generic compatibility, override precedence, authentication compatibility, transactional writes, localization, and redaction
- preconditions: load bounded global and project settings fixtures for legacy generic, explicit generic, Discord, unsupported provider, and incompatible authentication cases
- action: parse effective settings and exercise CLI and complete-configuration preserve, disable, configure, cancel, and doctor paths
- expected: only valid explicit generic or Discord configurations are committed, legacy settings remain generic, and all human output is localized and credential-free
- failure: invalid settings were persisted, legacy behavior changed, provider authority was inferred, or a URL or credential was exposed
- disposition: required

#### TC-2: Discord canonical rendering
- maps: scenario:Canonical privacy boundary before adaptation/Discord event is rendered, scenario:Discord incoming webhook rendering/Discord accepts terminal notification, scenario:Discord incoming webhook rendering/Discord is configured with generic authentication, scenario:Discord incoming webhook rendering/Discord text exceeds its bound, scenario:Redacted non-blocking webhook delivery/Provider-native notification, task:2.1, task:2.2, task:2.3
- level: unit
- purpose: prove Discord rendering consumes only the bounded normalized event and produces a safe valid message envelope
- preconditions: construct canonical terminal events in both locales with maximum identifiers, evidence, Unicode, mention syntax, and privacy-shaped source values
- action: render Discord requests and inspect content, allowed mentions, truncation boundaries, stable opaque identity, and excluded fields
- expected: every request has non-empty bounded content, disables parsed mentions, preserves valid Unicode, and contains no raw or private source data
- failure: Discord receives an empty or oversized message, mention parsing remains enabled, text is corrupted, or private data escapes normalization
- disposition: required

#### TC-3: production delivery and terminal truth
- maps: scenario:Provider-aware delivery preserves terminal truth/Discord returns a non-success status, scenario:Provider-aware delivery preserves terminal truth/Pi exits during retry, scenario:Optional dispatch notification/Dispatch notification disabled, scenario:Optional dispatch notification/Dispatch notification enabled, scenario:Optional dispatch notification/Provider delivery fails, scenario:Explicit change terminal reporting/Captain reports completion, scenario:Explicit change terminal reporting/Captain reports verified completion, scenario:Explicit change terminal reporting/Legacy uncorrelated completion payload is used, scenario:Explicit change terminal reporting/Captain reports a non-complete terminal state, scenario:Explicit change terminal reporting/Provider notification fails, scenario:Explicit change terminal reporting/Assistant turn ends, scenario:Explicit change terminal reporting/Assistant turn or worker report ends, task:3.1, task:3.3, task:3.4
- level: integration
- purpose: prove production normalization, adapter selection, retry transport, change notification, and dispatch notification preserve first-terminal truth
- preconditions: start local accepting and rejecting Discord-compatible receivers and create valid change and dispatch lifecycle fixtures
- action: deliver successful, rejected, timed-out, abandoned, disabled, and uncorrelated events through the production notifier and lifecycle seams
- expected: valid terminal events use the configured adapter once, bounded attempts settle truthfully, and receiver outcomes never create or modify terminal state
- failure: adapter selection was bypassed, retries became unbounded, notification failure changed lifecycle truth, or quietness fabricated a terminal event
- disposition: required

#### TC-4: explicit safe webhook probe
- maps: scenario:Explicit production-path webhook probe/Discord probe succeeds, scenario:Explicit production-path webhook probe/Receiver rejects payload, scenario:Explicit production-path webhook probe/Doctor examines valid settings, scenario:Redacted non-blocking webhook delivery/User explicitly tests delivery, scenario:Redacted non-blocking webhook delivery/Doctor runs without a delivery probe, task:3.2, task:3.3, task:4.1
- level: e2e
- purpose: prove the user-facing test operation crosses the production provider path while ordinary doctor remains network-side-effect free
- preconditions: run the built CLI with effective Discord settings and local accept and reject receivers that count requests
- action: invoke the explicit webhook test operation for success and rejection, then invoke doctor against the same settings
- expected: test sends one bounded Discord-native diagnostic and reports safe provider-aware status while doctor sends no request and claims no delivery health
- failure: the probe bypassed production rendering, leaked receiver data, produced ambiguous success, or doctor performed an outbound request
- disposition: required

#### TC-5: generic regression and release privacy
- maps: scenario:Provider protocol acceptance coverage/Local protocol receiver captures requests, scenario:Provider protocol acceptance coverage/Release privacy scan runs, scenario:Redacted non-blocking webhook delivery/Generic HMAC notification, scenario:Redacted non-blocking webhook delivery/Receiver remains unavailable, scenario:Redacted non-blocking webhook delivery/Pi process exits during retry, task:1.2, task:3.1, task:3.3, task:4.2, task:4.3
- level: regression
- purpose: preserve generic HMAC and Bearer delivery while enforcing repository and release privacy for Discord support
- preconditions: use local generic receivers, protocol-safe Discord fixtures, and generated privacy-shaped forbidden fixture cases without real external credentials
- action: compare generic request bodies and authentication headers, exercise bounded failure and abandonment, and run targeted release privacy scanning
- expected: generic behavior remains compatible, private fixtures are rejected, safe protocol fixtures pass, and no delivery is persisted after process abandonment
- failure: generic integrations regressed, privacy scanning weakened, external credentials entered fixtures, or retry state escaped the current process
- disposition: required

### Gates

#### G-1: strict OpenSpec validity
- maps: task:4.1, task:4.3
- intent: run strict validation for the Discord-only change and all repository OpenSpec items
- scope: proposal, design, delta requirements, task mappings, current main specifications, and parser-resolved test-and-gate plan
- pass: openspec validate --all --strict exits zero and the production plan boundary resolves every current scenario and task mapping
- disposition: required
- phase: completion
- waiver: no waiver is permitted for official OpenSpec validity
- floor: openspec

#### G-2: notification privacy
- maps: scenario:Canonical privacy boundary before adaptation/Discord event is rendered, scenario:Provider protocol acceptance coverage/Release privacy scan runs, scenario:Redacted non-blocking webhook delivery/Provider-native notification, task:1.1, task:1.2, task:1.4, task:2.1, task:2.3, task:3.1, task:3.2, task:3.3, task:4.2, task:4.3
- intent: run canonical-boundary, redaction, credential-output, and release privacy tests against exact Discord source and fixtures
- scope: settings output, CLI diagnostics, adapter body, retry failures, local receiver fixtures, source manifest, and release scanner
- pass: tests and scanning exit zero without URL, token, raw receiver body, prompt, report, command output, private path, or concrete external credential exposure
- disposition: required
- phase: completion
- waiver: privacy checks cannot be waived or weakened and privacy-shaped fixtures must use safe generated composition
- floor: privacy

#### G-3: provider configuration security
- maps: scenario:Explicit webhook provider/Provider is unsupported, scenario:Discord incoming webhook rendering/Discord is configured with generic authentication, scenario:Optional webhook setup/Provider and authentication are incompatible, task:1.1, task:1.2, task:1.3, task:1.4, task:2.2
- intent: run prospective validation and atomic settings mutation tests for provider, authentication, credential removal, and project override boundaries
- scope: global and project settings, mode permissions, shadowed credentials, unsupported providers, and incompatible direct Discord authentication
- pass: every invalid configuration fails before write, existing bytes remain unchanged, disabled settings remove credentials, and no silent provider or thinking fallback occurs
- disposition: required
- phase: completion
- waiver: no waiver is permitted for configuration or credential security
- floor: security

#### G-4: generic and Discord compatibility
- maps: scenario:Explicit webhook provider/Legacy configuration has no provider, scenario:Discord incoming webhook rendering/Discord accepts terminal notification, scenario:Provider protocol acceptance coverage/Local protocol receiver captures requests, scenario:Redacted non-blocking webhook delivery/Generic HMAC notification, task:1.2, task:2.2, task:2.3, task:3.1, task:3.3
- intent: exercise exact generic and Discord protocol request shapes through local compatible receivers
- scope: legacy generic fallback, canonical generic JSON, HMAC and Bearer headers, Discord content, allowed mentions, content type, timeout, and retry behavior
- pass: existing generic acceptance remains unchanged and Discord receivers accept the rendered non-empty message without unsupported API assumptions
- disposition: required
- phase: completion
- waiver: source-only codec snapshots cannot replace production-transport compatibility evidence
- floor: compatibility

#### G-5: lifecycle and terminal truth
- maps: scenario:Provider-aware delivery preserves terminal truth/Discord returns a non-success status, scenario:Provider-aware delivery preserves terminal truth/Pi exits during retry, scenario:Optional dispatch notification/Provider delivery fails, scenario:Explicit change terminal reporting/Provider notification fails, scenario:Explicit change terminal reporting/Assistant turn ends, scenario:Explicit change terminal reporting/Assistant turn or worker report ends, task:3.1, task:3.4, task:4.3
- intent: run rejected, timeout, abandonment, disabled, quiet-assistant, worker-report, and first-terminal lifecycle cases
- scope: change runs, dispatch runs, delivery bookkeeping, retries, cancellation, notification count, and terminal status
- pass: delivery remains observational and non-blocking, creates no additional terminal event, and never changes or infers change or dispatch terminal truth
- disposition: required
- phase: completion
- waiver: no waiver is permitted for lifecycle or terminal truth
- floor: terminal-truth

#### G-6: production-path webhook acceptance
- maps: scenario:Explicit production-path webhook probe/Discord probe succeeds, scenario:Explicit production-path webhook probe/Receiver rejects payload, scenario:Explicit production-path webhook probe/Doctor examines valid settings, scenario:Redacted non-blocking webhook delivery/User explicitly tests delivery, scenario:Redacted non-blocking webhook delivery/Doctor runs without a delivery probe, task:3.2, task:3.3, task:4.1, task:4.3
- intent: run the built user-facing webhook test command against local accept and reject receivers and run doctor with request counting
- scope: effective settings, canonical normalization, Discord adapter, production HTTP transport, bounded result rendering, and doctor side effects
- pass: accepted probe reports success, rejected probe reports bounded failure without secrets or raw body, and doctor emits zero outbound requests
- disposition: required
- phase: completion
- waiver: only when the official CLI host cannot execute locally, with a concrete environment reason and fresh mapped production-seam alternative evidence
- floor: e2e

## Risks / Trade-offs

- **[Discord contract evolves]** → Keep the codec small and cover exact request shape with a local receiver E2E.
- **[Message truncation hides context]** → Include stable opaque identifiers and an omission marker; retain full private evidence only in Horsepower state.
- **[Existing Discord URLs marked generic remain broken]** → Preserve backward compatibility rather than silently reinterpret them; test remediation tells users to reconfigure provider `discord`.
- **[Live probes create visible noise]** → Require an explicit test action and mark the message as a connectivity test.
- **[Receiver details leak data]** → Report only safe failure classes/status and discard raw response bodies.

## Migration Plan

1. Add provider-aware types, validation, codec, and tests while defaulting missing provider to `generic`.
2. Extend CLI and interactive configuration; reject incompatible provider/auth combinations before write.
3. Add the explicit webhook test operation and localized remediation.
4. Update English/Chinese documentation and privacy tests.
5. Run the confirmed targeted/required plan and install a new immutable alpha only if the existing release discipline requires installed acceptance for the implementation campaign.
6. Roll back by activating the prior immutable release; older code must diagnose unsupported new settings rather than silently reinterpret them.

## Open Questions

None for the confirmed Discord-only scope.
