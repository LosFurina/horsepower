## Why

`/horsepower-campaign` currently asks the user to type a change ID even though official OpenSpec already owns a bounded inventory of changes in the current project. Manual entry is error-prone, permits accidental task text to be appended to the ID, and makes users remember identifiers that Horsepower can safely discover without weakening explicit authorization.

## What Changes

- Discover current-project OpenSpec changes through the supported official CLI boundary when `/horsepower-campaign` starts.
- Present only apply-ready changes that still contain unfinished tasks as an explicit user selection list, with bounded progress context and deterministic ordering.
- Handle zero, one, and multiple eligible changes without requiring free-form change-ID input or silently selecting a campaign scope or mode.
- Revalidate the selected change and its task inventory before confirmation and campaign creation so discovery does not become stale authorization.
- Fail closed on malformed, ambiguous, oversized, invalid, archived, completed, or unsupported OpenSpec results while preserving localized actionable errors.
- Keep task-scope and `multi_agent`/`main_agent` selection explicit and unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-execution-boundary`: Add bounded discovery and validation of apply-ready unfinished changes from the current official OpenSpec project.
- `explicit-dispatch`: Replace free-form campaign change-ID entry with explicit selection from discovered eligible changes while retaining explicit task-scope and mode authorization.

## Impact

Affected areas include the `/horsepower-campaign` extension UI, OpenSpec CLI runner/boundary and task-inventory integration, localization, campaign confirmation, tests for candidate discovery and drift, and English/Chinese/Skill documentation. No parallel change registry is introduced, OpenSpec files are not modified by discovery, and worker dispatch contracts remain unchanged.
