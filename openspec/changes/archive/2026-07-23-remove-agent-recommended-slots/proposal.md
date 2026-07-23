## Why

Bundled agent definitions currently declare `recommendedSlots`, but runtime dispatch neither consumes nor validates that metadata. This inert extra mapping misled the Captain into deriving an unconfigured `test` slot for the `tester` agent, causing a valid campaign to fail before worker launch even though the configured `craft` slot was appropriate.

## What Changes

- **BREAKING** Remove `recommendedSlots` from agent definitions, catalog types, parser grammar, fixtures, and public documentation.
- Preserve explicit `modelSlot` on every work-producing dispatch; Horsepower continues to forbid implicit model selection from agent name, role, or `workKind`.
- Reject unknown requested slots before capability/handoff/worker side effects with bounded diagnostics listing the currently available capability slot IDs and explaining that slot names must not be derived from agent or work-kind names.
- Update the bundled Horsepower Skill to require Captains to choose an existing configured or built-in fallback slot.
- Add migration and real installed-Pi regression coverage for `agent=tester`, `workKind=test`, `modelSlot=craft`, plus fail-closed `modelSlot=test` behavior.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-catalog`: Agent definitions no longer contain an inert recommended-slot layer.
- `model-slots`: Explicit dispatch uses only current configured/custom/built-in fallback slot IDs and returns actionable unknown-slot diagnostics without suggesting configuration changes for an invented slot.

## Impact

Affected areas include bundled agent Markdown frontmatter, agent discovery/types, orchestration slot resolution errors, the bundled Skill, release/privacy fixtures, unit and E2E tests, and documentation. Existing user model-slot configuration remains valid and is not rewritten. Custom agent files containing `recommendedSlots` require removal of that field.