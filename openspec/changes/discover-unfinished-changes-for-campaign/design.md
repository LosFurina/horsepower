## Context

`/horsepower-campaign` currently uses a free-text `ctx.ui.input` for the change ID and only validates the named change after entry. The repository already has official OpenSpec CLI operations that enumerate changes and report apply progress, plus Horsepower's bounded task-inventory parser and campaign revalidation. The interaction should consume those official facts without parsing change directories directly or persisting a second registry.

The change crosses the extension UI, OpenSpec runner/boundary, localization, and campaign authorization. Discovery is observational until the user explicitly selects a candidate, exact task scope, and execution mode.

## Goals / Non-Goals

**Goals:**

- Replace free-form campaign change-ID entry with a bounded explicit selection from current-project unfinished apply-ready changes.
- Preserve official OpenSpec as the sole owner of change readiness, completion, and task facts.
- Give the user enough bounded progress context to distinguish candidates.
- Revalidate the chosen change and exact task snapshot before campaign creation.
- Keep failures deterministic, localized, privacy-safe, and side-effect free.

**Non-Goals:**

- Automatically choose a change, task scope, or execution mode for the user.
- Search registered stores or unrelated repositories.
- Infer priority from recency, names, Git state, or previous campaigns.
- Modify, archive, repair, or initialize OpenSpec changes.
- Replace the existing exact task inventory and campaign drift checks.

## Decisions

### 1. Discover through the official CLI rather than the filesystem

A bounded OpenSpec discovery seam will call the supported official CLI list/status/instructions/validation contracts and normalize eligible candidates. It will not enumerate `openspec/changes` directories or parse arbitrary artifacts to establish readiness.

Each normalized candidate contains only the stable change ID and bounded display facts needed by the UI, such as completed/total task counts. Raw CLI payloads, paths, and diagnostics are not forwarded to the picker.

Alternative considered: read directory names and each `tasks.md`. Rejected because directory presence does not prove apply readiness or supported schema state and would duplicate OpenSpec ownership.

### 2. Eligibility requires apply-ready, unfinished, and valid

A candidate is eligible only when official OpenSpec facts establish that it is apply-ready, has at least one unfinished canonical task, is not archived/completed, and passes the strict validation required for campaign creation. Malformed, duplicate, oversized, unsupported, or ambiguous results fail closed rather than being silently skipped when that could mislead authorization.

Candidate and task counts are bounded. Ordering is deterministic using the official list order when stable; otherwise a documented lexical change-ID tie-break avoids filesystem-order dependence.

Alternative considered: show every change and reject after selection. Rejected because completed or unready entries create needless dead ends and invite mistaken authorization.

### 3. Selection remains explicit even for one candidate

Zero candidates produces an actionable no-eligible-changes message. One candidate is shown for explicit confirmation rather than silently selected. Multiple candidates use a bounded picker. The selected candidate then proceeds through the existing all-unfinished, section, or exact-ID scope choice and `multi_agent`/`main_agent` choice.

Alternative considered: auto-select the sole candidate. Rejected because campaign creation is an authorization boundary and a single candidate may still not be the work the user intended to authorize.

### 4. Revalidate after selection and before side effects

Discovery produces no durable authorization. Immediately before confirmation/campaign creation, Horsepower reloads the chosen task inventory and verifies candidate eligibility plus the selected task snapshot. A disappeared, completed, invalidated, or drifted candidate returns the user to a fresh discovery flow or exits with a localized diagnostic; it does not create a campaign from stale data.

This reuses the existing campaign snapshot/digest and dispatch-time drift gates rather than adding another persisted state model.

### 5. Keep observation failure separate from execution truth

Picker rendering and localized display failures do not mutate OpenSpec or campaign state. CLI timeout, truncation, invalid JSON, excessive candidate count, duplicate IDs, unsupported schema, or validation failure produces bounded diagnostics and no campaign. No raw absolute project paths, provider data, prompts, or unrestricted command output enters UI options.

## Risks / Trade-offs

- **[Discovery may make several CLI calls]** → Bound candidate count and output bytes, avoid repeated artifact parsing, and test deterministic call limits.
- **[A change can drift while the picker is open]** → Treat discovery as observational and revalidate before campaign creation.
- **[Strict validation of all candidates can make one malformed result block discovery]** → Return an actionable fail-closed diagnostic rather than presenting a potentially incomplete authorization list.
- **[Official CLI output may evolve within the supported range]** → Normalize behind one boundary and reject unsupported shapes instead of guessing.
- **[Single-candidate confirmation adds one click]** → Preserve explicit user authorization rather than silently starting work.

## Migration Plan

1. Add deterministic discovery normalization and eligibility tests.
2. Add extension interaction tests for zero, one, multiple, cancellation, and drift cases.
3. Implement the OpenSpec discovery boundary and replace free-text input with explicit selection.
4. Update localization and user guidance.
5. Run focused/full tests, strict OpenSpec validation, and real Pi interaction acceptance.

Rollback restores the previous immutable Horsepower release and its free-text change input. No OpenSpec files or persistent campaign formats require migration.

## Open Questions

None. Initial scope is current-project repo-local discovery only; registered-store and cross-project discovery remain out of scope.
