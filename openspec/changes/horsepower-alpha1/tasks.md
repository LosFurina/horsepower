## 1. Project Foundation

- [x] 1.1 Initialize the private Node.js 22.19+ TypeScript project with strict ESM compilation, Vitest, deterministic CLI/extension bundles, MIT license, and repository-wide `check` command; verify metadata, typecheck, tests, and both build artifacts.
- [x] 1.2 Implement global/project path resolution and mode-0600 transactional JSON storage with atomic rename, temporary-file cleanup, unknown-field preservation, and malformed-JSON diagnostics; verify with focused filesystem tests.

## 2. Model and Agent Configuration

- [x] 2.1 Implement capability-slot schema, required slots, custom IDs, project-over-global precedence, built-in fallbacks, cycle detection, model/thinking bindings through `max`, and deterministic revision hashing; verify all resolution and validation cases.
- [x] 2.2 Implement deterministic bundled/global/project agent discovery with model-neutral frontmatter, short bundled roles, precedence, safe tool allowlists, and rejection of concrete model bindings; verify neutrality and private-data scans.

## 3. Worker Runtime

- [x] 3.1 Implement safe Pi argv construction and LF JSONL RPC transport with UTF-8 chunk framing, request correlation, bounded stderr, delegation-tool exclusion, `shell: false`, and close/error rejection; verify fragmented and out-of-order protocol cases.
- [x] 3.2 Implement the byte-bounded cursor event stream and persistent worker manager covering create, initial send, send, wait, follow-up, steer, semantic abort, status, read, list, destroy, destroy-all, eight-worker limit, prompt cleanup, retries, crashes, timeouts, and forced shutdown; verify all lifecycle cases with fake RPC children.
- [x] 3.3 Implement explicit one-shot `single`, `parallel`, and `chain` execution with required slots, eight-task input limit, four-child concurrency, prior-output substitution, abort escalation, usage capture, and 50 KiB display truncation; verify no implicit expansion or nested delegation.

## 4. OpenSpec Boundary and Pi Extension

- [x] 4.1 Implement process-lifetime run lifecycle, Captain-selected E2E verification and explicit waiver gate, explicit change terminal reporting, dispatch terminal transitions, and optional redacted webhook delivery with HMAC/Bearer/none authentication plus bounded non-blocking in-process retries; verify no quiet-turn inference, no unit-only completion, no idle-worker notification, no terminal-state mutation on delivery failure, and no persisted retry outbox.
- [x] 4.2 Implement the official OpenSpec CLI boundary for version detection, project initialization/status/validation checks, and advancing-versus-safe-action authorization without creating or modifying OpenSpec facts; verify missing, unsupported, invalid, and healthy contexts.
- [x] 4.3 Implement the explicit orchestration facade and strict `horsepower_subagent` TypeBox contract for one-shot and persistent actions, model-registry validation, run IDs, terminal reporting, E2E evidence/waiver input, path-specific input errors, and captain-only creation; verify no branch creates unrequested workers.
- [x] 4.4 Implement the generation-safe process-global runtime and Pi extension lifecycle so workers and in-process notification retries survive new/resume/fork, are destroyed or abandoned on reload/quit/exit as specified, and only Horsepower-namespaced tools and commands are registered; verify singleton reuse, cleanup, OpenSpec gating, notification lifecycle, and coexistence.
- [ ] 4.5 Implement explicit `managed`/`inline` handoff modes, private bounded brief/report/attachment workspaces, opaque artifact references, persistent-message handoff continuity, retained manifest/digest evidence, and safe list/inspect/clean operations without creating OpenSpec facts or conversation recovery; verify mode enforcement, report-required success, permissions, atomic writes, traversal/link rejection, size/count bounds, cross-project isolation, retention, cleanup, and purge behavior.
- [ ] 4.6 Implement Captain-defined finite review campaigns with explicit acceptance scope, dispatch-budget consumption, root-cause finding deduplication, no verdict-triggered automatic continuation, and human-reasoned budget overrides; verify workers cannot create/reset/increase budgets, repeated variants cannot manufacture new scope, exhaustion blocks dispatch, and campaign evidence does not modify OpenSpec facts.

## 5. CLI and Installation

- [x] 5.1 Implement CLI parsing plus setup, configure, slots, set, unset, webhook configuration/test, doctor, staged-release preflight, and safe uninstall/purge commands with deterministic JSON flags, secret redaction, transactional mode-`0600` configuration, notification diagnostics, OpenSpec diagnostics, symlink ownership checks, and no model-provider mutation; verify command and filesystem behavior.
- [x] 5.2 Implement deterministic GitHub Release staging, manifest/internal digests, archive/checksum generation, Pi extension/skill layout, and private-data scanning; verify the allowlisted archive, executable bits, checksum, model neutrality, and absence of private paths or credentials.
- [ ] 5.3 Implement the POSIX curl bootstrap for Linux/macOS with official OpenSpec prerequisite checks, safe archive inspection/extraction, atomic `current` activation, conflict-safe stable links, optional `/dev/tty` webhook setup supporting skip/HMAC/Bearer/none and dispatch opt-in, rollback on failed doctor, and no copy/sudo/shell-profile/Pi-package operations; verify clean, skipped-webhook, authenticated-webhook, repeated, hostile, conflicting, and rollback installations.
- [ ] 5.4 Implement idempotent CLI `enable`/`disable` for only the Horsepower extension and skill links, preserving the CLI link, active release, versions, configuration, memory, state, handoffs, and overrides; verify full preflight, owned/absent/conflict states, all-or-nothing rollback, doctor enabled/disabled/partial/conflict diagnostics, unsupported-platform behavior, and delayed effect until Pi `/reload` or restart.

## 6. Acceptance and Release Gates

- [ ] 6.1 Add mandatory real Pi extension-loading and two-turn worker E2E smoke coverage, managed handoff brief/report/retention/cleanup E2E coverage, enable/disable/reload E2E coverage, webhook receiver E2E coverage, Captain completion-gate E2E coverage, English/Chinese documentation, exact tool/slot/handoff/terminal/E2E-waiver references, retry-loss, handoff-not-resume, and process-isolation limitations, GitHub-only installation instructions, OpenSpec ownership guidance, and safe disable/uninstall/purge documentation; verify forbidden-reference and private-data scans.
- [ ] 6.2 Add Ubuntu/macOS CI, alpha verification, and tag-only GitHub Release workflows that run unit/integration tests plus mandatory E2E smoke gates, build and scan the release, exercise installer/webhook/Pi scenarios, confirm version agreement, and upload only archive/checksum assets without publishing or pushing automatically.
