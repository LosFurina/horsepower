# Horsepower

Horsepower is an explicit, model-neutral multi-Agent runtime for Pi. It coordinates persistent Pi RPC workers while the official **Fission-AI/OpenSpec** CLI exclusively owns proposals, specs, designs, tasks, apply state, verification facts, and archives.

[简体中文](docs/README.zh-CN.md)

## Requirements and installation

- Linux or macOS
- Node.js 22.19 or newer
- Pi 0.80.10 or newer (before 0.82.0)
- Official OpenSpec 1.6.0 or newer

Download and inspect the repository-owned `install.sh` from `raw/main`. The script downloads installable assets only from the `LosFurina/horsepower` GitHub Releases page; by default it resolves and installs the repository's current Latest Release:

```sh
curl -fsSLO https://github.com/LosFurina/horsepower/raw/main/install.sh
sh install.sh
```

The interactive installer is the primary path. It downloads `horsepower-v<version>.tar.gz` and its SHA-256 asset, validates the exact layout and internal digests, performs the pre-activation Skill gate, atomically switches `current`, then starts the complete locale, Skill-boundary, webhook, and model journey. It never uses `sudo`, edits shell startup files, or copies Pi resources. Use `--locale en` or `--locale zh-CN`; without a terminal or prior setting, English is used.

For unattended installation, use `sh install.sh --no-setup`. This skips every interactive configuration prompt but retains the observation-only audit and warnings. Pin a reproducible release with `--version VERSION` or `HORSEPOWER_VERSION=VERSION`. Afterwards run `horsepower configure --interactive` for the complete journey. Use `horsepower setup --interactive` only for model-slot selection or revalidation.

## Skill isolation and exposure audit

Every Horsepower one-shot and persistent worker starts Pi with `--no-skills`; workers do not discover global, project, settings, package, or extension-contributed Skills. This is an instruction boundary, not a filesystem, credential, network, or OS sandbox.

The main Captain intentionally remains in the user's normal, user-controlled Pi environment. External Skills such as Superpowers are user-managed; Horsepower never installs, removes, enables, disables, or configures them. Installation audits enabled static Skill resources after staged preflight and before activation. External exposure or an incomplete audit requires explicit `y`, `Y`, or `yes` in interactive installation (default No); unattended installation warns on stderr and continues without changing Pi Skill configuration.

Run `horsepower configure --interactive` at any time for complete configuration: output locale, the Captain/worker Skill boundary and current-context audit, optional webhook settings, then required model slots. Earlier confirmed independent sections remain configured if a later section is skipped or canceled, and the summary prints exact follow-up commands.

Run `horsepower skill-audit` or `horsepower skill-audit --json` from any project. The observation-only audit covers global and current-project context, skips unavailable packages rather than installing them, and never loads extensions or Skill content. Dynamic extension-contributed Skills are not enumerated, and future project exposure cannot be predicted. For a broader candidate-file scan, the command prints an optional portable `find "$HOME" ...` command but never executes it; candidate files are not necessarily enabled by Pi.

## Model capability slots

Every worker creation or one-shot dispatch explicitly names a `modelSlot`. Required slots are `judgment`, `craft`, and `utility`. Built-in fallbacks are `speed -> utility` and `context -> judgment`; custom slots are supported. Agent definitions have no recommended-slot mapping: `agent`, `workKind`, and `modelSlot` are independent, and Captains must not derive slots such as `test` from `tester` or `workKind=test`. Roles remain provider/model-neutral.

The user is responsible for correctly configuring every Pi provider, model, and model-specific `thinkingLevelMap` before running Horsepower. Horsepower consumes the model catalog exposed by Pi; it does not discover a model's complete thinking-level set, decide provider-specific wire values, or modify or repair `~/.pi/agent/models.json`. In particular, a local `null` mapping is treated as an explicit exclusion. Consult the provider's documentation and configure Pi first.

Run `horsepower setup --interactive` to select current Pi-visible identifiers for all required slots. Horsepower trusts the user's existing Pi authentication and model configuration and never sends an upstream probe during setup. It validates identifiers and any authoritative exact thinking metadata locally, then writes all required slot bindings atomically. Canceling or failing preserves the previous file. Setup writes only Horsepower slot bindings and does not modify Pi model configuration.

Horsepower does not preflight selected models against the upstream before dispatch. The user is responsible for keeping Pi authentication and model configuration valid. An actual worker capability rejection is reported without silently lowering thinking, changing identifiers, or retrying through a fallback; re-run `horsepower setup --interactive` to select another binding.

## Pi interface and execution campaigns

The only tool is `horsepower_subagent`. Legacy `single`, `parallel`, and `chain` actions coexist with persistent `create`, `send`, `status`, `list`, `read`, `abort`, and `destroy` actions. Only the Captain may dispatch workers; workers cannot delegate recursively.

Persistent `create` acknowledges process and initial-message admission promptly, and persistent `send`/`steer` with `wait: false` acknowledges acceptance or queuing promptly without intentionally waiting for the turn to finish. Each acknowledgement carries stable `workerId` and `messageId` identity and a current status snapshot; a fast turn may already be `completed`, but the acknowledgement is not a completion wait. Reuse the same worker and conversation for later messages, including after idle periods. Use `status` or cursor-based `read` to observe the same worker/message and completion, and use `abort` or explicit `destroy` when needed. A wait timeout stops only the wait and preserves the worker turn; abort preserves the documented worker lifecycle, while explicit destroy and process cleanup are responsible for releasing the worker. Workers do not survive host Pi process termination.

### Persistent-worker list

Run `/horsepower-workers` to append a durable, TUI-only snapshot of persistent workers created by `create` in the **current Captain Pi process**. The card remains in the transcript across later renders but is observational only: it is not sent to the model, does not create or advance work, and is not runtime or terminal truth. Re-run the command for a fresh snapshot. The structured `horsepower_subagent` `list` action remains available independently of TUI rendering.

The empty card explicitly says that no current persistent worker exists. It does **not** mean no one-shot work has run: completed or terminal `single`, `parallel`, and `chain` children are one-shot processes and are never included in this list. Each non-empty card includes every current worker (up to the eight-worker runtime limit) in deterministic order with bounded identity, lifecycle/message correlation, queued-message count, and available telemetry. Elapsed time, authoritative aggregate input/output usage, and the latest normalized assistant utterance are shown only when available; missing values are omitted rather than guessed.

Worker-list snapshots exclude prompts and message bodies, reasoning, raw events/provider payloads, unrestricted tool output, credentials, absolute private and managed-handoff paths, report bodies, and complete transcripts. Fields and the aggregate card are UTF-8-safe and bounded. Runtime-list, locale, append, or rendering failures remain observational and produce a bounded, actionable visible diagnostic rather than silent success; they do not retry recursively or change worker state. Outside interactive TUI, command invocation reports an explicit UI-unavailable outcome, while RPC command discovery and the structured `list` tool contract remain available.

Operation cards are stable, attributed, observational views of one-shot and persistent execution. `elapsed` means non-negative time since the current dispatch/message was accepted; `input` and `output` mean aggregate authoritative Pi-reported token counts for that dispatch/message, not estimates or authoritative billing, and are omitted when unavailable. `latest` is only the newest completed assistant utterance after normalization, credential/private-path redaction, control-character cleanup, and bounded UTF-8-safe truncation. Telemetry resets for each substantive message and is not terminal truth. Cards exclude prompts, reasoning, partial deltas, user/system text, raw provider payloads, unrestricted tool output, credentials, private or handoff paths, full reports, and complete transcripts. Collection or rendering failure remains observational and cannot alter execution, worker lifetime, handoff validation, or terminal truth.

### Parallel parent/child operation cards

A `parallel` dispatch is still one Captain tool call and one Pi partial-result replacement surface. Horsepower therefore projects a **parent summary** plus a **stable child row/section per admitted invocation** (canonical input/`accepted` order, at most eight children, concurrency still capped at four processes). Each partial `onUpdate` snapshot must retain every admitted child simultaneously; an interleaved event updates only the child selected by authoritative `invocationId` and must not erase, reattribute, or reorder siblings.

Parent counters (`total`, pending/running, `completed`, `failed`, `canceled`) are derived from child state, not caller-supplied totals. Each child reuses single-card identity and telemetry semantics: dispatch name, agent/role, requested→resolved slot, concrete model, thinking level, handoff mode, invocation/run IDs, current operation/status, non-negative `elapsed`, authoritative usage when present, and bounded `latest` utterance. Human labels follow `outputLocale` (`en` / `zh-CN`); names, roles, slots, model IDs, thinking values, modes, statuses, and IDs remain untranslated machine values. Per-field and aggregate UTF-8-safe bounds apply; identity for every admitted child is never omitted to save space.

**Terminal retention:** when a child completes, fails, or is canceled, its visible terminal presentation freezes against later non-terminal observational updates while siblings continue. First authoritative terminal settlement remains lifecycle truth; cards never invent missing usage, reports, or completion. Projection state is ephemeral and discarded when the parent tool call settles—it is never execution, campaign, handoff, or verification authority.

**Privacy exclusions (unchanged):** prompts, reasoning, partial assistant deltas, user/system text, raw provider payloads, unrestricted tool output, credentials, private/handoff filesystem paths, full reports, and complete transcripts stay out of parent and child card text and structured details.

**Observational rendering failures:** if projection construction or Pi's partial-result callback throws, Horsepower continues the dispatch, records only bounded delivery evidence where applicable, and still reports actual per-child and parent terminal truth. Rendering defects cannot authorize work, cancel workers, alter handoff validation, or override first-terminal-wins settlement.

If `Esc` cancels a blocking wait, Horsepower reports the structured canceled run/invocation identity and actual cancellation truth, never fabricates an absent managed report or completion, and leaves no hidden active child/run. If cancellation races completion, the first authoritative settlement wins.

Before implementation work, `/horsepower-campaign` discovers apply-ready unfinished OpenSpec changes in the current project through the official OpenSpec CLI and presents eligible candidates with bounded progress context for explicit selection—never free-form change-ID entry and never auto-selection, even when only one candidate exists. Zero eligible changes reports an actionable no-candidate result with no side effects; canceling the picker also creates nothing. After the user selects a change, Horsepower loads that change's current OpenSpec tasks. The user explicitly selects all unfinished tasks, unfinished tasks by section, or exact unfinished task IDs, confirms the normalized list, and then selects `multi_agent` or `main_agent`. A campaign is scoped to one change, those canonical task IDs, and the current Pi process. Ranges, free-form labels, completed tasks, and cross-change IDs are rejected. Candidate eligibility and the selected task snapshot are revalidated before campaign creation, and selected tasks are revalidated before every work-producing dispatch; missing, completed, invalid, or drifted state fails closed and requires a fresh `/horsepower-campaign` discovery. Successful confirmation starts exactly one Captain turn automatically—no separate `go` message is needed. While that same active campaign remains eligible, Horsepower also continues it automatically after a successful automatic Pi context compaction when Pi is not already performing its native retry; users do not type `go` after compaction. Each automatic continuation preserves the exact confirmed change, ordered task scope, and `multi_agent` or `main_agent` mode—compaction never expands or changes authority. Manual `/compact` does not imply campaign continuation, and scope drift, an explicit pause/block/terminal state, a pending message, or a replaced session/project stops automatic continuation and requires the appropriate fresh user action. Use `/horsepower-campaign-pause` to explicitly pause the current project's automatic continuation; resuming requires a newly confirmed `/horsepower-campaign`, not `go`.

One-shot workers stream bounded, redacted assistant/tool lifecycle updates. Each display includes dispatch name, agent and role, requested/resolved slot, concrete model, thinking level, and handoff mode. Every accepted dispatch returns a structured `completed`, `failed`, or `canceled` result; managed failures terminalize created handoffs instead of leaving silent orphans. `main_agent` blocks implementation workers unless the user separately authorizes a bounded reviewer.

Review campaigns bind one implementation campaign, exact task scope, fixed acceptance scope, and positive finite budget. Every in-scope root cause begins `pending`. Only the Captain may apply `accepted`, `rejected`, `needs_clarification`, or `blocked_needs_human` with a bounded technical rationale; reviewer verdicts, recommendations, confidence, agreement, duplicate examples, disposition, and resolution never dispatch work or extend/reset budget. A `fix` dispatch must name one `reviewFindingRootCauseId` that is accepted, in-scope, unresolved, and in the same project/change/campaign before budget is consumed. An accepted finding remains `open` until the Captain supplies fresh targeted verification mapped to `review-finding:<rootCauseId>`. Campaign outcome `accepted` requires every in-scope finding to be technically rejected with rationale or accepted and resolved. Truthful `scope_changed`, `blocked_needs_human`, and `canceled` outcomes remain available.

## Task-local checks and testing intensity

Horsepower relies on official strict-valid OpenSpec artifacts and does not require a separate `## Test and Gate Plan`, testing/gate profiles, or `TC-*`/`G-*` registries.

Authors may place concrete optional verification guidance directly under a task:

```markdown
- [ ] 1.1 Implement the behavior.
  - Check: Run the focused test and observe exit code zero.
```

`/horsepower-campaign` displays selected tasks and their checks (or `none`), asks the user for a fresh free-form testing-intensity prompt, and confirms that prompt together with change, exact task IDs, and execution mode. The prompt guides test breadth but cannot weaken OpenSpec validity, privacy, security, compatibility, lifecycle truth, or fresh claim-matched completion evidence.

## Managed handoffs

Every work-producing dispatch explicitly selects `handoffMode: "managed"` or `handoffMode: "inline"`; `parallel` and `chain` require `managed`. Managed `brief.md`, `report.md`, and bounded attachments are private retained artifacts. Tool results expose only summaries and opaque artifact references.

Handoffs persist until explicit cleanup or purge. They do **not** resume a worker conversation, advance OpenSpec, or become a second task/verification store. A successful managed run requires a valid current report.

## Terminal completion and notifications

A change becomes terminal only after the Captain explicitly reports `completed`, `blocked_needs_human`, `failed`, or `canceled`. `completed` requires a `verification` manifest observed after the active run began and no more than ten minutes before receipt. One to eight exact command records carry stable evidence IDs, an explicit `kind` (`e2e` or `targeted`), integer exit codes, bounded summaries (500 characters), and explicit current acceptance references; every current OpenSpec task claim must map back to successful evidence. Horsepower reruns strict official OpenSpec context validation and computes the current process-local acceptance snapshot at report time. Stale, future, failed, partial, mismatched, scope-drifted, missing, or worker-report-only evidence fails closed. Worker and reviewer output is supporting input only until the Captain independently inspects repository state and runs and reads current verification.

```json
{
  "action": "report_terminal",
  "status": "completed",
  "verification": {
    "observedAt": "2026-07-22T12:00:00.000Z",
    "commands": [{
      "id": "e2e-current",
      "kind": "e2e",
      "command": "npm run test:e2e",
      "exitCode": 0,
      "summary": "Current claim-matched E2E passed",
      "acceptanceRefs": ["task:5.4"]
    }],
    "acceptance": [{ "ref": "task:5.4", "evidenceIds": ["e2e-current"] }]
  }
}
```

If E2E is genuinely inapplicable, put a concrete `e2eWaiver` and one to eight bounded `alternativeEvidence` records inside `verification`; each record still needs a stable ID and current acceptance mapping. Legacy top-level bare `e2e`/`e2eWaiver` payloads intentionally fail with `VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED`; they are not inferred or upgraded. `failed`, `canceled`, and `blocked_needs_human` remain reportable without successful verification. The manifest is process-local runtime evidence, not a parallel OpenSpec store.

Terminal webhook payloads never include the manifest, command output, prompts, reports, or paths. They retain the existing 8 KiB canonical payload limit and expose at most 20 opaque hashed evidence references; incoming summaries are bounded to 500 characters and references to 2,048 characters before notifier hashing.

Optional change/dispatch webhooks use an explicit `generic` or `discord` provider. Existing settings without `provider` remain `generic`; Horsepower never guesses from the URL. `generic` preserves canonical JSON and supports HMAC, Bearer, or `none`. Direct Discord incoming webhooks require the `discord` provider with `auth.mode: "none"`, because the webhook URL already carries the credential. Discord delivery sends bounded text with parsed mentions disabled; it does not add private lifecycle data.

Configure Discord by creating an incoming webhook in the destination channel, selecting `discord` during Horsepower webhook configuration, pasting the URL only into the mode-`0600` Horsepower settings flow, and leaving authentication at `none`. Use `horsepower webhook test` for an explicit, visible connectivity message through the production normalization, adapter, timeout, and HTTP path. The result reports only provider, bounded failure class/status, and attempt count; it never prints the URL, token, signature, or receiver body. `horsepower doctor` performs static configuration validation only and never sends a webhook.

Human summaries follow `outputLocale` (`en` or `zh-CN`), while status and opaque identifiers remain stable. Webhook retry is bounded and in-process only: exiting Pi loses pending retries, and there is no persistent outbox. Receiver failures never alter change or dispatch terminal truth. For migration, leave legacy integrations unchanged for generic behavior, or explicitly reconfigure Discord endpoints as `discord`; do not relabel a generic HMAC/Bearer endpoint as Discord. Rotate a credential by replacing the webhook URL or generic secret/token transactionally, test the replacement explicitly, then revoke the old credential. Disablement removes stored webhook credentials.

## Lifecycle and removal

```sh
horsepower disable   # remove only Pi extension/skill links
horsepower enable    # verify current release and restore those links
horsepower uninstall # remove managed code/links, preserve user data
horsepower purge --yes # after uninstall, remove retained user data and handoffs
```

`horsepower disable` preserves the CLI, `current`, versions, settings, state, and handoffs. A running Pi process keeps its already-loaded runtime until `/reload` or restart. Workers persist only inside the current Captain Pi process; there is no daemon or cross-process conversation resume.

## Development verification

```sh
npm run check
```

The check includes type checking, unit/integration tests, deterministic build, real Pi extension loading, two-turn persistent worker smoke, installer/link lifecycle, managed handoff retention/cleanup, webhook receiver, localization, and Captain completion-gate E2E coverage.

### CLI help

`horsepower --help` and `horsepower <command> --help` provide localized, side-effect-free help. Use `horsepower help <path>` for nested paths and `--json` for stable machine-readable metadata. Set `outputLocale` with `horsepower configure --locale en|zh-CN`.
