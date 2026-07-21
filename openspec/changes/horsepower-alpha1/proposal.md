## Why

Pi needs a model-neutral multi-agent execution engine that can keep explicitly created workers alive across turns, route each dispatch through user-defined capability slots, and provide reliable concurrency and lifecycle control. Horsepower must integrate with the official OpenSpec workflow instead of creating a competing planning, task, verification, or archive record.

## What Changes

- Add a private TypeScript project that builds a Pi extension and a Node CLI.
- Add required model capability slots with deterministic fallback and revision semantics.
- Add model-neutral agent discovery and explicit `single`, `parallel`, `chain`, and persistent worker dispatch.
- Add isolated persistent Pi RPC workers with multi-turn context, cursor events, abort, destroy, bounded resources, and process-lifetime reuse.
- Require a supported, initialized Fission-AI/OpenSpec project before any operation that creates or advances work.
- Leave OpenSpec fully responsible for proposal, specs, design, tasks, apply progress, verification, and archive facts.
- Permit status, list, read, abort, destroy, and doctor when OpenSpec is unavailable so workers remain observable and cleanable.
- Distribute only through verified GitHub Release archives installed by a repository-owned curl bootstrap and stable symlinks; do not use npm publishing or Pi package installation.
- Add setup, slot configuration, doctor, safe uninstall, release scanning, CI, and real Pi smoke coverage.
- Add a Captain-controlled verification gate: the Captain explicitly chooses change-specific E2E verification, and completion requires passing evidence or an explicit reasoned E2E waiver with alternative evidence.
- Add optional terminal-state webhook notification at change and dispatch scope, with change notifications enabled by default, dispatch notifications opt-in, HMAC/Bearer/none authentication, redacted payloads, and non-blocking in-process retries.
- Add an explicit managed text-handoff mode for substantial delegated work, with private brief/report artifacts, bounded attachments, opaque references, retained execution evidence, and no competing OpenSpec facts.
- Add Captain-defined review campaigns whose finite budget, fixed acceptance scope, and root-cause deduplication prevent reviewer/fixer loops from expanding or renewing themselves.
- Add CLI `enable` and `disable` operations that atomically manage only the Pi extension and skill links while preserving the CLI link, installed releases, configuration, state, memory, and handoffs.

## Capabilities

### New Capabilities

- `model-slots`: User-configured semantic model slots, deterministic fallbacks, validation, and revision reporting.
- `agent-catalog`: Model-neutral bundled/global/project agent definitions with deterministic precedence.
- `explicit-dispatch`: Captain-only one-shot and persistent dispatch with explicit slot selection and no recursive worker creation.
- `persistent-workers`: Multi-turn RPC worker lifecycle, message delivery, abort/destroy distinction, cursor events, limits, failures, and Pi process lifecycle.
- `openspec-execution-boundary`: Mandatory official OpenSpec prerequisite, Captain-controlled E2E completion gate, and explicit change terminal reporting without duplicating OpenSpec facts or modifying its workflow artifacts.
- `github-release-installation`: GitHub-only release construction, verification, curl installation, optional webhook setup, stable symlinks, diagnostics, and safe uninstall.

### Modified Capabilities

<!-- No existing product capabilities are modified; this is the initial Horsepower change. -->

## Impact

- Creates the Horsepower TypeScript source, tests, bundled resources, Pi extension, CLI, installer, release scripts, documentation, and GitHub workflows.
- Adds private retained handoff artifacts under Horsepower state; these artifacts support Captain-worker communication but never restore a worker conversation or replace official OpenSpec records.
- Adds process-lifetime run coordination and webhook delivery state; this runtime evidence does not replace OpenSpec verification or task facts and is not resumed across Pi processes.
- Requires Node.js 22.19 or newer, Pi 0.80.10-compatible extension/RPC interfaces, and Fission-AI/OpenSpec 1.6.0 or newer.
- Installs Horsepower globally under `~/.pi/agent/horsepower`, links Pi resources under `~/.pi/agent/extensions` and `~/.pi/agent/skills`, and links the CLI under `~/.local/bin`.
- Does not publish to npm, call `pi install`/`pi update`, install OpenSpec, or copy private model/provider configuration.
