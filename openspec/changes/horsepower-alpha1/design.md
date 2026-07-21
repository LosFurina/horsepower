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
- Require the Captain to choose change-specific E2E verification before reporting completion, while allowing an explicit reasoned waiver with alternative evidence.
- Notify optional webhooks only when an explicit dispatch or Captain-reported change reaches a terminal state.
- Use explicit managed text handoffs for substantial delegated work so long briefs, reports, diffs, research, and test evidence do not have to travel through bounded model-facing RPC content.
- Let users disable and re-enable Horsepower's Pi integration without deleting the CLI, installed release, configuration, state, memory, or handoffs.
- Render all Horsepower-owned human-facing conclusions in configured `en` or `zh-CN` while keeping machine contracts stable and internal Agent collaboration language unconstrained.

**Non-Goals:**

- Reimplementing or wrapping OpenSpec's artifact workflow, task tracking, verification, sync, or archive behavior.
- Installing, bundling, patching, or updating OpenSpec.
- Providing another planning document format or project change database.
- Automatic team creation, fanout, worker expansion, or recursive workers.
- Persisting live model conversations across host process restarts.
- Treating retained handoff artifacts as resumable conversations, task state, verification facts, or an alternative to OpenSpec.
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
- `verification-gate`: validates Captain-selected E2E evidence or an explicit E2E waiver before completion.
- `run-lifecycle`: owns process-lifetime dispatch/change terminal transitions and requires explicit Captain change termination.
- `webhook-notifier`: emits redacted terminal notifications with optional HMAC/Bearer/none authentication and bounded in-process retry.
- `orchestration`: validates explicit dispatch and delegates to runtimes.
- `handoffs`: creates and validates private brief/report/attachment artifacts, opaque references, retention metadata, and explicit cleanup without owning task or change facts.
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

`horsepower disable` removes only verified Horsepower-owned extension and skill links after preflighting both targets; it retains the CLI link, `current`, immutable versions, configuration, memory, state, and handoffs. `horsepower enable` verifies the active release and atomically restores only those two Pi links, rolling back links created by that invocation on failure. Both operations are idempotent and refuse regular files, directories, unrelated links, or untrusted parent paths. They do not communicate with a running Pi process: the current extension and workers remain active until `/reload` or Pi restart.

### 10. Product namespaces and coexistence

The extension registers `horsepower_subagent` and Horsepower-specific commands. It does not register `/team`, `team_*`, or generic `subagent`, and it never removes another extension. OpenSpec-generated `.pi/skills` and `.pi/prompts` remain untouched.

### 11. Captain-controlled verification and explicit terminal notification

The Captain chooses the E2E verification required for each change from the actual impact. Horsepower never guesses the command and does not treat unit tests alone as sufficient completion evidence. Before reporting `completed`, the Captain must provide successful E2E command evidence or an explicit `e2eWaiver` containing a concrete reason and alternative verification evidence. `blocked_needs_human`, `failed`, and `canceled` do not require successful E2E.

A change reaches a terminal state only when the Captain explicitly reports `completed`, `blocked_needs_human`, `failed`, or `canceled`. Horsepower cross-checks `completed` against the verification gate and official OpenSpec context, then emits the change webhook. It never infers completion from a quiet assistant turn. Dispatch runtimes independently emit `completed`, `failed`, or `canceled`; dispatch notification is disabled by default and can be enabled by configuration. Persistent worker `idle` is not terminal.

Webhook configuration is optional during installation and later CLI configuration. Authentication supports `hmac`, `bearer`, and `none`; HMAC is recommended. Secrets are stored in mode-`0600` Horsepower configuration and always redacted. Payloads contain terminal metadata and bounded evidence references, never prompts, model output, API keys, full command output, or authentication secrets. Delivery is non-blocking and retries only within the current Pi process using bounded exponential backoff. Failure never changes the original terminal state, and no daemon or persistent outbox resumes delivery after process exit.

Alternative rejected: inferring terminal state from Pi turn end. A turn ending cannot distinguish ordinary conversational pause from completed work.

Alternative rejected: static or automatically guessed E2E commands. Only the Captain has enough change-specific context to select meaningful E2E coverage.

### 12. Managed text handoff artifacts

Every work-producing dispatch explicitly declares `handoffMode` as `managed` or `inline`; Horsepower never infers mode from prompt length, role, or keywords. `parallel` and `chain` require `managed`. `single`, persistent `create`, and substantive `send` require an explicit selection; `followUp` reuses the associated managed workspace, while `steer` and observation/cleanup actions do not create a handoff.

Managed artifacts live beneath `~/.pi/agent/horsepower/state/handoffs/<opaque-project-id>/<run-id>/`. Horsepower writes a private `brief.md`, accepts a worker-produced `report.md`, and optionally records at most sixteen attachments. Directories use mode `0700`, files use `0600`, same-directory atomic replacement, no symlink or traversal, and SHA-256/size/media-type/producer metadata in a relative-path manifest. Brief and report are each limited to 1 MiB, attachments to 10 MiB each, and a run to 20 MiB total. A successful managed dispatch requires a valid report; failed or canceled dispatches record truthful report absence.

Tool output contains only a bounded summary and opaque artifact references, never managed absolute paths or full report content. Handoffs are retained across Pi restarts by default and may be listed, inspected, or explicitly cleaned through the CLI. Worker destroy, Pi exit, disable, and uninstall preserve them; purge removes them. Retention does not resume worker conversations, automatically advance work, or create proposal, task, verification, or archive facts. Webhooks carry only opaque evidence references.

Alternative rejected: automatically classifying long work. Hidden heuristics conflict with explicit Captain control.

Alternative rejected: forcing files for every status/control message. Inline communication remains appropriate for short work and control operations.

### 13. Captain-defined review campaigns

A review campaign is an explicit Captain-owned sequence of review and corrective dispatches. Before its first reviewer dispatch, the Captain defines a positive finite dispatch budget and a fixed acceptance scope grounded in the active OpenSpec change. Horsepower records consumption by campaign ID and rejects dispatches after exhaustion. No reviewer, fixer, helper, recommendation, or worker output can increase, reset, or replace the budget.

The Captain classifies findings by root cause before another dispatch. Additional examples, syntax variants, or adversarial inputs for an already recorded root cause consume no new finding identity and cannot silently expand acceptance scope. A reviewer result, including `NOT APPROVED`, is evidence for Captain judgment rather than an automatic trigger for another worker.

At exhaustion the Captain must stop the campaign and explicitly choose one outcome: accept the available evidence, narrow or defer scope through the official OpenSpec change, report `blocked_needs_human`, or request a human-authorized budget increase with a non-empty reason. Horsepower records campaign budget, consumption, scope digest, outcome, and override reason as process-lifetime execution evidence only; it does not create or edit OpenSpec task facts.

Alternative rejected: a product-wide fixed number of review rounds. Appropriate review depth depends on change risk, so the Captain sets each finite budget while Horsepower enforces that workers cannot renew it.

Alternative rejected: automatically dispatching a fixer or reviewer from a verdict. Automatic continuation transfers orchestration authority away from the Captain and permits unbounded review loops.

### 14. Localized human-facing conclusions

Horsepower supports exactly `en` and `zh-CN` in Alpha 1. Global `outputLocale` lives in `~/.pi/agent/horsepower/settings.json`; optional project `outputLocale` lives in `.pi/horsepower/settings.json` and overrides the global value. Missing settings resolve to `en`. Unknown locale values are rejected transactionally rather than guessed or silently downgraded.

A centralized exhaustive message catalog renders Horsepower-owned human-facing CLI text, errors, doctor findings and remediation, installer interaction and completion messages, `horsepower_subagent` status/summary/conclusion text, dispatch/change/E2E-waiver/review-campaign conclusions, and webhook `summary`. Machine fields remain stable and untranslated: JSON keys, action/status/enum/error codes, commands, paths, filenames, slot and agent IDs, run/change/campaign IDs, digests, artifact references, and raw command evidence. Structured outputs include the effective `outputLocale` so the Captain and receivers do not infer it.

Worker briefs, reports, reviewer/fixer discussion, raw model output, and internal evidence are not translated or language-constrained. The public Horsepower skill instructs the Captain to present principal user-facing conclusions in the effective locale even when internal Agent material is English. Horsepower never asks a model to translate opaque evidence or machine identifiers.

Before locale is configured, interactive installation begins with one bilingual language choice and immediately uses that selection for the rest of the session. Non-interactive installation accepts `--locale en|zh-CN`; with no existing setting or explicit flag it uses `en` and prints a locale-appropriate follow-up configuration command. Catalog completeness is verified at build/test time; a missing translation is an implementation error, not a runtime fallback.

Alternative rejected: localizing only CLI text. Pi tool conclusions, doctor output, webhooks, and installation are also human-visible and must remain coherent.

Alternative rejected: translating all worker communication. Internal English collaboration is efficient and must not destabilize machine evidence or force translation into the execution path.

### 15. User-selected implementation campaign mode

Before the first work-producing action in an implementation campaign, Horsepower requires an explicit user choice of `multi_agent` or `main_agent`. The choice is bound to a process-lifetime campaign ID, one OpenSpec change ID, and a non-empty declared task scope. Horsepower never selects a default from task complexity, prior campaigns, configuration, or model judgment. Changing scope or change, ending the campaign, switching mode, or restarting Pi requires a new user choice. Observation, cleanup, abort, destroy, doctor, and handoff inspection/cleanup do not require a campaign.

In `main_agent` mode all worker creation and advancement—including implementer, researcher, tester, fixer, reviewer, `parallel`, and `chain` dispatch—is denied by default. A reviewer is permitted only after a separate explicit user authorization that sets a positive finite review budget and acceptance scope. That authorization does not change execution mode, cannot authorize a fixer, cannot be renewed by a worker or verdict, and remains subject to the review-campaign budget rules. Implementation and fixes remain with the Captain unless the user explicitly starts or switches to a `multi_agent` campaign.

In `multi_agent` mode substantive implementation, research, testing, and bounded review work should be explicitly delegated, while the Captain retains decomposition, slot choice, budgets, scope, finding deduplication, acceptance, OpenSpec checkbox updates, integration, verification, and final judgment. Small coordination edits, conflict resolution, verification commands, and mechanical integration may remain with the Captain. If the Captain directly performs substantive work in this mode, Horsepower requires a non-empty recorded reason but does not interrupt the user again.

Implementation campaign mode and review campaign budget are orthogonal: one decides who may execute work; the other bounds review/fix review dispatches. Horsepower stores only process-lifetime authorization evidence and never creates or edits OpenSpec tasks. Worker text cannot create, switch, extend, or end an implementation campaign.

Alternative rejected: a permanent or project default execution mode. Execution risk and user preference are campaign-specific, and an implicit default would restore unauthorized Captain discretion.

Alternative rejected: asking before every OpenSpec task. Binding the choice to an explicit finite task scope preserves user control without repeatedly interrupting one approved campaign.

### 16. Incremental delivery

Alpha 1 delivers slots, agent discovery, one-shot and persistent RPC execution, OpenSpec execution gating, Captain-controlled E2E completion, run lifecycle and optional webhook notification, managed text handoffs, CLI setup/doctor/enable/disable/uninstall, release construction, curl installation, tests, and CI.

Later changes may add richer execution governance—coder routing, tester/reviewer orchestration, Coder Guard, standards, personas, and TUI—but those features must continue to leave all planning and historical facts with OpenSpec.

### 17. Review remediation uses reconciliation and shared verification contracts

Enable and disable capture the complete pre-operation state of both Pi integration links. If a mutation fails, Horsepower attempts every inverse operation needed to reconcile both links to that captured state, even when an earlier reconciliation operation fails. The command reports the original operation failure together with every rollback failure; it never masks the initiating error or claims successful restoration when reconciliation is incomplete. This is the strongest truthful all-or-nothing guarantee available for independent filesystem links without pretending that cross-directory symlink operations are atomic.

CLI command metadata owns the handler, supported-platform requirement, and localized completion-summary key in one typed table. Installation-link inspection is explicitly named as a preflight operation. Doctor renders enabled, disabled, partially enabled, conflict, and remediation conclusions through the exhaustive locale catalog while preserving machine status values and commands.

One managed-installation test fixture owns the common release/current/CLI/integration topology setup. A reusable GitHub verification workflow owns the Ubuntu/macOS, Node 22.19.0, locale, `npm run check`, and deterministic release/privacy-scan contract. CI, manual alpha verification, and tagged release call that workflow rather than repeating it. `HORSEPOWER_E2E_LOCALE` is consumed by locale-sensitive E2E tests; an unset value runs both locales locally, while each CI matrix leg proves its selected locale.

Real Pi acceptance invokes `horsepower_subagent`, not only command discovery, against a deterministic local model endpoint and verifies principal conclusions for both `en` and `zh-CN` over unchanged English internal evidence. Installed bundled-CLI acceptance likewise verifies both locales. Release scanning remains mandatory in every CI verification leg before alpha artifacts or tagged assets can be produced.

## Risks / Trade-offs

- **OpenSpec CLI changes** → Keep interaction CLI-first, test the minimum supported official contract, fail clearly on incompatible behavior, and avoid parsing undocumented internals.
- **Users can call ordinary OpenSpec apply without Horsepower** → This is valid; Horsepower is an execution enhancement, not owner of OpenSpec facts or an enforcement patch over official skills.
- **OpenSpec unavailable during worker activity** → Block advancing operations but preserve status/read/abort/destroy.
- **Captain selects insufficient E2E coverage** → Require an explicit declaration and evidence, surface the selection in terminal reporting, and leave final judgment with the Captain rather than silently substituting unit tests.
- **Webhook receiver is unavailable** → Preserve the original terminal state, retry only within the current process, redact failures, and document that retries are not resumed after exit.
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
