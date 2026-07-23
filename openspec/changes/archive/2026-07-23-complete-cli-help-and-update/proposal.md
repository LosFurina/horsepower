## Why

Horsepower needs complete command-specific CLI help and a first-class verified update command. They share the same command registry and packaged CLI acceptance boundary, so implementing them together avoids duplicate plumbing and repetitive tests.

## What Changes

- Add one authoritative recursive registry for execution and localized text/JSON help across every public command path.
- Resolve `--help`, `-h`, and `help <path>` before platform checks, adapters, or business handlers.
- Add non-interactive `horsepower update` for latest or exact official GitHub releases.
- Verify update candidates before immutable placement, atomically switch `current`, preserve user state and integration enablement, and roll back failed post-update verification.
- Keep `install.sh` as the fresh-install interface; do not execute downloaded scripts, overwrite versions, update dependencies, or restart Pi.
- Use a deliberately small `targeted` / `required` plan: one table-driven help case, one successful local-fixture update case, and one parameterized rejection/rollback case.

## Capabilities

### New Capabilities
- `cli-help`: Complete localized, machine-readable, side-effect-free help for every public CLI path.

### Modified Capabilities
- `github-release-installation`: Add verified CLI-driven immutable update and rollback behavior.

## Impact

Affected areas are the CLI registry/dispatcher, localization, release download and verification seams, immutable activation, documentation, focused tests, and one packaged local-fixture E2E. No worker orchestration, OpenSpec authority, model-slot behavior, background updater, or real GitHub test is introduced.
