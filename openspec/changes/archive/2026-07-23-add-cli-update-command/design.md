## Context

`install.sh` already resolves the official GitHub latest-release redirect, downloads a versioned archive and checksum, checks the exact archive layout and entry types, runs staged `preflight`, installs to `~/.pi/agent/horsepower/versions/vVERSION`, atomically changes `current`, and rolls back if installation-only doctor fails. The TypeScript release module already owns deterministic manifest, digest, compatibility, archive, and staged-tree validation primitives, while the CLI owns installation paths, link ownership, localization, and JSON envelopes.

Rerunning a remote shell bootstrap can update an installation, but it unnecessarily re-enters installer concerns such as Skill audit and complete setup. A first-class updater must operate safely from the currently installed CLI, tolerate that `current` changes while the old process remains alive, preserve enabled/disabled integration state, and never weaken immutable release guarantees.

## Goals / Non-Goals

**Goals:**

- Resolve and execute an update to the latest official GitHub release in one non-interactive command.
- Support exact official-version selection for reproducibility and recovery.
- Reuse one strict release-verification contract across installer, updater, tests, and release production.
- Install immutable versions, atomically activate, post-validate through the new CLI, and roll back failure.
- Preserve settings, retained state, Pi integration enablement, and live Pi processes.
- Provide localized text/JSON outcomes and complete side-effect-free help.

**Non-Goals:**

- Replace `install.sh` as the fresh-install bootstrap.
- Add background polling, automatic scheduled updates, self-restarting daemons, or update notifications.
- Run configuration, Skill audits, model discovery, OpenSpec discovery, or provider probes.
- Delete old versions, migrate user data, or automatically reload running Pi processes.
- Update Pi, OpenSpec, Node, npm packages, or any dependency outside Horsepower's managed release root.
- Permit unverified third-party release repositories or arbitrary archive URLs.

## Decisions

### 1. Implement update as an internal CLI service, not remote script execution

`horsepower update` will call a typed updater service with injected release transport, filesystem/activation, process execution, and clock dependencies. It will not curl-pipe `install.sh` or spawn a downloaded script. This makes bounds, no-side-effect help, structured output, failure injection, and rollback testable and prevents installer setup from changing existing user configuration.

Alternative: fetch and execute official `install.sh`. Rejected because the user asked for an executable update command, but blindly executing remote shell expands the trust surface, duplicates network work, couples update to interactive setup, and makes transactional assertions weaker.

### 2. Use the canonical official release identity and versioned assets

Default discovery follows the official GitHub `releases/latest` identity already used by bootstrap and accepts only a final tag URL for `LosFurina/horsepower` matching `vVERSION`. `--version VERSION` skips latest discovery and targets the exact official release download path. The transport enforces HTTPS, an allowlist, bounded redirects, connect/overall timeouts, and byte caps. Asset names remain `horsepower-vVERSION.tar.gz` and `.sha256`.

Alternative: depend on unauthenticated GitHub API JSON. Rejected as unnecessary for the current release contract and more susceptible to schema/rate-limit handling; a transport abstraction leaves room for a future authenticated API without changing updater authority.

### 3. Extract shared strict installation validation

Archive/checksum parsing, safe-entry inspection, extraction, manifest/digest verification, compatibility validation, installed-tree verification, and owned-link preflight will be reusable library functions called by both updater tests and installer/release verification. The updater first validates in a private mode-0700 temporary root and does not place bytes in managed versions until all staged checks pass.

`install.sh` remains the public bootstrap interface. Sharing may occur by invoking the staged CLI's existing `preflight` plus TypeScript library validation rather than making the shell script import JavaScript internals.

### 4. Compare versions without implicit downgrade

The updater will parse strict Horsepower SemVer, including alpha prerelease identifiers, and compare the active verified manifest version with the resolved candidate. Equal versions return `already_current` before asset download. Default discovery cannot downgrade. An exact `--version` may select an older official release only if the implementation exposes and documents an explicit downgrade confirmation flag in a future change; this change fails closed on downgrade.

Alternative: string comparison. Rejected because alpha sequence ordering and stable/prerelease precedence would be incorrect.

### 5. Preserve immutability and verify existing destinations

A new candidate is atomically renamed from verified staging into absent `versions/vVERSION`. If that directory already exists, updater never writes into it: it either verifies the complete installed tree against the candidate release identity and activates it, or fails. Prior versions are retained.

### 6. Lock mutation and make activation transactional

A no-follow exclusive lock beneath the managed root serializes updater/installer mutation. Before mutation the service records verified `current`, extension link, Skill link, and CLI link state. It rejects partial enablement or conflicts rather than repairing them. Activation creates a sibling symlink and atomically renames it over `current`. Stable owned links are not recreated or removed, so enabled remains enabled and disabled remains disabled.

After switching, the service executes the new `current/bin/horsepower doctor --installation-only --json` with a bounded timeout and environment. Failure restores the exact prior `current` target atomically and verifies restoration. The newly installed immutable version may remain as a verified inactive cache, but output must state that it is installed and not active; no prior bytes are deleted.

### 7. The old process completes the transaction

The updater process starts from the old release path resolved through the stable CLI symlink. Replacing `current` does not replace already loaded code, so the old process retains authority to validate the new executable and perform rollback. It never attempts to re-exec itself or mutate running Pi workers.

### 8. Integrate with the authoritative CLI-help registry

The separate `support-help-for-every-cli-command` change introduces the recursive registry. This change adds `update` as a first-level node with `--version`, `--json`, `--locale`, `--help`, and `-h` metadata. If implementation order is reversed, update must still include complete temporary help coverage and reconcile into the authoritative registry before acceptance. Help resolution precedes updater construction and network/filesystem adapters.

### 9. Test all trust boundaries with local adapters

Unit tests use an injected fake transport and temporary HOME for redirect, timeout, size, checksum, archive, manifest, destination, link, lock, activation, and rollback cases. E2E uses a local HTTPS-equivalent fixture/base override only in test-owned dependency seams, exercises the packaged CLI, and proves no request occurs for help or `already_current`. No test contacts production GitHub.

## Risks / Trade-offs

- **[Updater duplicates installer logic]** → Extract or invoke shared strict verification primitives and add parity tests against the same release fixture.
- **[GitHub latest excludes some prereleases]** → Preserve the repository's established `releases/latest` channel semantics; exact `--version` handles explicitly selected published releases.
- **[Process interruption after activation]** → Use atomic symlink replacement; either old or new target remains valid. Post-validation rollback handles observed failure, while doctor can report interrupted state later.
- **[Concurrent install/update races]** → Require an exclusive bounded lock before shared mutation and fail closed on ownership ambiguity.
- **[A compromised release asset is downloaded]** → Require official identity plus checksum, manifest, critical digests, exact layout, compatibility, and entry-type validation; do not execute staged code before preflight under bounded conditions.
- **[Existing version differs from expected bytes]** → Never overwrite it; reject activation and preserve current.
- **[Running Pi continues old code]** → Explicitly report `/reload` or restart required; do not signal processes.
- **[Cross-change dependency on CLI registry]** → Record integration task and validate both changes together before release while preserving separate OpenSpec scope.

## Migration Plan

1. Add RED updater service tests and packaged CLI tests using temporary installation roots and fake release transport.
2. Extract strict reusable release and installed-tree verification primitives.
3. Implement discovery, SemVer comparison, bounded download, staging, locking, immutable placement, activation, post-validation, and rollback.
4. Register/localize `update`, add text/JSON output, and integrate command-specific help with the authoritative registry.
5. Update English and Chinese documentation and installer/update boundary guidance.
6. Build a deterministic immutable alpha release and test already-current, successful local-fixture update, rollback, disabled integration, help, and no-state-mutation paths.
7. Manually update from the prior immutable alpha to the new published release only after publication and capture fresh acceptance evidence.

Rollback removes the command and updater module. Any verified newly installed version remains an immutable inactive directory; `current`, links, and user state are restored to their prior valid state.

## Open Questions

None. Background or scheduled automatic updating and explicit downgrades require separate future authorization and are not introduced here.
