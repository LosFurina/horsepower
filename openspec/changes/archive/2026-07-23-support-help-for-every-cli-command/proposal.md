## Why

Horsepower currently treats `--help` and `-h` as a global shortcut, so every command path prints the same incomplete top-level list instead of documenting the selected command. Users cannot reliably discover supported arguments, flags, nested actions, safety constraints, or examples without reading source code or external documentation.

## What Changes

- Make `horsepower --help` and `horsepower help` present a complete bounded top-level command index.
- Require every public first-level command to support command-specific `--help` and `-h` with usage, purpose, arguments, options, and nested actions where applicable.
- Require every public nested command path, including webhook and handoff actions, to support path-specific help.
- Make one declarative command registry authoritative for execution and help discovery so newly added public commands cannot silently omit help metadata.
- Ensure help requests exit successfully and perform no configuration writes, installation changes, network requests, audits, probes, handoff cleanup, or other command side effects.
- Preserve localized human guidance for `en` and `zh-CN` while leaving commands, flags, enums, IDs, paths, and JSON fields untranslated.
- Add stable machine-readable help via `--json` without changing the behavior of non-help command execution.

## Capabilities

### New Capabilities
- `cli-help`: Complete, localized, side-effect-free help discovery for every public Horsepower CLI command path.

### Modified Capabilities

None.

## Impact

Affected areas include the CLI command registry and argument dispatcher in `src/cli/app.ts`, localized messages and terminal rendering, CLI unit and installer/E2E tests, release documentation, and public command metadata. No worker orchestration, OpenSpec ownership, model-slot semantics, installation topology, or command business behavior changes are intended.
