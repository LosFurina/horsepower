## 1. Registry and RED Contracts

- [ ] 1.1 Add failing table-driven CLI tests that enumerate every current first-level command and require both `<command> --help` and `<command> -h` to return status 0 with the exact command path and command-specific usage.
- [ ] 1.2 Add failing tests for every current nested webhook and handoff path, parent child-command listings, `horsepower help <path>` equivalence, and stable unknown first-level/nested help failures.
- [ ] 1.3 Add failing registry-completeness tests for duplicate names, missing descriptions/usage, invalid usage prefixes, unreachable executable commands, missing nested metadata, and bounded metadata limits.

## 2. Side-Effect and Localization Contracts

- [ ] 2.1 Add failing dependency-spy and filesystem-snapshot tests proving help for mutating, destructive, discovery, networked, and platform-restricted paths invokes no handler, platform gate, prompt, write, deletion, link mutation, OpenSpec/model/Skill discovery, webhook, handoff cleanup, or upstream adapter.
- [ ] 2.2 Add failing English and Chinese text-help tests proving localized headings/descriptions and untranslated command paths, flags, enum values, metavariables, paths, and examples.
- [ ] 2.3 Add failing JSON-help tests for every valid path, requiring the normal success envelope and stable bounded commandPath, usage, description, arguments, options, subcommands, and examples fields.

## 3. Help Registry and Dispatch

- [ ] 3.1 Implement typed recursive command/help metadata shared by executable first-level commands and explicit nested webhook/handoff actions.
- [ ] 3.2 Implement longest-path help resolution for top-level `--help`/`-h`, path-specific flags, and `horsepower help [<path>]`, preserving usage errors for unknown paths.
- [ ] 3.3 Implement bounded localized text and JSON rendering while ensuring help resolves before platform checks and all business handlers.
- [ ] 3.4 Update existing command parsers and tests only as needed to consume registry-owned nested action metadata without changing non-help command behavior or exit semantics.

## 4. Documentation and Release Verification

- [ ] 4.1 Update English and Chinese documentation with complete top-level discovery, command-specific help, nested help examples, JSON help, localization behavior, and the separate `install.sh` boundary.
- [ ] 4.2 Add packaged CLI E2E that derives every public path from the authoritative registry and proves both help flags succeed without side effects in the deterministic release artifact.
- [ ] 4.3 Run focused CLI/localization/release tests, strict OpenSpec validation, CI-version `npm ci`, typecheck, full unit/E2E suites, deterministic release privacy checks, `npm run check`, and `git diff --check`.
- [ ] 4.4 Build and install a new immutable alpha release, manually smoke top-level, representative first-level, nested, Chinese, JSON, unknown-path, and unsupported-platform help, then submit fresh claim-matched terminal evidence.
