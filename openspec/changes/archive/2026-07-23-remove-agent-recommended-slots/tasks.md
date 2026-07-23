## 1. Agent Catalog Simplification

- [x] 1.1 Add failing catalog tests proving definitions no longer require or accept `recommendedSlots` and legacy definitions receive source-attributed migration guidance.
- [x] 1.2 Remove `recommendedSlots` from `AgentDefinition`, parser metadata, bundled agent frontmatter, fixtures, and catalog consumers.

## 2. Explicit Slot Diagnostics

- [x] 2.1 Add failing slot/orchestration tests for bounded available-slot diagnostics and for `agent=tester`, `workKind=test`, `modelSlot=craft` success versus invented `modelSlot=test` failure before side effects.
- [x] 2.2 Implement unknown-slot diagnostics from the effective registry without selecting slots from agent or work-kind values or rewriting configuration.

## 3. Captain Contract and Migration

- [x] 3.1 Update the bundled Horsepower Skill and English/Chinese documentation to distinguish agent, work kind, and model slot and prohibit derived slot names.
- [x] 3.2 Update release/privacy fixtures and migration tests so public resources contain no `recommendedSlots` field and legacy custom agents fail with actionable removal guidance.

## 4. Verification

- [x] 4.1 Run focused agent-catalog, slot-registry, orchestration, extension/runtime, Skill, release, and installation tests.
- [x] 4.2 Run strict OpenSpec validation, `npm ci` under the CI npm version, typecheck, full tests, build/release privacy scan, and `npm run check`.
- [x] 4.3 Build and install a new immutable release, then repeat a fresh user-selected task `1.1` campaign and verify `agent=tester`, `workKind=test`, an explicit existing `modelSlot`, live progress, managed terminal evidence, and no invented-slot failure.