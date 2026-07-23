## Why

Horsepower can be installed safely from verified GitHub Releases, but an existing installation has no first-class command to discover and activate the newest official release. Users should be able to update through the installed CLI without manually rerunning a remote bootstrap command while retaining the same immutable-release, verification, and rollback guarantees.

## What Changes

- Add `horsepower update` to resolve the latest release from the official `LosFurina/horsepower` GitHub Releases channel and execute a verified update.
- Download and verify the release archive, checksum, manifest, internal digests, expected layout, compatibility, entry points, and ownership constraints before activation.
- Install only into a new immutable version directory, atomically switch `current`, preserve settings/state/handoffs and existing Pi integration enablement, and roll back activation if post-update verification fails.
- Report already-current, successfully-updated, and failed outcomes with stable structured fields in localized text and JSON output.
- Make update non-interactive by default, support explicit release selection for recovery/reproducibility, and never run setup, modify shell startup files, use Pi package management, overwrite an installed version, or automatically reload/restart Pi.
- Add complete `--help`/`-h` metadata and side-effect-free help coverage through the separately proposed authoritative CLI help registry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `github-release-installation`: Add safe in-place discovery, verification, immutable installation, atomic activation, rollback, and public command/help behavior for CLI-driven updates.

## Impact

Affected areas include the CLI command registry and dispatcher, release download/staging/validation and activation modules, installer/shared release primitives, localization, documentation, unit/integration tests, network-adapter fixtures, and packaged immutable-release E2E. The command introduces bounded HTTPS access to the official GitHub release channel but no new package-manager or daemon dependency.
