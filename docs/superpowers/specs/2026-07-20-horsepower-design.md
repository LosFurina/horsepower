# Horsepower Design

**Status:** Proposed for implementation  
**Initial release target:** `0.1.0-alpha.1` through `0.1.0`  
**Repository:** `LosFurina/horsepower`  
**npm package:** `@losfurina/horsepower`  
**CLI:** `horsepower`  
**Pi tools:** `horsepower`, `horsepower_subagent`

## 1. Summary

Horsepower is a model-neutral, explicit-dispatch, stateful multi-agent workflow system for Pi.

The main Pi agent is always the captain. Only the captain may create, message, steer, inspect, or destroy subagents. Workflows, playbooks, model routing, personas, and guards may recommend actions, but may never create workers by themselves.

Every persistent worker is a separate `pi --mode rpc --no-session` child process. Workers retain their full conversation context after completing a task and remain available until the captain explicitly destroys them, Pi reloads extensions, or the host Pi process exits. Horsepower allows at most eight persistent workers and never creates a worker recursively.

Horsepower combines three independently designed concerns:

1. **Persistent subagent runtime** — explicit lifecycle, multi-turn RPC, stable message IDs, cursor-based events, bounded resources, and process isolation.
2. **Workflow governance** — AgentFlow phases, task labels, quality gates, Coder Guard, escalation, standards, personas, OpenSpec integration, archive, and experience memory.
3. **Observability and control** — TUI projections, worker status, usage and cost, message delivery, artifacts, handoff, health evidence, and completion notifications.

Horsepower is an independent implementation. `pi-team` is a design reference for observability and captain-led control; its source and Git history are not imported. AgentFlow resources are adapted from the owner's private `agentflow-codex` repository and released as part of Horsepower under MIT.

## 2. Goals

- Let the captain explicitly create up to eight persistent subagents.
- Let explicitly chosen subagents run concurrently.
- Preserve each worker's context for later follow-up without automatic expiry.
- Prevent workflows, fanout, debate, or workers from implicitly increasing worker count.
- Abstract concrete model names behind user-configured capability slots.
- Require the captain to name the capability slot for every worker creation or one-shot dispatch.
- Ship model-neutral defaults with no provider-specific model IDs.
- Provide AgentFlow's full workflow, standards, gates, personas, state, archive, and memory capabilities.
- Load only the standards and role guidance relevant to the current task.
- Provide human-readable TUI observability and machine-readable event streams.
- Install through Pi's package mechanism and initialize configuration with one CLI command.
- Coexist with `pi-team` and existing `subagent` extensions by using a unique namespace.
- Support user-global and project-local configuration with deterministic override rules.
- Make configuration upgrades safe, versioned, and non-destructive.

## 3. Non-goals

- No automatic team creation.
- No automatic worker fanout or dynamic worker spawning.
- No recursive subagents.
- No worker-created workers.
- No implicit model selection that hides the requested capability slot.
- No built-in concrete provider or model mappings.
- No bundled private agents, private personas, API keys, paths, or model aliases.
- No compatibility adapter for an in-process worker implementation.
- No `createAgentSession()` worker runtime.
- No OS security sandbox, container, worktree isolation, network isolation, or credential isolation in the first release.
- No persistence of live child processes across host Pi process restarts.
- No claim that a disk artifact can restore an in-memory model conversation after a process crash.
- No registration of `/team`, `team_*`, or the generic `subagent` tool by default.

## 4. Core invariants

1. **Explicit dispatch:** A worker exists only after an explicit captain tool call.
2. **Single runtime:** Every worker uses the same RPC process manager.
3. **Bounded population:** At most eight persistent workers exist per host Pi process.
4. **No implicit eviction:** Hitting the limit returns an error; Horsepower never silently destroys another worker.
5. **No recursion:** Worker processes always exclude `horsepower`, `horsepower_subagent`, `subagent`, and known nested-delegation tools.
6. **Stable terminal history:** Workflow/run terminal states never revert to running because of a later post-run conversation.
7. **Process-lifetime persistence:** Idle workers survive task completion and Pi session switches, but not extension reload or host Pi process exit.
8. **Model neutrality:** Public resources refer to capability slots, never private concrete models.
9. **Truthful status:** Accepted, started, completed, failed, canceled, and transport-acknowledged are distinct states.
10. **One source of truth:** RPC process and message events drive worker state, TUI projections, artifacts, and workflow evidence.

## 5. Product vocabulary

### Captain

The main Pi agent. It alone decides which worker to use, the task, the capability slot, concurrency, follow-up, and destruction.

### Worker

A persistent RPC subagent process. A worker has a role, capability slot, resolved model, prompt, tools, status, context, event stream, and lifecycle.

### Agent definition

A Markdown resource describing role identity, guidance, recommended capability slots, and tool allowlist. It does not bind to a public concrete model.

### Capability slot (马槽)

A stable semantic name that resolves to a user-configured concrete model and thinking level.

### Workflow

A phase state machine and set of recommendations/quality gates. It never instantiates workers.

### Dispatch proposal

A workflow, debate, fanout, or playbook recommendation describing suggested explicit worker calls. A proposal is inert data until the captain calls `horsepower_subagent`.

### Run

A recorded workflow episode. A run may reference workers, but worker lifecycle is managed globally by the process-level runtime.

## 6. Capability slots

### 6.1 Built-in slots

| Stable ID | Chinese label | Purpose |
|---|---|---|
| `judgment` | 上等马 | Architecture, security, concurrency, difficult debugging, high-risk review, final judgment |
| `craft` | 中等马 | Normal implementation, integration, API/UI work, ordinary refactoring and bug fixes |
| `utility` | 下等马 | Config, docs, mechanical edits, routine tests, recording and low-risk bounded work |
| `speed` | 快马 | Fast scans, discovery, log triage, context gathering and low-latency answers |
| `context` | 长程马 | Very large diffs, repositories, logs, documents, histories and long-context synthesis |

`judgment`, `craft`, and `utility` are required. `speed` defaults to `utility`; `context` defaults to `judgment`. The same model may fill multiple slots.

All configured worker models must support reliable structured tool calling for the tools granted to the role. Cheap or fast models with malformed tool arguments are not valid worker mappings.

### 6.2 Custom slots

Users may define additional slots, such as `vision`, `research`, or `local`, without changing Horsepower. Custom slot IDs must match `[a-z][a-z0-9-]{0,31}` and may declare a fallback to another slot.

### 6.3 Slot configuration

Global file:

```text
~/.pi/agent/horsepower/model-slots.json
```

Project override:

```text
.pi/horsepower/model-slots.json
```

Schema:

```json
{
  "schemaVersion": 1,
  "slots": {
    "judgment": { "model": "provider/model-a", "thinking": "high" },
    "craft": { "model": "provider/model-b", "thinking": "medium" },
    "utility": { "model": "provider/model-c", "thinking": "off" }
  },
  "fallbacks": {
    "speed": "utility",
    "context": "judgment"
  }
}
```

The loader computes a deterministic revision hash from normalized slot configuration. Guard and artifact records include requested slot, resolved slot, concrete model, thinking level, and configuration revision.

### 6.4 Selection semantics

Every `create`, `single`, `parallel` task, or chain step must name `modelSlot`. Agent definitions and workflow labels may provide recommendations, but omission is an error rather than a silent default.

Resolution is deterministic:

1. Resolve the requested slot in project configuration.
2. Fall back to global configuration.
3. Follow explicit slot fallback links, with cycle detection.
4. Verify the concrete model exists in Pi's model registry when registry access is available.
5. Verify the configured thinking level is accepted or report a precise configuration error.
6. Resolve health and capability evidence without creating a worker.
7. Return the requested slot, resolved slot, concrete model, thinking level, and fallback reason.

A provider failure may select a configured fallback model for the same slot request, but it never creates an additional worker. A fallback must be visible in the result and artifacts.

## 7. Agent definitions

Global definitions:

```text
~/.pi/agent/horsepower/agents/*.md
```

Project definitions:

```text
.pi/horsepower/agents/*.md
```

Horsepower may also read ordinary Pi agent definitions when explicitly configured, but its own definitions are preferred to avoid collision with other subagent packages.

Example:

```markdown
---
name: reviewer
description: Reviews code for defects and regressions
tools: read,grep,find,bash
recommended_slots: craft,judgment
standards: workflow,review
---

Review actual code and evidence. Do not modify files.
```

No public agent definition contains a concrete model. The captain still passes `modelSlot` explicitly.

Precedence is project definition over global definition over package default. Package defaults remain model-neutral.

## 8. Persistent runtime

### 8.1 Process model

Each persistent worker starts:

```text
pi --mode rpc --no-session --exclude-tools horsepower,horsepower_subagent,subagent,<known-delegation-tools>
```

Additional arguments include resolved model, thinking level, tool allowlist, role prompt, standards prompt, and optional display name.

System and role prompts are written to mode-`0600` temporary files. Files and directories are removed on destruction or failed startup.

### 8.2 Public subagent interface

Horsepower registers one tool named `horsepower_subagent`.

Legacy one-shot modes:

- `single`
- `parallel`
- `chain`

Persistent actions:

- `create`
- `send`
- `abort`
- `status`
- `read`
- `list`
- `destroy`

`abort` stops the current turn and preserves the worker process and conversation. `destroy` permanently removes the worker from the current host Pi process. Workflow cancellation uses `abort`; clearing a worker uses `destroy`.

Required creation fields include agent, task intent or initial message where applicable, and `modelSlot`.

Message delivery:

- `reject` — fail when the worker is busy.
- `followUp` — queue after current work.
- `steer` — alter the current work at the next Pi steering point.

Every send receives a unique `messageId`. `wait: true` waits only for that message. `timeoutMs` stops waiting but never aborts the worker.

### 8.3 Status

Worker states:

- `starting`
- `idle`
- `running`
- `failed`
- `destroying`
- `destroyed`

Message states:

- `accepted`
- `queued`
- `running`
- `completed`
- `failed`
- `canceled`

Transport acknowledgement means the RPC command was accepted by the worker process. It is not described as semantic understanding. Optional worker-level semantic ACK is a separate structured event.

### 8.4 Event stream

Each worker has monotonically increasing cursors and a bounded in-memory event buffer. Default limit: 10 MiB per worker.

`read` accepts:

- `afterCursor`
- `includeDetails`
- `limit`

It returns:

- events
- `oldestCursor`
- `nextCursor`
- `hasMore`
- `truncated`
- current status

Compact events support routine captain operation. Detailed events include tool calls, tool results, deltas, usage, provider responses, and raw RPC records.

### 8.5 Limits

- Maximum persistent workers: 8.
- Legacy parallel task limit: 8.
- Legacy concurrent execution: 4 unless configured lower.
- Per-task one-shot output cap: 50 KiB.
- Per-persistent-worker event cap: 10 MiB.
- Stderr is bounded and sanitized before display.

### 8.6 Failure behavior

- Startup failure kills and removes the child.
- Unexpected child exit marks the worker `failed`.
- Failed workers are never automatically restarted because their context cannot be reconstructed safely.
- Running and queued message waiters are rejected on destruction or crash.
- Provider retries do not prematurely complete the active message.
- Graceful destruction escalates to `SIGKILL` after a bounded timeout.

## 9. Process-wide lifetime and Pi lifecycle

Pi reloads extension instances on `/new`, resume, fork, and reload. To preserve workers across Pi session switches while still destroying them on reload, Horsepower stores the runtime manager in a process-global singleton keyed by `Symbol.for("horsepower.runtime")`.

Lifecycle handling:

| Pi shutdown reason | Behavior |
|---|---|
| `new` | Keep global workers; detach old TUI and rebind new extension instance |
| `resume` | Keep workers; rebind UI and captain context |
| `fork` | Keep workers; rebind UI and record the new captain session |
| `reload` | Destroy all workers, remove global singleton, then load new code |
| `quit` | Destroy all workers and remove temporary resources |

The new extension instance claims the existing singleton during `session_start`. It never duplicates a manager in the same process.

The singleton also installs idempotent host-process exit and signal handlers as a final cleanup backstop. This is especially important for project-local installation: if the user switches to a project where Horsepower is not loaded, workers remain alive but temporarily inaccessible until a Horsepower-enabled session is active again. Host process exit still terminates them. Global installation is recommended for users who want cross-project access.

This mechanism is process-local, not a daemon. Host Pi process exit always ends workers. On startup, disk records for previously running workers are marked `orphaned`; Horsepower does not pretend to reconnect.

## 10. Explicit orchestration

### 10.1 Captain authority

Only the main agent has `horsepower_subagent`. Worker command lines exclude every known delegation tool. Worker prompts explicitly prohibit process spawning for nested Pi agents.

Before each captain turn, Horsepower appends a compact capability catalog to the captain context. It lists configured slot IDs, Chinese labels, intended uses, fallback state, and current health summary. It instructs the captain that every dispatch must explicitly name one slot. Concrete model IDs may be shown locally for transparency but are never embedded in public defaults or sent anywhere except the selected provider during normal Pi use.

### 10.2 Concurrency

The captain may issue explicit parallel calls. Parallelism is allowed only for the exact tasks named in the tool call. Horsepower never expands one request into additional workers.

### 10.3 No automatic fanout

Fanout, debate, and playbook modules return `proposedDispatches`:

```json
{
  "proposedDispatches": [
    {
      "agent": "reviewer",
      "modelSlot": "judgment",
      "task": "Review authentication boundaries"
    },
    {
      "agent": "tester",
      "modelSlot": "utility",
      "task": "Run the regression suite"
    }
  ]
}
```

This output is inert. Only a subsequent explicit captain call creates workers.

## 11. Horsepower workflow tool

Horsepower registers a separate `horsepower` tool for workflow governance and control. Its action-oriented interface includes:

- `workflow.create`
- `workflow.status`
- `workflow.advance`
- `workflow.resume`
- `workflow.proposeDispatches`
- `labels.classify`
- `slots.recommend`
- `guard.check`
- `guard.record`
- `standards.resolve`
- `persona.get`
- `artifact.list`
- `handoff.create`
- `run.status`
- `run.message`
- `run.cancel`
- `worker.clear`

`run.cancel` aborts current work for workers associated with the run but preserves their sessions unless the captain explicitly requests clearing. `worker.clear` maps to runtime `destroy` and is always explicit.

None of these actions may call runtime `create` internally. They return recommendations or operate on already-existing worker IDs.

Commands:

- `/horsepower`
- `/horsepower-status`
- `/horsepower-config`

Horsepower does not register `/team` or `team_*`.

## 12. Workflow governance

### 12.1 Phases

AgentFlow capabilities are included in full:

1. Initialize
2. Design
3. Gate Review
4. Development
5. Testing
6. Review
7. Final Review
8. Archive

The state machine validates phase prerequisites and records evidence. It recommends the next explicit dispatch but never starts a worker.

### 12.2 Task labels

Built-in labels include:

- `config_edit`
- `crud_field`
- `copy_pattern`
- `api_endpoint`
- `ui_component`
- `cross_module`
- `security_related`
- `concurrency`
- `performance`
- `database`
- `test_only`
- `docs_only`
- `refactor`
- `bugfix_simple`
- `bugfix_complex`

Projects may add labels.

### 12.3 Slot recommendations

Labels recommend slots without selecting workers:

- Security, concurrency, cross-module, complex bugs: `judgment`
- Normal implementation, APIs, UI, refactors, simple bugs: `craft`
- Config, docs, copy-pattern, routine tests: `utility`
- Discovery and log triage: `speed`
- Very large evidence sets: `context`

The captain must copy or override the recommendation in the explicit dispatch call.

### 12.4 Quality gates

- Design gate may recommend primary and secondary reviews.
- Each implementation task requires tester evidence and reviewer evidence before completion.
- Reviewer rejection recommends escalation.
- Repeated tester failures recommend a higher capability slot or task split.
- Three failed capability levels trigger captain root-cause analysis and user clarification where needed.

No gate creates workers automatically.

### 12.5 Coder Guard

Coder Guard records:

- workflow/change ID
- role
- task labels
- requested slot
- resolved slot
- resolved concrete model
- slot configuration revision
- result class
- timestamp
- escalation

Code-quality failures count against capability evidence:

- review rejection
- test failure attributable to code
- logic, syntax, type, or behavioral error

Infrastructure failures do not:

- model/provider error
- missing authentication
- timeout
- cancellation
- tool limitation
- unrelated environment dependency

Guard recommendations are advisory. The captain remains responsible for explicit dispatch.

### 12.6 Resume, OpenSpec, archive, and memory

Horsepower supports:

- local workflow state
- earliest-incomplete-phase resume
- OpenSpec proposal/design/tasks when a project uses OpenSpec
- applied/archive records otherwise
- final review evidence
- concise experience memory
- Coder Guard history

These are disk artifacts and survive process restart. Live worker conversations do not.

## 13. Standards and progressive loading

### 13.1 Bundled standards

The initial package includes adapted AgentFlow standards for:

- Go
- Python
- TypeScript
- Java
- SQL
- workflow enforcement
- leader/captain no-code discipline
- Coder Guard

The design supports additional standards such as Rust, React, Vue, security, API compatibility, migrations, testing, documentation, and release engineering.

### 13.2 Resource locations

Package defaults:

```text
resources/standards/
```

Global overrides:

```text
~/.pi/agent/horsepower/standards/
```

Project overrides:

```text
.pi/horsepower/standards/
```

Precedence:

```text
project override > global override > package default
```

Defaults stay in the installed package and update with package versions. Setup never copies package resources into Pi's `extensions/`, `skills/`, `prompts/`, or Horsepower override directories. Pi loads them through the installed package symlink. This prevents resource duplication and updates from overwriting user changes.

### 13.3 Resolver

The standards resolver uses task labels, detected languages, role, and workflow phase to return only relevant resources. The captain can inspect the resolved list before dispatch. The resulting prompt records resource IDs and versions for reproducibility.

A TypeScript API implementation might load:

- workflow enforcement
- TypeScript
- coder role guidance

It must not load Go, Java, or SQL unless the task requires them.

## 14. Personas, workflows, playbooks, debate, and synthesis

Horsepower includes the AgentFlow persona catalog and allows package, global, and project persona resources. Personas change naming, tone, and role presentation; they do not choose models or create workers.

Horsepower includes workflow and playbook resources for common development cycles. Advanced debate, fanout, and synthesis modules are included as proposal generators. They emit explicit suggested calls and never dispatch.

Automatic synthesis may combine existing worker artifacts without creating a new worker. If a model-based synthesizer is desired, the captain must explicitly dispatch it with a slot.

## 15. Observability

### 15.1 TUI

Horsepower provides:

- active/idle/failed worker list
- role, slot, resolved model, thinking level
- current message and queue state
- elapsed time and last activity
- request/token/cache/cost usage
- last tool and output preview
- retained idle workers
- workflow phase and gate state
- alerts for crash, failed delivery, unacknowledged semantic request, and resource limit

Manual workers and workflow-associated workers are grouped but share one runtime.

### 15.2 Artifacts

Default project artifact root:

```text
.pi/horsepower/
  runs/
  artifacts/
  workflows/
  memory/
```

Global manual session metadata may live under:

```text
~/.pi/agent/horsepower/runtime/
```

Artifacts contain no API keys. Raw provider headers are never persisted. Tool output persistence is bounded and configurable.

### 15.3 Handoff

Handoff records factual worker and workflow state, including orphaned workers, without claiming that a dead process can be resumed. A later captain may inspect artifacts and explicitly create a new worker if needed.

## 16. Model health

Horsepower keeps infrastructure health separate from capability quality.

Health evidence includes:

- authentication or rejection
- provider error and rate limit
- timeout
- malformed tool arguments
- observed latency
- context overflow
- recent successful worker completion

Probes never create persistent workers. Proactive probes are optional and bounded. By default, real worker evidence is preferred and probes are lazy.

A health fallback changes only the model resolved for one explicit worker request; it never changes worker count.

## 17. CLI and installation

### 17.1 Package identity

```text
Product: Horsepower
GitHub: LosFurina/horsepower
npm: @losfurina/horsepower
CLI binary: horsepower
Pi package source: npm:@losfurina/horsepower
```

The npm package includes the `pi-package` keyword and Pi manifest for Gallery discovery.

### 17.2 Symlink installation model

Horsepower uses one durable package payload and soft links it into Pi's package discovery path. It never copies extension, skill, standard, persona, prompt, or workflow files into Pi resource directories.

Global layout:

```text
~/.pi/agent/horsepower/
  install/
    versions/
      0.1.0/
        package/                  # one unpacked, immutable package payload
    current -> versions/0.1.0/package
  model-slots.json
  settings.json
  standards/                     # user overrides only
  workflows/                     # user overrides only
  personas/                      # user overrides only
  memory/
```

Pi registers the stable local package link:

```bash
pi install ~/.pi/agent/horsepower/install/current
```

The package manifest under `current` exposes Horsepower's extension and packaged resources. No links or copies are created under `~/.pi/agent/extensions/`, `skills/`, or `prompts/`.

A version payload is immutable after installation. Update stages a new version directory, verifies it, creates a temporary symlink, and atomically renames that link to `current`. If verification or link switching fails, `current` continues pointing at the prior version.

Horsepower does not silently fall back to copying when symlink creation is unavailable. It reports the exact platform or permission requirement. On Windows, setup uses a directory symbolic link or junction only when its semantics pass doctor checks; otherwise setup fails with guidance rather than changing installation strategy.

Development setup may point `current` directly at a local checkout:

```bash
horsepower setup --source /absolute/path/to/horsepower
```

This creates a soft link and does not duplicate the checkout.

### 17.3 One-command setup

```bash
npx @losfurina/horsepower setup
```

Setup:

1. Detect Node and Pi.
2. Verify compatible versions and symlink capability.
3. Download and unpack exactly one immutable Horsepower package payload into a staged version directory without running lifecycle scripts.
4. Verify package integrity, manifest, version, and private-data release gates.
5. Atomically create or switch `install/current` to the verified payload.
6. Register the stable local package link with `pi install <current-link>` unless already registered.
7. Create Horsepower configuration and override directories; do not populate override directories with package defaults.
8. Discover available Pi models without reading or printing API keys.
9. Prompt for required slots and optional slots.
10. Validate selected model IDs and thinking levels where possible.
11. Initialize settings, schema versions, workflow state, and memory files.
12. Detect conflicting tools or commands and report them without removing packages.
13. Run `horsepower doctor`.
14. Ask the user to run `/reload`.

Local setup:

```bash
npx @losfurina/horsepower setup --local
```

Project layout:

```text
.pi/horsepower/
  install/
    versions/<version>/package/
    current -> versions/<version>/package
  model-slots.json
  settings.json
  standards/
  workflows/
  personas/
  memory/
```

It registers the stable link with:

```bash
pi install .pi/horsepower/install/current -l
```

Project installation metadata and links are machine-local by default and should be ignored by Git unless the project explicitly chooses a portable repository-relative source link.

### 17.4 Coexistence

Horsepower follows conflict strategy C: it coexists with `pi-team` and existing subagent packages.

- It never removes or disables another package.
- It uses unique tools and commands.
- Doctor warns that multiple orchestration packages increase model tool-selection burden.
- The generic `subagent` compatibility alias is disabled by default.

### 17.5 Slot commands

```bash
horsepower slots
horsepower configure
horsepower set judgment provider/model --thinking high
horsepower set craft provider/model --thinking medium
horsepower set utility provider/model --thinking off
horsepower set speed provider/model
horsepower set context provider/model
horsepower unset speed
```

Chinese aliases are accepted:

```text
上等马 → judgment
中等马 → craft
下等马 → utility
快马   → speed
长程马 → context
```

Custom slots:

```bash
horsepower slot add vision provider/model --thinking medium
horsepower slot fallback vision judgment
horsepower slot remove vision
```

Required slots cannot be removed without a replacement.

### 17.6 Standards and personas

```bash
horsepower standards list
horsepower standards show typescript
horsepower standards override typescript
horsepower standards reset typescript
horsepower persona list
horsepower persona set startup
```

Overrides never mutate package defaults.

### 17.7 Doctor

```bash
horsepower doctor
```

Doctor checks:

- Pi executable and version
- package payload integrity, stable `current` symlink, and Pi local-package registration
- configuration schemas
- required slots
- model registry presence
- thinking compatibility
- fallback cycles
- writable directories
- standards/workflows/personas integrity
- runtime tool exclusion
- conflicting command/tool registrations
- leaked absolute development paths or private defaults
- package/config schema migration requirements

Doctor never emits API keys.

### 17.8 Update

```bash
horsepower update
```

Update:

1. Backs up user configuration.
2. Resolves and downloads the target npm release into a new staged version directory without lifecycle scripts.
3. Verifies package integrity and runs pre-switch doctor checks against the staged payload.
4. Migrates configuration schemas transactionally while preserving a rollback copy.
5. Atomically switches `install/current` to the new immutable payload.
6. Leaves user and project overrides unchanged unless a migration explicitly transforms them.
7. Runs post-switch doctor.
8. Rolls the symlink and migrated configuration back if post-switch verification fails.
9. Retains the immediately previous payload for rollback and prunes older payloads according to an explicit retention setting.
10. Prints migration and reload instructions.

Pi sees the same stable local package source before and after update; Horsepower does not use `pi update` to replace resource files.

### 17.9 Uninstall

```bash
horsepower uninstall
```

Removes the stable local package registration and Horsepower-owned symlinks and managed version payloads, but preserves user configuration, overrides, and memory. It never follows a symlink while deleting; deletion is limited to verified Horsepower-owned link entries and managed version directories.

```bash
horsepower uninstall --purge
```

Also removes Horsepower-owned configuration after explicit confirmation. Non-interactive purge requires `--yes`.

## 18. CLI implementation and safety

The CLI is Node-based and distributed as built JavaScript under `dist/`. The Pi extension may remain TypeScript under the Pi manifest.

The CLI must:

- install resources by soft link only; never copy package resources into Pi resource or override directories
- validate link targets remain inside a verified Horsepower package payload or an explicitly supplied development checkout
- switch `current` atomically and preserve rollback targets
- never follow symlinks during uninstall or purge deletion
- edit JSON transactionally using temp file, fsync where practical, and atomic rename
- preserve unknown settings fields
- create backups before migrations
- never print keys, auth headers, or secret values
- never modify `models.json` providers
- never enable project trust automatically
- never silently uninstall another package
- never overwrite user standards/personas/workflows
- provide deterministic non-interactive flags for CI

If model discovery through Pi is unavailable, setup accepts explicit model IDs and doctor reports that registry validation was skipped.

## 19. Repository structure

```text
horsepower/
  src/
    extension/
    runtime/
    orchestration/
    workflow/
    routing/
    guard/
    observability/
    config/
  cli/
  resources/
    agents/
    standards/
    workflows/
    personas/
    schemas/
  test/
    unit/
    integration/
    e2e/
    fixtures/
  docs/
    reference/
    superpowers/specs/
  scripts/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  README.zh-CN.md
  CHANGELOG.md
  LICENSE
```

Modules should expose small interfaces. Runtime internals, RPC framing, event correlation, process cleanup, and config migration stay behind dedicated seams.

## 20. Security model

Horsepower child processes share the parent user's filesystem permissions, environment, cwd, network, and credentials. Process separation is lifecycle and failure isolation, not a security sandbox.

Security controls:

- explicit tool allowlists
- nested delegation exclusion
- bounded processes and buffers
- safe temp files
- path traversal validation for artifacts and overrides
- no shell invocation for process spawn
- no secret persistence
- output and stderr bounds
- project trust remains Pi-controlled
- optional maximum tool tier
- worker prompts state write scope and non-recursion

README must state these limitations plainly.

## 21. Testing strategy

### 21.1 Unit tests

- slot parsing, fallback, cycles, custom slots, revisions
- configuration precedence and migrations
- agent and standards discovery
- task label and slot recommendations
- Coder Guard classification and revision isolation
- workflow transitions and gate prerequisites
- artifact sanitization and path safety
- event projection and TUI status projection
- model health evidence and fallback
- persona/resource precedence

### 21.2 Runtime tests

- create/list/status/abort/destroy
- session limit and unique names
- async and waited sends
- follow-up and steer correlation
- cursor reads and truncation
- retries and error completion
- startup cleanup
- process crashes
- graceful/forced destroy
- wait timeout without abort
- exclusion of all delegation tools
- no idle expiry
- global singleton reuse across `new`, `resume`, and `fork`
- destruction on `reload` and `quit`

### 21.3 Integration tests

- fake RPC child with strict LF JSONL framing
- real Pi RPC worker smoke test
- two explicitly chosen workers running concurrently
- second-turn context retention
- slot-to-model resolution
- standards prompt injection
- usage/cost event projection
- post-workflow conversation without changing terminal run state

### 21.4 CLI tests

- clean global symlink setup
- local symlink setup
- development source link setup
- existing installation and idempotent link registration
- unavailable symlink permission fails without copying
- atomic update link switch and rollback
- uninstall never follows malicious or unexpected links
- coexistence with `pi-team` and generic subagent packages
- interactive and non-interactive slot configuration
- update migration and rollback
- uninstall and purge
- no-secret output snapshots
- paths containing spaces
- npm/Pi command failure handling

### 21.5 Release gates

- formatting and typecheck
- all automated tests
- package tarball inspection
- no private model/provider/path scan
- clean temporary Pi agent directory install
- `pi -e` smoke test
- stable local-package symlink registration smoke test
- setup/doctor/update/uninstall acceptance
- Linux and macOS CI; Windows where Pi process semantics permit

## 22. Version plan

### `0.1.0-alpha.1`

- package skeleton
- model slots
- CLI setup/configure/set/slots/doctor
- persistent RPC runtime
- explicit one-shot and persistent dispatch
- eight-worker limit
- lifecycle and tests

### `0.1.0-alpha.2`

- AgentFlow phases and labels
- Coder Guard and escalation
- gates, state, resume
- progressive standards
- OpenSpec/archive/experience

### `0.1.0-alpha.3`

- TUI observability
- usage/cost
- health evidence
- artifacts and handoff
- delivery and completion notifications

### `0.1.0-beta.1`

- personas
- workflow/playbook proposal generators
- debate/fanout proposals
- model-based synthesis via explicit dispatch
- proactive probes
- CLI update and migrations

### `0.1.0`

- security review
- clean-machine acceptance
- English and Chinese documentation
- public GitHub repository
- npm package
- Pi Gallery metadata

## 23. Licensing and acknowledgements

Horsepower uses the MIT License.

Horsepower does not copy `pi-team` implementation or Git history. README acknowledges `pi-team` as design inspiration for captain-led coordination and observability.

AgentFlow resources incorporated from `LosFurina/agentflow-codex` are owned by the Horsepower maintainer and are relicensed under Horsepower's MIT License before public release.

## 24. Acceptance criteria

Horsepower is ready for `0.1.0` when:

- A user can install and initialize with one command using a stable soft-linked local package and no copied Pi resources.
- A user can map three required slots and optionally add speed, context, or custom slots.
- The captain must explicitly select a slot and worker for every dispatch.
- Two or more explicitly named workers can run concurrently without implicit expansion.
- No action can exceed eight persistent workers or create a nested worker.
- Workers retain context indefinitely within the host Pi process until explicitly destroyed.
- Workers survive `/new`, resume, and fork, and are destroyed on `/reload` and quit.
- AgentFlow phases, standards, gates, personas, archive, and guard work without creating workers automatically.
- TUI and machine-readable events reflect the same runtime state.
- Horsepower coexists with `pi-team` without tool or command collision.
- Public package contents contain no private agents, model mappings, credentials, or machine paths.
- Fresh-install, update, and uninstall acceptance tests pass.
