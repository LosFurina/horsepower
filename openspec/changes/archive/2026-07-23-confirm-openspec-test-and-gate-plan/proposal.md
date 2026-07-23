## Why

Horsepower currently requires strong evidence at completion, but OpenSpec authoring can reach apply-ready without the user explicitly choosing how deeply to test, how strict the implementation gates must be, or understanding the concrete cases that will prove the change. This leaves important cost, confidence, and acceptance expectations implicit until implementation is already underway.

## What Changes

- Require Horsepower-assisted OpenSpec authoring to present and obtain explicit user confirmation of a bounded testing-intensity profile and gate-strictness profile before treating a change as ready for Horsepower implementation.
- Require an expanded test-and-gate plan in official OpenSpec artifacts rather than a Horsepower-private planning registry.
- Explain every planned test case using stable IDs, mapped OpenSpec requirements/scenarios or task acceptance, test level, setup, action, expected result, and the failure or risk it detects.
- Present concrete profile effects and estimated scope instead of silently applying a default label; allow bounded custom selections.
- Reconfirm after relevant requirement, scenario, task, test-case, command, environment, or gate drift, while allowing unrelated prose edits to preserve confirmation.
- Block Horsepower campaign creation and work-producing dispatch when the current plan is missing, malformed, unconfirmed, incomplete, or stale, without modifying official OpenSpec facts.
- Keep confirmation localized, side-effect-safe on cancellation, and compatible with official OpenSpec CLI/schema ownership.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-execution-boundary`: Add user-confirmed test intensity, gate strictness, concrete case explanation, official-artifact persistence, drift detection, and apply/campaign enforcement.
- `explicit-dispatch`: Require the confirmed current test-and-gate plan to be included in implementation campaign authorization and dispatch-time revalidation.

## Impact

Affected areas include Horsepower’s bundled Skill instructions, OpenSpec artifact parsing and validation, campaign selection/confirmation, implementation-campaign snapshots, dispatch authorization, localization, documentation, and unit/real-Pi E2E tests. Horsepower will not modify official OpenSpec-generated `.pi/skills` or `.pi/prompts`, invent a replacement schema, or store a second authoritative test plan.
