# Horsepower

Horsepower is an explicit, model-neutral multi-Agent runtime for Pi. It coordinates persistent Pi RPC workers while the official **Fission-AI/OpenSpec** CLI exclusively owns proposals, specs, designs, tasks, apply state, verification facts, and archives.

[简体中文](docs/README.zh-CN.md)

## Requirements and installation

- Linux or macOS
- Node.js 22.19 or newer
- Pi 0.80.10
- Official OpenSpec 1.6.0 or newer

Install only from the `LosFurina/horsepower` GitHub Releases page. Download the repository-owned `install.sh`, inspect it, and run it with the release version:

```sh
curl -fsSLO https://github.com/LosFurina/horsepower/raw/main/install.sh
sh install.sh --version 0.1.0-alpha.1 --no-setup
horsepower setup --interactive
```

The bootstrap downloads `horsepower-v<version>.tar.gz` and its SHA-256 asset, validates the exact layout and internal digests, then atomically switches `current`. It never uses `sudo`, edits shell startup files, or copies Pi resources. Use `--locale en` or `--locale zh-CN`; without a terminal or prior setting, English is used.

## Skill isolation and exposure audit

Every Horsepower one-shot and persistent worker starts Pi with `--no-skills`; workers do not discover global, project, settings, package, or extension-contributed Skills. This is an instruction boundary, not a filesystem, credential, network, or OS sandbox.

The main Captain intentionally remains in the user's normal, user-controlled Pi environment. Installation audits enabled static Skill resources after staged preflight and before activation. External exposure or an incomplete audit requires explicit `y`, `Y`, or `yes` in interactive installation (default No); unattended installation warns on stderr and continues without changing Pi Skill configuration.

Run `horsepower skill-audit` or `horsepower skill-audit --json` from any project. The observation-only audit covers global and current-project context, skips unavailable packages rather than installing them, and never loads extensions or Skill content. Dynamic extension-contributed Skills are not enumerated, and future project exposure cannot be predicted. For a broader candidate-file scan, the command prints an optional portable `find "$HOME" ...` command but never executes it; candidate files are not necessarily enabled by Pi.

## Model capability slots

Every worker creation or one-shot dispatch explicitly names a `modelSlot`. Required slots are `judgment`, `craft`, and `utility`. Built-in fallbacks are `speed -> utility` and `context -> judgment`; custom slots are supported. Roles remain provider/model-neutral.

Run `horsepower setup --interactive` to select current Pi-visible identifiers for all required slots. Horsepower validates each exact selected thinking value with authoritative current metadata or a bounded live probe; it does not infer every level from Pi's coarse reasoning flag. Authentication, quota, timeout, transport, malformed response, and unknown failures are **inconclusive**, not proof of support. An explicit accepted-values exclusion is **unsupported**. Setup validates all required bindings before one atomic write, so canceling or failing preserves the previous file.

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
