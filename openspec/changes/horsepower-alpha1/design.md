## Context

Horsepower starts from a proven self-authored persistent Pi RPC subagent implementation and the execution-governance concepts formerly maintained as AgentFlow. It becomes an independent, model-neutral Pi extension and CLI distributed from `LosFurina/horsepower`.

The official Fission-AI/OpenSpec project is a mandatory external dependency. OpenSpec owns change exploration, proposal, specifications, design, tasks, apply progress, verification, synchronization, and archive facts. Horsepower is only the multi-agent execution engine available while official OpenSpec skills execute those facts. It must not create another change store, planning format, task checkbox system, verification artifact, archive process, or resume source.

The first release targets Node.js 22.19+, Pi 0.80.10-compatible extension/RPC interfaces, OpenSpec 1.6.0+, Linux, and macOS. It is installed globally but reads project-local OpenSpec and Horsepower configuration from the active project.

## Goals / Non-Goals

**Goals:**

- Provide explicit captain-controlled one-shot and persistent subagent execution.
- Preserve persistent worker context for the lifetime of the host Pi process.
- Resolve all worker models through user-configured semantic capability slots.
- Enforce an eight-worker limit, prohibit recursive delegation, and make abort distinct from destroy.
- Allow official OpenSpec apply/verify skills to use Horsepower without changing OpenSpec artifact semantics.
- Keep observation and cleanup available even when OpenSpec is broken or unavailable.
- Package and install verified GitHub Releases through stable symlinks without Pi package installation.
- Keep public resources model-neutral and free of private configuration.

**Non-Goals:**

- Reimplementing or wrapping OpenSpec's artifact workflow, task tracking, verification, sync, or archive behavior.
- Installing, bundling, patching, or updating OpenSpec.
- Providing another planning document format or project change database.
- Automatic team creation, fanout, worker expansion, or recursive workers.
- Persisting live model conversations across host process restarts.
- Providing an OS sandbox, container, credential isolation, or worktree isolation.
- Publishing Horsepower to npm or installing it through Pi's package manager.
- Supporting Windows in the initial release.

## Decisions

### 1. OpenSpec remains the only change-fact system

Horsepower checks the official `openspec` CLI, version, project initialization, status, and validation before actions that create or advance work. It does not parse or rewrite OpenSpec artifact formats for its own state machine and does not modify OpenSpec-generated skills or prompts.

OpenSpec's generated Pi skills remain the top-level workflow entry. Those skills read and update official artifacts. When multi-agent execution is useful, the captain explicitly invokes Horsepower and then continues the official OpenSpec flow.

Advancing actions are:

```text
single, parallel, chain, create, send, steer
```

Safe observation and cleanup actions remain available without valid OpenSpec context:

```text
status, list, read, abort, destroy, doctor
```

Alternative rejected: a Horsepower-native artifact store plus OpenSpec adapter. It creates two possible facts and unnecessary compatibility work.

### 2. External documents are one-way inputs to OpenSpec

If an external design or plan predates an OpenSpec change, its approved content is migrated into official OpenSpec artifacts. The external files must then be removed after user confirmation and digest verification before development begins. Horsepower never synchronizes two document sources.

Alternative rejected: warning-only coexistence. Competing plans make completion and resume ambiguous.

### 3. Capability slots separate role from model

Agent definitions describe a working perspective and tool allowlist. They never bind a model. Every one-shot task, chain step, and persistent creation explicitly names a slot.

Required slots are `judgment`, `craft`, and `utility`; optional built-in fallbacks are `speed -> utility` and `context -> judgment`. Project bindings override global bindings. Resolution reports requested slot, resolved slot, model, thinking, fallback path, and normalized revision.

Alternative rejected: role-level default models. It hides model choice and leaks maintainer-specific mappings into public resources.

### 4. One worker runtime: independent Pi RPC processes

Each persistent worker launches:

```text
pi --mode rpc --no-session
```

with `shell: false`, explicit model/thinking/tools, a mode-`0600` prompt file, and exclusions for all delegation tools. LF-delimited JSON requests use unique request IDs; Pi events drive message and worker state.

The manager interface is:

```text
create, send, abort, status, read, list, destroy, destroyAll
```

`abort` waits for semantic evidence that the active turn stopped and preserves the process. `destroy` terminates the process, rejects waiters, removes temporary resources, and removes the worker.

Alternative rejected: Pi's in-process agent session runtime. Separate RPC processes provide the required context isolation and a single implementation for every worker.

### 5. Process-global lifetime with generation-safe ownership

A manager record is stored at `Symbol.for("horsepower.runtime")`. New extension instances created by Pi `new`, `resume`, and `fork` acquire the same record. `reload` and `quit` destroy workers and remove the record. Idempotent host exit/signal handlers are a final cleanup backstop.

Each record has a generation ID. A stale extension lease may only clean up the generation it acquired, preventing it from deleting a replacement manager.

### 6. Event-driven truthful state

Worker states are `starting`, `idle`, `running`, `failed`, `destroying`, and `destroyed`. Message states distinguish `accepted`, `queued`, `running`, `completed`, `failed`, and `canceled`.

RPC command acknowledgement is transport evidence only. Completion, failure, and cancellation require corresponding Pi events. Each worker stores monotonically cursor-tagged events in a 10 MiB byte-bounded buffer with compact and detailed projections.

Unexpected process exit marks a worker failed. Workers are never automatically restarted because the conversation cannot be reconstructed truthfully.

### 7. One-shot execution shares safety rules

`single`, `parallel`, and `chain` use Pi JSON mode and the same slot resolution, prompt-file handling, tool exclusions, bounded stderr, and safe spawn policy as persistent workers. Parallel accepts at most eight tasks and starts at most four children concurrently. Displayed output is capped at 50 KiB per task.

### 8. Deep module seams

The implementation is divided by stable interfaces:

- `config`: path resolution and transactional JSON writes.
- `slots`: schema, precedence, fallback, validation, and revision.
- `agents`: model-neutral definition discovery.
- `rpc-transport`: LF JSONL framing and request correlation.
- `persistent-manager`: worker/message/event lifecycle.
- `one-shot`: single/parallel/chain execution.
- `openspec-boundary`: official CLI detection and permission to advance work, without owning OpenSpec facts.
- `orchestration`: validates explicit dispatch and delegates to runtimes.
- `global-runtime`: process-level ownership and cleanup.
- `extension`: thin Pi registration and context adapter.
- `cli`: setup, slot configuration, doctor, and uninstall.
- `release`: deterministic archive construction, scanning, and bootstrap installation.

Dependencies are injected at these seams so tests can use fake processes, registries, filesystems, and OpenSpec command results.

### 9. GitHub Release distribution and stable links

A release contains one `horsepower/` root with built CLI, extension, Pi skill, resources, private package metadata, and `release-manifest.json`. An external SHA-256 asset verifies the archive; the manifest verifies version, compatibility, entry points, and critical internal digests.

Installation layout:

```text
~/.pi/agent/horsepower/
  versions/v<version>/
  current -> versions/v<version>
  model-slots.json
  settings.json
  standards/
  workflows/
  personas/
  memory/
  state/

~/.pi/agent/extensions/horsepower
  -> ~/.pi/agent/horsepower/current/pi/extensions/horsepower
~/.pi/agent/skills/horsepower
  -> ~/.pi/agent/horsepower/current/pi/skills/horsepower
~/.local/bin/horsepower
  -> ~/.pi/agent/horsepower/current/bin/horsepower
```

The installer atomically switches `current`, refuses unrelated path conflicts, never copies resources, never uses `sudo`, and never edits shell startup files. It requires an already installed supported OpenSpec CLI but does not require the current directory to be initialized during global Horsepower installation.

### 10. Product namespaces and coexistence

The extension registers `horsepower_subagent` and Horsepower-specific commands. It does not register `/team`, `team_*`, or generic `subagent`, and it never removes another extension. OpenSpec-generated `.pi/skills` and `.pi/prompts` remain untouched.

### 11. Incremental delivery

Alpha 1 delivers slots, agent discovery, one-shot and persistent RPC execution, OpenSpec execution gating, CLI setup/doctor/uninstall, release construction, curl installation, tests, and CI.

Later changes may add richer execution governance—coder routing, tester/reviewer orchestration, Coder Guard, standards, personas, and TUI—but those features must continue to leave all planning and historical facts with OpenSpec.

## Risks / Trade-offs

- **OpenSpec CLI changes** → Keep interaction CLI-first, test the minimum supported official contract, fail clearly on incompatible behavior, and avoid parsing undocumented internals.
- **Users can call ordinary OpenSpec apply without Horsepower** → This is valid; Horsepower is an execution enhancement, not owner of OpenSpec facts or an enforcement patch over official skills.
- **OpenSpec unavailable during worker activity** → Block advancing operations but preserve status/read/abort/destroy.
- **Symlink support or permissions fail** → Stop with guidance; never copy as fallback.
- **A GitHub release account is compromised** → Checksums protect transfer integrity but not publisher compromise; release workflows, allowlists, scans, and review remain required.
- **Process isolation is mistaken for security isolation** → Documentation states workers share the user's filesystem, environment, credentials, and network.
- **Provider retry/event variations break correlation** → Keep transport parsing isolated, test real Pi events, and represent uncertainty as failure rather than false completion.
- **External source deletion loses information** → Validate migrated OpenSpec artifacts first, require user confirmation, compare source digest, and rely on Git history for tracked files.

## Migration Plan

1. Initialize OpenSpec 1.6.0 with official Pi integration.
2. Create `horsepower-alpha1` using the official `spec-driven` schema.
3. Migrate approved proposal, behavioral requirements, design decisions, and implementation tasks into official artifacts.
4. Run strict OpenSpec validation and compare migrated coverage with the prior documents.
5. Delete the prior competing design/plan documents and commit the OpenSpec change as the sole source.
6. Implement alpha tasks through the official OpenSpec apply flow.
7. Build and locally test release artifacts without tagging, pushing, or publishing until explicitly requested.

Rollback before implementation is restoring the prior Git commit. Runtime installation rollback restores the previous `current` symlink target and configuration backup when activation verification fails.

## Open Questions

None. Product and integration decisions required for alpha implementation are approved.
