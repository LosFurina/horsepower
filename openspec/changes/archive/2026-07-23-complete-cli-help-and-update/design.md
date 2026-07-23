## Context

Help is currently global rather than path-specific, while update is absent despite an existing verified immutable installer contract. Both features meet at CLI registration and packaged acceptance. The implementation must stay small without weakening archive verification, rollback, privacy, compatibility, or help side-effect guarantees.

## Goals / Non-Goals

**Goals:**

- Provide recursive localized text/JSON help from the executable registry.
- Add a bounded official-release updater using shared verification and atomic activation.
- Preserve immutable versions, state, integration enablement, and truthful rollback results.
- Verify the work with three focused cases and four required gates.

**Non-Goals:**

- Background updates, downgrade support, arbitrary repositories, real GitHub tests, shell completion, man pages, full regression/platform matrices, or automatic Pi restart.

## Decisions

### 1. One recursive executable/help registry

Each public node owns its name, localized description, usage/options/examples, children, and handler. Help resolves the longest path before platform checks or handler construction. Unknown paths remain errors. This avoids a second drifting help table.

### 2. Internal updater with injected transport

`horsepower update [--version VERSION]` uses typed injected transport and filesystem/process seams. It accepts only the official HTTPS repository/release identity, applies bounded redirects/timeouts/downloads, and never executes a downloaded script. `install.sh` remains the fresh-install interface.

### 3. Reuse strict immutable release verification

Before placement, the candidate must satisfy checksum, safe archive, exact layout, manifest/digest, compatibility, and entry-point validation. It enters only an absent `versions/vVERSION`; existing directories are never overwritten. A lock serializes mutation.

### 4. Atomic activation with rollback

The updater snapshots verified `current` and integration state, atomically switches `current`, runs the new CLI's installation-only doctor, and restores the prior target on failure. Settings, state, handoffs, old versions, and running Pi processes are untouched.

## Test and Gate Plan

### Profiles
- testIntensity: targeted
- gateStrictness: required

### Test Cases

#### TC-1: recursive CLI help
- maps: scenario:Complete top-level CLI help/User requests top-level help, scenario:Complete top-level CLI help/A new public command is registered, scenario:Help for every public command path/First-level command help is requested, scenario:Help for every public command path/Nested command help is requested, scenario:Help for every public command path/Parent command has nested actions, scenario:Help for every public command path/Unknown help path is requested, scenario:Help requests are side-effect-free/Help targets a mutating command, scenario:Help requests are side-effect-free/Help targets a networked or discovery command, scenario:Help requests are side-effect-free/Platform is unsupported, scenario:Localized and machine-readable help/Chinese help is requested, scenario:Localized and machine-readable help/English help is requested, scenario:Localized and machine-readable help/JSON help is requested, scenario:Packaged CLI help parity/Release CLI is verified, scenario:Packaged CLI help parity/Packaged registry differs from source expectations, task:1.1, task:1.2
- level: unit
- purpose: prove every public command path has complete localized text and JSON help from the executable registry without side effects
- preconditions: construct the production registry with dependency spies and temporary installation and configuration roots
- action: enumerate every path through long, short, explicit help, localized, JSON, and unknown-path forms
- expected: valid paths return exact bounded help before platform or handler activity and unknown paths fail without mutation
- failure: a path is missing, metadata drifts, help invokes business activity, localization changes machine tokens, or unknown help is substituted
- disposition: required

#### TC-2: successful immutable update
- maps: scenario:CLI-driven official release update/A newer latest release exists, scenario:CLI-driven official release update/Current release is latest, scenario:CLI-driven official release update/Exact version is requested, scenario:Update preserves immutable verified installation/Candidate is valid and new, scenario:Update preserves immutable verified installation/Version destination already exists, scenario:Atomic update activation and rollback/Enabled installation updates successfully, scenario:Atomic update activation and rollback/Disabled installation updates successfully, scenario:Update preserves user state and avoids setup side effects/Existing configuration and retained state are present, scenario:Update preserves user state and avoids setup side effects/Pi process is running, scenario:Update preserves user state and avoids setup side effects/Update runs without a terminal, scenario:Localized structured update outcomes/Chinese update succeeds, scenario:Localized structured update outcomes/JSON update is requested, scenario:Complete update command help/Update help is requested, scenario:Complete update command help/Top-level help is requested, scenario:Complete update command help/Packaged update help is verified, task:2.1, task:2.2, task:3.1
- level: e2e
- purpose: prove the packaged CLI can safely resolve, verify, place, activate, and post-validate one local official-shaped release fixture
- preconditions: create a temporary prior immutable installation, retained user state, and a bounded local injected release transport
- action: run update to a newer fixture, inspect current and retained bytes, then run the equal-version no-op and update help
- expected: the new verified version becomes current, old versions and user state remain unchanged, no-op downloads nothing, and help has no side effect
- failure: verification is bypassed, bytes are overwritten, state changes, activation is non-atomic, no-op downloads assets, or help enters update logic
- disposition: required

#### TC-3: update rejection and rollback
- maps: scenario:CLI-driven official release update/Latest resolution is untrusted or unavailable, scenario:Update preserves immutable verified installation/Candidate archive is invalid, scenario:Update preserves immutable verified installation/Resolved release is older, scenario:Atomic update activation and rollback/Post-update doctor fails, scenario:Atomic update activation and rollback/Installation ownership is unsafe, scenario:Atomic update activation and rollback/Concurrent update is attempted, scenario:Localized structured update outcomes/Download or verification fails, task:2.1, task:2.2, task:3.1, task:3.2
- level: failure-path
- purpose: prove the compact parameterized rejection matrix preserves or restores installation truth at every security boundary
- preconditions: derive bad-checksum, unsafe-archive, incompatible-manifest, unsafe-ownership, contention, and post-doctor-failure variants from the local fixture
- action: invoke the production updater for each variant and inspect current, immutable versions, retained state, cleanup, and bounded output
- expected: pre-activation failures make no managed mutation, post-activation failure restores current, and no private data or raw receiver body is emitted
- failure: an invalid candidate activates, rollback lies or fails silently, prior bytes change, temporary state survives, or sensitive data appears
- disposition: required

### Gates

#### G-1: strict OpenSpec validity
- maps: task:3.2
- intent: validate the merged proposal, design, delta specs, task mappings, and plan with official OpenSpec
- scope: all repository OpenSpec artifacts and the production-resolved merged plan
- pass: `openspec validate --all --strict` exits zero and every scenario and task mapping resolves
- disposition: required
- phase: completion
- waiver: official OpenSpec validity cannot be waived
- floor: openspec

#### G-2: privacy and redaction
- maps: task:1.1, task:2.1, task:2.2, task:3.1, task:3.2
- intent: assert help and update outputs exclude credentials, response bodies, unsafe paths, and unrestricted transport data
- scope: text and JSON help, resolver failures, archive failures, rollback diagnostics, and packaged fixture output
- pass: focused tests exit zero with only bounded redacted stable facts
- disposition: required
- phase: completion
- waiver: privacy checks cannot be waived or weakened
- floor: privacy

#### G-3: updater security
- maps: task:2.1, task:2.2, task:3.1, task:3.2
- intent: enforce official identity, checksum, archive, manifest, compatibility, immutable placement, ownership, lock, and rollback boundaries
- scope: the parameterized updater tests and local packaged release fixture
- pass: every invalid candidate fails closed and successful activation passes the new CLI doctor
- disposition: required
- phase: completion
- waiver: executable update trust boundaries cannot be waived
- floor: security

#### G-4: compatibility and build
- maps: task:1.2, task:2.2, task:3.1, task:3.2
- intent: preserve existing commands, installer topology, enabled or disabled integration, and supported runtime contracts
- scope: focused help and updater tests plus `npm run typecheck && npm run build` and `git diff --check`
- pass: focused tests, typecheck, build, and diff hygiene all exit zero without changing unrelated behavior
- disposition: required
- phase: completion
- waiver: compatibility and build evidence is mandatory
- floor: compatibility

#### G-5: terminal and activation truth
- maps: task:2.2, task:3.1, task:3.2
- intent: prove update results distinguish unchanged, active, failed, and rolled-back states without inference
- scope: atomic current switching, post-doctor outcome, restoration verification, and localized structured status
- pass: each path reports the filesystem state observed after settlement and never claims failed activation as current
- disposition: required
- phase: completion
- waiver: lifecycle and activation truth cannot be waived
- floor: terminal-truth

#### G-6: packaged local-fixture acceptance
- maps: task:3.1, task:3.2
- intent: cross the built CLI, archive verifier, immutable installation, activation, doctor, no-op, help, and rollback production seams
- scope: one deterministic local packaged E2E with parameterized failure variants and no production network dependency
- pass: the packaged fixture E2E exits zero and preserves old versions and retained state
- disposition: required
- phase: completion
- waiver: E2E requires a concrete reason and fresh mapped alternative evidence when genuinely inapplicable
- floor: e2e

## Risks / Trade-offs

- **[Small suite misses unrelated regressions]** → Keep tests table-driven and focused on public contracts; retain mandatory type/build, strict OpenSpec, privacy assertions, and E2E.
- **[Updater trust surface is security-sensitive]** → Do not reduce checksum, archive, compatibility, immutable placement, or rollback assertions.
- **[Registry metadata drifts]** → Derive test enumeration from the same registry and reject incomplete public nodes.
