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
horsepower setup
```

The bootstrap downloads `horsepower-v<version>.tar.gz` and its SHA-256 asset, validates the exact layout and internal digests, then atomically switches `current`. It never uses `sudo`, edits shell startup files, or copies Pi resources. Use `--locale en` or `--locale zh-CN`; without a terminal or prior setting, English is used.

## Model capability slots

Every worker creation or one-shot dispatch explicitly names a `modelSlot`. Required slots are `judgment`, `craft`, and `utility`. Built-in fallbacks are `speed -> utility` and `context -> judgment`; custom slots are supported. Roles remain provider/model-neutral.

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
