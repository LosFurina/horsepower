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

Every worker creation or one-shot dispatch explicitly names a `modelSlot`. Required slots are `judgment`, `craft`, and `utility`. Built-in fallbacks are `speed -> utility` and `context -> judgment`; custom slots are supported. Roles remain provider/model-neutral.

The user is responsible for correctly configuring every Pi provider, model, and model-specific `thinkingLevelMap` before running Horsepower. Horsepower consumes the model catalog exposed by Pi; it does not discover a model's complete thinking-level set, decide provider-specific wire values, or modify or repair `~/.pi/agent/models.json`. In particular, a local `null` mapping is treated as an explicit exclusion. Consult the provider's documentation and configure Pi first.

Run `horsepower setup --interactive` to select current Pi-visible identifiers for all required slots. Horsepower validates each exact selected thinking value with the current Pi-visible model metadata or a bounded live probe; it does not infer every level from Pi's coarse reasoning flag. Authentication, quota, timeout, transport, malformed response, and unknown failures are **inconclusive**, not proof of support. An explicit accepted-values exclusion is **unsupported**. Setup validates all required slot bindings before one atomic write, so canceling or failing preserves the previous file. Setup writes only Horsepower slot bindings and does not modify Pi model configuration.

Successful evidence is process-local, keyed to the exact identifier, thinking value, and catalog revision, and reusable for at most ten minutes. A new process, stale evidence, or a changed catalog revision requires another probe. An actual worker rejection invalidates matching evidence immediately. Horsepower preserves the configured binding: there is no silent downgrade, identifier change, or fallback retry. Re-run `horsepower setup --interactive` to select another binding, or retry after an inconclusive provider condition clears. Live probes use the configured upstream and can add latency or cost; automated acceptance tests use only the repository's deterministic offline fixture.

## Pi interface and execution campaigns

The only tool is `horsepower_subagent`. Legacy `single`, `parallel`, and `chain` actions coexist with persistent `create`, `send`, `status`, `list`, `read`, `abort`, and `destroy` actions. Only the Captain may dispatch workers; workers cannot delegate recursively.

Before implementation work, the user selects `multi_agent` or `main_agent` with `/horsepower-campaign`. The selection is scoped to one change, task scope, campaign, and Pi process. `main_agent` blocks implementation workers unless the user separately authorizes a bounded reviewer. Review campaigns have Captain-defined finite budgets and root-cause finding deduplication; a reviewer verdict never schedules another worker.

## Managed handoffs

Every work-producing dispatch explicitly selects `handoffMode: "managed"` or `handoffMode: "inline"`; `parallel` and `chain` require `managed`. Managed `brief.md`, `report.md`, and bounded attachments are private retained artifacts. Tool results expose only summaries and opaque artifact references.

Handoffs persist until explicit cleanup or purge. They do **not** resume a worker conversation, advance OpenSpec, or become a second task/verification store. A successful managed run requires a valid current report.

## Terminal completion and notifications

A change becomes terminal only after the Captain explicitly reports `completed`, `blocked_needs_human`, `failed`, or `canceled`. Completion requires Captain-selected successful E2E evidence. If E2E is genuinely inapplicable, the Captain must provide `e2eWaiver` with a concrete reason and alternative evidence; unit tests alone never complete a change.

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
