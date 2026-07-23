## Context

The CLI currently stores executable first-level commands in a `commands` object, while the `help` command owns a separate hard-coded list of five examples. Argument dispatch checks `argv.includes("--help") || argv.includes("-h")` before resolving the selected command and rewrites every help request to the same top-level `help` invocation. As a result, `horsepower doctor --help`, `horsepower webhook configure --help`, and even unknown command paths do not expose path-specific contracts.

Several commands contain their own positional action dispatch (`webhook`, `handoff`), and the supported flags are enforced separately through `only(...)`. A robust help implementation must prevent those execution parsers from drifting away from displayed usage while guaranteeing that help cannot enter mutating or networked command handlers.

## Goals / Non-Goals

**Goals:**

- Provide successful, command-specific `--help` and `-h` for every public command path.
- Provide a complete top-level command index and equivalent `horsepower help <path>` lookup.
- Make executable command metadata and help discovery share one bounded authoritative registry.
- Keep help side-effect-free, localized, deterministic, and testable in text and JSON modes.
- Detect missing, duplicate, unreachable, or inconsistent help metadata in tests.

**Non-Goals:**

- Add new business commands such as `horsepower install`; installation remains owned by `install.sh` unless separately proposed.
- Redesign existing command arguments, defaults, exit codes, or business behavior.
- Generate shell completions, man pages, or an interactive help browser.
- Translate command names, flags, enum values, paths, IDs, or JSON field names.

## Decisions

### 1. Use a declarative recursive command registry

Each public command node will own a stable name, localized description ID, usage forms, positional argument metadata, option metadata, examples, optional child nodes, and its existing execution handler. The top-level index and path-specific help renderer will traverse this same registry. Registry construction or contract tests will reject duplicate sibling names, missing help metadata, invalid usage prefixes, and executable public nodes that cannot be reached by help traversal.

Alternative: maintain a second help table. Rejected because the current defect is caused by execution/help drift and future commands would repeat it.

### 2. Resolve help before platform and business execution

The dispatcher will parse a help intent and resolve the longest public command path before checking `requiresPlatform` or calling any command handler. Supported forms are `horsepower --help`, `horsepower -h`, `horsepower <path> --help`, `horsepower <path> -h`, and `horsepower help [<path>]`. Unknown paths remain usage errors rather than silently showing unrelated help. Help rendering will not call setup catalog discovery, OpenSpec, webhook delivery, handoff storage, filesystem mutation, platform checks, confirmation prompts, or command-specific parsers.

Alternative: pass `--help` into every handler. Rejected because it duplicates control flow and risks side effects before help is recognized.

### 3. Model nested actions as child command metadata

`webhook show|disable|configure|test` and `handoff list|inspect|clean|clean-terminal` will be explicit child nodes rather than undocumented positional strings. First-level help lists children; child help shows exact usage and only its own arguments/options. Existing runtime handlers may continue receiving normalized positionals, but child metadata is authoritative for discoverability and contract coverage.

### 4. Keep text and JSON help semantically equivalent

Text help will contain localized headings/descriptions plus stable usage lines, arguments, options, child commands, and examples. `--json` will return bounded stable fields such as `commandPath`, `usage`, `description`, `arguments`, `options`, `subcommands`, and `examples`, with normal success envelope and exit code 0. Human descriptions follow effective `en` or `zh-CN`; machine tokens remain unchanged.

### 5. Test completeness and absence of side effects

Table-driven tests will enumerate every registry path and invoke both long and short help forms. Dependency spies and temporary filesystem snapshots will prove no command implementation, network adapter, confirmation prompt, config write, integration mutation, handoff cleanup, model discovery, OpenSpec call, or upstream probe occurs. Installer/release E2E will invoke the built CLI so source-only behavior cannot pass while the packaged binary is broken.

## Risks / Trade-offs

- **[Metadata duplicates option validation details]** → Keep machine tokens in typed metadata and add contract tests against accepted/rejected parser behavior for representative commands.
- **[Hidden operational commands become accidentally undocumented]** → Treat every key in the public execution registry, including `preflight`, as help-addressable unless it is deliberately moved to an explicit internal registry by a future change.
- **[Localization expands many strings]** → Localize descriptions and headings through existing message infrastructure while keeping bounded structural tokens shared.
- **[Help parsing could mask invalid command paths]** → Resolve the complete requested path and return a usage error for unknown command or nested action names.

## Migration Plan

1. Introduce typed help metadata and recursive path lookup around the existing registry.
2. Add RED completeness, path-resolution, localization, JSON, and no-side-effect tests.
3. Move nested webhook/handoff action descriptions into child metadata without changing their execution behavior.
4. Replace the global help rewrite with path-aware early dispatch.
5. Update English/Chinese docs and run packaged CLI E2E across all public paths.

Rollback restores the prior CLI dispatcher and registry; no persisted configuration or state migration is required.

## Open Questions

None. This change covers commands currently registered by the `horsepower` binary; `install.sh` remains a separate interface.
