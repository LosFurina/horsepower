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

Operation cards are stable, attributed, observational views of one-shot and persistent execution. `elapsed` means non-negative time since the current dispatch/message was accepted; `input` and `output` mean aggregate authoritative Pi-reported token counts for that dispatch/message, not estimates or authoritative billing, and are omitted when unavailable. `latest` is only the newest completed assistant utterance after normalization, credential/private-path redaction, control-character cleanup, and bounded UTF-8-safe truncation. Telemetry resets for each substantive message and is not terminal truth. Cards exclude prompts, reasoning, partial deltas, user/system text, raw provider payloads, unrestricted tool output, credentials, private or handoff paths, full reports, and complete transcripts. Collection or rendering failure remains observational and cannot alter execution, worker lifetime, handoff validation, or terminal truth.

If `Esc` cancels a blocking wait, Horsepower reports the structured canceled run/invocation identity and actual cancellation truth, never fabricates an absent managed report or completion, and leaves no hidden active child/run. If cancellation races completion, the first authoritative settlement wins.

Before implementation work, `/horsepower-campaign` loads one apply-ready change's current OpenSpec tasks. The user explicitly selects all unfinished tasks, unfinished tasks by section, or exact unfinished task IDs, confirms the normalized list, and then selects `multi_agent` or `main_agent`. A campaign is scoped to one change, those canonical task IDs, and the current Pi process. Ranges, free-form labels, completed tasks, and cross-change IDs are rejected. Selected tasks are revalidated before every work-producing dispatch; relevant drift requires a new campaign. Successful confirmation starts exactly one Captain turn automatically—no separate `go` message is needed.

One-shot workers stream bounded, redacted assistant/tool lifecycle updates. Each display includes dispatch name, agent and role, requested/resolved slot, concrete model, thinking level, and handoff mode. Every accepted dispatch returns a structured `completed`, `failed`, or `canceled` result; managed failures terminalize created handoffs instead of leaving silent orphans. `main_agent` blocks implementation workers unless the user separately authorizes a bounded reviewer.

Review campaigns bind one implementation campaign, exact task scope, fixed acceptance scope, and positive finite budget. Every in-scope root cause begins `pending`. Only the Captain may apply `accepted`, `rejected`, `needs_clarification`, or `blocked_needs_human` with a bounded technical rationale; reviewer verdicts, recommendations, confidence, agreement, duplicate examples, disposition, and resolution never dispatch work or extend/reset budget. A `fix` dispatch must name one `reviewFindingRootCauseId` that is accepted, in-scope, unresolved, and in the same project/change/campaign before budget is consumed. An accepted finding remains `open` until the Captain supplies fresh targeted verification mapped to `review-finding:<rootCauseId>`. Campaign outcome `accepted` requires every in-scope finding to be technically rejected with rationale or accepted and resolved. Truthful `scope_changed`, `blocked_needs_human`, and `canceled` outcomes remain available.

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

Optional change/dispatch webhooks support HMAC, Bearer, or none authentication. Human summaries follow `outputLocale` (`en` or `zh-CN`), while status, IDs, commands, paths, digests, artifact references, and raw evidence remain unchanged. Webhook retry is bounded and in-process only: exiting Pi loses pending retries, and there is no persistent outbox.

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
