## Context

The current `/horsepower-campaign` command asks for mode, change ID, and a comma-separated string such as `4.6,4.7`. It splits the string and passes arbitrary non-empty values into `ImplementationCampaign.taskScopes`. The campaign manager recognizes numeric points and ranges, but it does not know whether those IDs exist in the selected OpenSpec `tasks.md`, whether they are complete, or whether a broad range contains gaps. The Horsepower Skill describes a declared task scope but does not document the UI grammar, so Captain guidance and user interaction can disagree.

Horsepower already validates an apply-ready change through the official OpenSpec CLI. `openspec status --change <id> --json` exposes the resolved tasks artifact path, while the canonical task completion state remains in the official checkbox-formatted `tasks.md`. This change can deepen the campaign interface by discovering that inventory behind the OpenSpec seam instead of making users transcribe an undocumented authorization expression.

The implementation must retain explicit user selection of execution mode and scope, work with the supported OpenSpec `>=1.6.0 <2.0.0` contract, avoid a parallel task store, and fail closed if tasks change between campaign creation and dispatch.

## Goals / Non-Goals

**Goals:**

- Present the selected change's real current OpenSpec tasks in the campaign flow.
- Let users select all unfinished tasks, unfinished tasks by section, or explicit unfinished task IDs without manually constructing ranges.
- Store a canonical deduplicated set of real task IDs plus a current task-snapshot digest in process-local campaign state.
- Revalidate each requested work scope against both the campaign selection and current OpenSpec task state before dispatch.
- Start exactly one Captain turn immediately after successful campaign confirmation so the selected work begins without another user prompt.
- Stream bounded, ordered one-shot worker progress into the active `horsepower_subagent` tool call and expose a stable full execution identity in its title and status.
- Guarantee that every accepted dispatch and managed handoff reaches a structured terminal result even when validation, model resolution, spawn, JSON streaming, report validation, or cleanup fails.
- Make UI prompts, Skill guidance, runtime semantics, localized errors, and documentation use one task-selection and worker-identity vocabulary.

**Non-Goals:**

- Modify OpenSpec task syntax or write task completion outside official OpenSpec workflows.
- Persist campaign state across Pi processes.
- Infer `multi_agent` versus `main_agent` or select implementation scope without user confirmation.
- Create arbitrary tags, glob expressions, free-form scope labels, or a second task hierarchy.
- Combine multiple OpenSpec changes into one implementation campaign.

## Decisions

### 1. Add a bounded OpenSpec task-inventory interface

The existing OpenSpec boundary will expose a method that, after the same version, doctor, integration, status, and strict-validation checks used for advancing work, returns:

- change ID and canonical project root;
- task artifact path obtained from `status.artifactPaths.tasks.resolvedOutputPath`;
- ordered sections with heading number/title;
- ordered tasks with canonical ID, description, section identity, and `pending` or `complete` state;
- a SHA-256 digest of the exact validated task inventory representation.

A focused parser will accept the official generated checkbox form `- [ ] X.Y ...` and `- [x] X.Y ...` under numbered `##` headings, reject duplicate IDs, malformed checkbox task lines, tasks outside a section, and inventories with no recognized tasks, and never write the file. Descriptions are bounded before presentation. The digest covers IDs, state, section, and descriptions so relevant task drift is detectable without storing a second source of facts.

Alternative considered: call `openspec instructions tasks` and derive tasks from its metadata. Rejected because it returns artifact instructions/path, not item-level completion. Alternative considered: treat `tasks.md` as an unsupported private format. Rejected because the official apply workflow itself defines and parses the checkbox format; the parser remains isolated and tested against the supported OpenSpec range.

### 2. Make campaign creation a staged OpenSpec-aware interaction

`/horsepower-campaign` will use this sequence:

1. Ask for the apply-ready change ID.
2. Load and display a bounded summary of pending/complete tasks grouped by section.
3. Ask for scope mode: all unfinished tasks, select unfinished sections, or select task IDs manually.
4. For section selection, repeatedly choose from unfinished sections and confirm the accumulated set; for manual selection, accept comma-separated exact IDs only and show syntax using IDs from the loaded change.
5. Normalize to ordered unique pending task IDs and show the exact task descriptions for final confirmation.
6. Ask the user to select `multi_agent` or `main_agent` and create the campaign only after confirmation.
7. After creation succeeds, inject the campaign result as a custom context message and immediately trigger exactly one Captain turn to begin the selected work.

The command will localize the whole flow according to `outputLocale`; it will not use bilingual hard-coded labels as behavior tokens. Canceling or declining confirmation creates no campaign and does not end an existing active campaign. Input validation identifies unknown, completed, duplicate, and empty selections; duplicates are normalized and disclosed rather than treated as extra authority.

The kickoff will use Pi's documented custom-message delivery contract: `sendMessage(..., { deliverAs: "followUp", triggerTurn: true })`. `nextTurn` is explicitly unsuitable because it queues context for the next user prompt and triggers nothing. If Pi is idle after the command, the kickoff starts immediately; if command execution occurs while an agent is active, `followUp` queues one continuation after the active work settles. The command sends the kickoff only after campaign creation succeeds and calls it once. Cancellation, validation error, runtime failure, or final-confirmation refusal sends no kickoff. The custom message includes the campaign ID, change ID, canonical task IDs, and mode, and instructs the Captain to begin under the bundled Horsepower Skill; it does not fabricate a user message or select additional work.

Alternative considered: `sendUserMessage("go")`. Rejected because it forges an unnecessary user utterance and loses the structured campaign details. Alternative considered: retain `deliverAs: "nextTurn"`. Rejected because Pi documents that it does not interrupt or trigger anything, which is the reported bug.

Alternative considered: retain a free-form input and merely improve placeholder text. Rejected because it leaves discovery, typo detection, completion filtering, and range-gap ambiguity with the user. Alternative considered: default silently to all pending tasks. Rejected because scope choice must remain explicit.

### 3. Store canonical task IDs, not numeric ranges

`ImplementationCampaign` will replace `taskScopes: string[]` with a bounded canonical task selection containing ordered exact task IDs and the inventory digest captured at confirmation. Public campaign details will expose these stable IDs and bounded task counts, not the tasks file path.

Each work-producing dispatch continues to carry a `taskScope`, but its syntax becomes a comma-separated list of exact task IDs. The runtime normalizes this list and requires every requested ID to be a subset of the campaign's canonical selected IDs. Numeric ranges such as `1.1-5.4`, unknown arbitrary strings, duplicate-only input, and cross-change task IDs are rejected with migration guidance. This removes the accidental authorization of nonexistent IDs between range endpoints.

Alternative considered: internally expand ranges against the discovered inventory. Rejected for the public contract because callers could continue emitting ambiguous scope and because exact IDs make evidence, audit output, and error messages clearer. The interactive command itself eliminates the need to type these lists during campaign creation.

### 4. Revalidate current task state before every work-producing dispatch

Before campaign authorization consumes review budget or creates a run/worker, the runtime reloads the current OpenSpec task inventory through the boundary and checks:

- the change and project still match;
- the current digest and selected task records have not changed incompatibly;
- every requested task still exists, remains selected, and is unfinished;
- the request contains no unselected or completed task.

Completion of unrelated, unselected tasks need not invalidate the campaign. Changes to a selected task's identity, description, section, or state do invalidate authorization. If a selected task becomes complete, work for it is rejected; remaining unchanged pending selected tasks may continue after the campaign's process-local snapshot is safely narrowed or refreshed only through a new explicit campaign. To keep authority simple and auditable, this design chooses **new campaign required on any selected-task drift**, rather than mutating the active authorization automatically.

This check happens before implementation-campaign dispatch accounting and review-budget consumption. OpenSpec remains authoritative; the process-local digest is only an authorization snapshot.

Alternative considered: validate only at campaign creation. Rejected because OpenSpec apply progress can change while a campaign remains active. Alternative considered: automatically refresh the campaign to new pending tasks. Rejected because that could add authority without user selection.

### 5. Keep one change per campaign and make cross-change work explicit

A campaign remains bound to exactly one OpenSpec change. When several apply-ready changes are implemented in one development wave, the user creates or switches campaigns per change. Starting the next campaign ends the previous process-local campaign as `switched`, preserving the existing authority model. Documentation and Skill guidance will state this explicitly rather than suggesting one comma list can span changes.

### 6. Stream bounded one-shot progress through the existing tool-update seam

The extension's `horsepower_subagent.execute` already receives Pi's `onUpdate` callback but currently ignores it. The runtime will accept a progress sink in the execution context and carry it through orchestration to the one-shot runner. The runner will parse Pi JSON events incrementally and emit a normalized, bounded event vocabulary rather than forwarding raw NDJSON:

- `accepted` — request authorized and identity resolved;
- `starting` — child process spawn requested;
- `assistant` — bounded assistant text/status updates;
- `tool_start`, `tool_update`, and `tool_end` — tool name, call ID, bounded safe summary, and success/failure status;
- `handoff_created` and `report_validated` — opaque IDs/metadata only, never private paths or report bodies;
- `completed`, `failed`, or `canceled` — exactly one terminal event with bounded diagnostic.

The extension converts each normalized event into a non-empty Pi tool partial result and invokes `onUpdate` in source order. Updates are rate/size bounded, preserve UTF-8, and redact credentials, prompts, raw model payloads, absolute private handoff paths, and unrestricted tool output. A slow or throwing UI update callback cannot fail the worker; progress delivery is observational. Parallel workers include an invocation ID so interleaved events remain attributable.

Alternative considered: periodically poll persistent status from the Captain. Rejected because one-shot workers are not retained in the persistent manager and polling recreates the current invisible wait. Alternative considered: forward raw Pi JSON. Rejected for privacy, stability, and output-volume reasons.

### 7. Render a complete stable worker identity

Before spawn, orchestration already knows the dispatch name, agent definition, resolved slot, model, thinking, and handoff mode. It will construct one immutable `WorkerIdentity` per invocation:

- `name`: Captain-assigned dispatch name;
- `agent`: agent definition name;
- `role`: agent definition role, used as the human-readable horse class/level;
- `requestedSlot` and `resolvedSlot`;
- `model`;
- `thinking`;
- `handoffMode`;
- `invocationId` and, after lifecycle creation, opaque `runId`.

The tool title and every progress/terminal update display the same identity. A concise example is:

```text
implement-task-inventory · coder (Implement a narrowly specified change) · craft→craft · liweijun/gpt-5.6-sol · thinking=minimal · managed
```

Machine fields remain structured and untranslated; human labels and role presentation follow `outputLocale`. Parallel and chain views show a parent summary plus each child's full identity. Identity values are resolved facts, not caller-supplied display strings, and title rendering is bounded against control characters and excessive length.

The term “horse level” will not become a second configuration field: the existing agent `role` is the authoritative semantic level/class, while `modelSlot` remains the capability class and concrete model/thinking remain execution bindings.

### 8. Make dispatch and handoff terminalization atomic from the caller's perspective

Once a dispatch run or managed handoff is created, all later exits pass through one finalizer. It records exactly one terminal status, cleans or terminalizes any managed workspace, and returns a non-empty structured tool result. Pre-run failures return structured `failed` evidence without creating lifecycle artifacts. Post-run failures identify the stage (`capability`, `spawn`, `stream`, `worker`, `handoff_report`, `cleanup`, or `tool_delivery`) and preserve the original cause in bounded raw evidence.

The extension must never convert a thrown runtime failure into `No result provided`. Its catch path returns a normal Pi tool result containing `status: "failed"`, stable error code/boundary/remediation, resolved identity when available, and terminal evidence. Doctor must not call a configured slot valid when the current model catalog is unavailable or does not contain its model; it reports `unverified` or `unsupported` and work fails before handoff creation.

Alternative considered: keep partial handoffs for forensic inspection without terminal state. Rejected because a non-terminal orphan violates lifecycle facts. Terminal failed handoffs may be retained under existing retention rules, but their manifest must say `failed`.

## Risks / Trade-offs

- **[Official task Markdown details may evolve within the supported OpenSpec range]** → Isolate parsing, use strict fixtures from generated artifacts, fail with `openspec update`/compatibility guidance on unknown syntax, and update the supported range deliberately if needed.
- **[Large task files can overwhelm the Pi UI]** → Bound bytes, task count, section count, and description length; show grouped summaries and paged/iterative selection rather than one unbounded prompt.
- **[Dispatch-time OpenSpec reads add latency]** → Read only status/validation and one bounded task artifact before work creation; correctness and authority freshness outweigh a small local-process cost.
- **[Exact-ID scope is a breaking change for range-based callers]** → Update bundled Skill and examples atomically and return actionable errors that show the canonical exact-ID form.
- **[Any selected-task drift requires campaign recreation]** → Prefer explicit renewed consent over silent authorization mutation; provide a concise localized reason and exact `/horsepower-campaign` remediation.
- **[Two changes cannot share one campaign]** → Keep this intentional invariant visible and guide users to switch campaigns sequentially.
- **[A kickoff could duplicate work or interrupt an active turn]** → Emit it once only after successful creation, use Pi's `followUp` delivery with `triggerTurn: true`, and test idle, active, failure, cancellation, and repeated-command behavior.
- **[Live progress can leak secrets or flood the TUI]** → Normalize an allowlisted event schema, redact/bound every field, rate-limit updates, never forward raw prompts/payloads/private paths, and make update delivery observational.
- **[Long titles can become unreadable]** → Preserve full identity in structured details while using bounded deterministic human formatting and per-child views for parallel work.
- **[Terminalization cleanup can mask the original failure]** → Preserve the primary failure, append bounded cleanup evidence, and make the idempotent finalizer record exactly one terminal state.

## Migration Plan

1. Add task-inventory parser and OpenSpec boundary tests using current official generated task fixtures and malformed/adversarial variants.
2. Add failing campaign manager/runtime tests for canonical task IDs, snapshot ownership, and dispatch-time drift/completion rejection before accounting.
3. Add normalized one-shot progress events, pass the Pi `onUpdate` sink through extension/runtime/orchestration, and render complete worker identities for single/parallel/chain execution.
4. Centralize dispatch/handoff finalization and structured failure results, including model-catalog/doctor preflight that fails before handoff creation when bindings are unavailable.
5. Replace the Pi campaign command with the localized staged selection and confirmation flow and an exactly-once post-confirmation Captain kickoff.
6. Update the bundled Skill, both READMEs, metadata, fixtures, and E2E tests; remove range examples, hard-coded bilingual behavior labels, and any guidance that asks the user to send `go` after campaign creation.
7. Validate both OpenSpec changes independently, then implement them under separate explicit campaigns in the same development wave.

Rollback restores the prior immutable release. Campaigns are process-local, so no persisted state migration is required; users restart Pi and create a campaign using the restored release's contract.

## Open Questions

None. Campaign scope is canonical unfinished task IDs discovered from official OpenSpec, with a new campaign required after selected-task drift; successful campaign creation triggers one immediate Captain turn; every worker exposes bounded live progress and a complete resolved identity; and every accepted dispatch/handoff returns one structured terminal result.
