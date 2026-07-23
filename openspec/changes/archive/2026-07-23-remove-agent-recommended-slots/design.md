## Context

Horsepower intentionally separates agent persona (`agent`), lifecycle intent (`workKind`), and capability selection (`modelSlot`). Agent definitions nevertheless retain `recommendedSlots`, a fourth layer introduced as advisory metadata. Repository search confirms it is parsed and exposed but never used for dispatch selection or validation. During a fresh installed-Pi campaign, the Captain ignored `tester.recommendedSlots: [craft, utility]` and invented `modelSlot=test` from `workKind=test`; runtime then failed closed before worker creation.

The configured slot registry already owns all legitimate capability names: required `judgment`, `craft`, and `utility`, built-in `speed` and `context` fallbacks, and explicit user-defined custom slots. Agent metadata must not become another slot authority.

## Goals / Non-Goals

**Goals:**

- Remove `recommendedSlots` from the agent-definition interface and grammar.
- Keep `agent`, `workKind`, and `modelSlot` explicit and independent.
- Make unknown-slot failures identify available current slot IDs and prohibit deriving slots from agent/work-kind names.
- Update Captain guidance and regression coverage so tester work uses an explicit existing slot such as `craft`.
- Preserve all existing model bindings and fallback semantics without rewriting user configuration.

**Non-Goals:**

- Automatically select a slot from an agent name, role, prompt, tools, or work kind.
- Add `test`, `review`, `fix`, or other lifecycle-named built-in slots.
- Restrict an agent to a fixed capability tier.
- Change concrete model or thinking configuration.

## Decisions

### 1. Delete advisory slot metadata instead of enforcing it

`recommendedSlots` is removed from bundled/custom agent frontmatter and `AgentDefinition`. Custom definitions containing it fail as an unknown field with migration guidance through the normal parser error.

Alternative: enforce the recommendations. Rejected because an agent may validly run at different capability levels and the Captain owns explicit slot selection.

Alternative: use the first recommendation as a default. Rejected because it silently chooses model capability from agent metadata, contrary to the explicit-slot requirement.

### 2. Keep explicit `modelSlot` as the only dispatch capability selector

Every work-producing dispatch continues to require `modelSlot`. `agent` chooses persona/tools, and `workKind` controls campaign/review semantics; neither is consulted by slot resolution.

### 3. Deepen unknown-slot diagnostics at the registry boundary

When a requested slot cannot resolve, the slot registry reports the unknown requested ID and a bounded sorted list of effective configured/custom/built-in slot IDs. The error explains that model slots must not be derived from agent or work-kind names and does not recommend changing valid model configuration.

This validation remains before capability accounting, run, handoff, or worker creation.

### 4. Lock the incident pattern with installed-contract tests

Tests cover `agent=tester`, `workKind=test`, `modelSlot=craft` success and `modelSlot=test` fail-closed behavior. Catalog/release fixtures prove `recommendedSlots` is no longer accepted or published. The bundled Skill explicitly names the current slot vocabulary contract.

## Risks / Trade-offs

- **[Existing custom agent definitions contain `recommendedSlots`]** → Reject with the existing source-attributed unknown-field diagnostic and document removal; no silent compatibility shim.
- **[Captain still invents a custom-looking slot]** → The actionable available-slot error makes the correction local and prevents misleading setup remediation.
- **[Removing recommendations reduces discoverability]** → Slot vocabulary belongs in the Skill and runtime diagnostics, which are authoritative and current; agent metadata was stale advisory duplication.

## Migration Plan

1. Add failing parser, registry, orchestration, Skill, release, and installed-contract tests.
2. Remove the field from types, parser, bundled definitions, fixtures, and docs.
3. Implement bounded available-slot diagnostics.
4. Run focused/full verification and strict OpenSpec validation.
5. Build/install a new immutable release and repeat the exact task `1.1` campaign with `agent=tester`, `workKind=test`, `modelSlot=craft`.

Rollback restores the previous immutable release; user slot configuration is unchanged.

## Open Questions

None.