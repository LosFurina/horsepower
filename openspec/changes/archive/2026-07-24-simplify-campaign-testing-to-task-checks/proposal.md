## Why

Horsepower currently requires every implementation campaign to carry a separate, parser-specific test-and-gate plan even when the official OpenSpec change is already strict-valid. This duplicates planning facts, blocks otherwise apply-ready changes, and makes routine testing more ceremonial than useful.

## What Changes

- **BREAKING** Remove the mandatory `## Test and Gate Plan`, `TC-*`, `G-*`, `NA-*`, `testIntensity`, `gateStrictness`, gate-floor, coverage-mapping, and plan-digest requirements from Horsepower campaign creation and execution.
- Treat official strict OpenSpec validity and unfinished task inventory as the planning eligibility boundary.
- Let authors put concrete verification guidance directly under tasks as optional `Check:` lines; Horsepower preserves and presents checks associated with selected tasks when available.
- Require `/horsepower-campaign` to ask the user for a non-empty bounded testing-intensity prompt, without imposing a fixed profile enum or translating it into a parallel plan registry.
- Atomically confirm the selected change, exact task IDs, execution mode, task-local checks, and testing-intensity prompt before campaign creation.
- Preserve the confirmed prompt and selected task checks in bounded campaign authority so workers and Captain can use them during implementation and completion verification.
- Keep Horsepower’s non-negotiable OpenSpec validity, privacy, security, compatibility, scope, lifecycle, terminal-truth, and evidence rules independent of user testing preferences.
- Remove obsolete parser, UI, localization, fixtures, tests, and documentation that exist solely for the separate test-and-gate plan.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-execution-boundary`: Replace mandatory parser-specific test-and-gate planning with official OpenSpec strict validity, optional task-local checks, and a user-provided testing-intensity prompt.
- `explicit-dispatch`: Change campaign confirmation and dispatch authority to carry exact task checks and the confirmed testing-intensity prompt rather than test/gate profiles and plan entries.

## Impact

This changes the OpenSpec boundary, task inventory parser, implementation-campaign state, `/horsepower-campaign` interaction, continuation/drift checks, completion guidance, localization, bundled Horsepower Skill, and related unit/E2E fixtures. Existing changes no longer need a `## Test and Gate Plan`; their ordinary OpenSpec artifacts and unfinished tasks remain authoritative. Existing active in-process campaigns are not migrated across extension reloads or process replacement.
