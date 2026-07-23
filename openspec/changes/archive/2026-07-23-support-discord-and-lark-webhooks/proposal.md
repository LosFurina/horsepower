## Why

Horsepower currently posts its generic terminal-event JSON directly to every configured webhook. Discord incoming webhooks require a different message envelope, so valid Horsepower notifications are rejected as empty messages even though connectivity and static configuration diagnostics pass.

## What Changes

- Add an explicit webhook provider setting with a first-party `discord` adapter while retaining the existing `generic` Horsepower event protocol.
- Render the already-redacted bounded terminal event into Discord's required text-message envelope without exposing prompts, reports, credentials, private paths, or unrestricted evidence.
- Extend complete interactive configuration and the webhook CLI to select and validate the provider transactionally.
- Make diagnostics distinguish configuration validity from an actual provider-compatible delivery probe and return bounded, credential-free failure information.
- Document Discord setup, supported authentication combinations, payload limits, retries, and migration of existing webhook settings.
- Preserve non-blocking delivery, bounded in-process retries, terminal-status independence, project override behavior, localization, and release privacy guarantees.

## Capabilities

### New Capabilities
- `platform-webhook-delivery`: Provider-aware formatting, validation, delivery, diagnostics, and privacy requirements for Discord incoming webhooks.

### Modified Capabilities
- `github-release-installation`: Complete configuration and webhook CLI must collect, validate, persist, redact, and diagnose the explicit webhook provider while migrating existing settings safely.
- `explicit-dispatch`: Optional dispatch notifications must use the configured provider adapter without changing dispatch terminal truth.
- `openspec-execution-boundary`: Optional change-terminal notifications must use the configured provider adapter without inferring completion or changing change terminal truth.

## Impact

Affected areas include webhook configuration parsing and precedence, CLI and interactive configuration, terminal-event normalization, notifier transport, doctor output, English/Chinese localization, release privacy scanning, documentation, and unit/E2E acceptance. Discord remains an external HTTP system; tests will use a local protocol-compatible receiver and bounded opt-in live diagnostics rather than embedding real webhook URLs or tokens.
