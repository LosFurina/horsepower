## Context

Horsepower currently relies on official OpenSpec artifacts for planning, requires explicit task/mode confirmation when starting an implementation campaign, and enforces fresh claim-matched evidence at completion. However, the authoring workflow does not require the user to choose testing depth or gate strictness, and tasks often mention commands without explaining the concrete behavioral cases they prove. The first enforceable user interaction today occurs at campaign selection, after a change may already be technically apply-ready according to official OpenSpec.

Horsepower must not modify official OpenSpec-generated Skills or prompts, invent a replacement OpenSpec schema, or persist a second planning registry. The solution therefore needs both authoring discipline in the bundled Horsepower Skill and runtime enforcement at the Horsepower campaign boundary. Official OpenSpec remains free to call its artifact state complete; Horsepower separately determines whether that official change is eligible for Horsepower execution.

## Goals / Non-Goals

**Goals:**

- Ask the user to explicitly choose and confirm testing intensity and gate strictness for every Horsepower-authored change.
- Explain the actual current-change cases and gates before confirmation, not just labels.
- Persist the resulting plan in official OpenSpec artifacts and derive normalized bounded snapshots from them.
- Require campaign-time confirmation of the current plan and fail closed on relevant drift.
- Reconcile completion evidence with required planned cases and gates while preserving existing mandatory floors.
- Localize human explanations in `en` and `zh-CN` while keeping machine tokens stable.

**Non-Goals:**

- Change official OpenSpec CLI/schema readiness semantics or generated `.pi/skills`/`.pi/prompts`.
- Allow a low profile to bypass strict OpenSpec, security/privacy, compatibility, lifecycle, claim-matching, or E2E requirements.
- Predict exact implementation commands when the harness does not yet exist.
- Store user choices in global defaults, settings, runtime-only registries, or a parallel acceptance database.
- Automatically rewrite a plan from reviewer or worker recommendations.
- Require a user prompt for unrelated formatting/prose changes that do not change normalized facts.

## Decisions

### 1. Use explicit profiles only as shorthand for an expanded official plan

Testing profiles are `targeted`, `standard`, `exhaustive`, and `custom`. Gate profiles are `required`, `strict`, `release`, and `custom`. The authoring interaction may recommend a profile based on risk, but must describe its concrete current-change effects and ask the user to select it. No implicit default is accepted.

`targeted` concentrates on directly changed acceptance and regressions; `standard` adds applicable unit, integration, failure-path, and selected E2E coverage; `exhaustive` adds applicable boundaries, adversarial/error, concurrency, platform, compatibility, and full regression coverage. `required` includes repository baseline and existing mandatory completion gates; `strict` adds applicable full suites and zero unresolved required failures; `release` adds deterministic release/privacy, packaged artifact, immutable installation/update, rollback, and real-environment acceptance where applicable. `custom` must expand to explicit entries and cannot weaken mandatory floors.

Alternative: store only two labels. Rejected because labels do not explain cost or prove acceptance coverage and could drift semantically over time.

### 2. Define a documented bounded Markdown section in `design.md`

The canonical plan will live under one `## Test and Gate Plan` section in the official design artifact because it captures cross-cutting verification design. It contains stable profile fields, ordered `TC-<number>` cases, ordered `G-<number>` gates, explicit acceptance mappings, applicability, required/advisory disposition, execution phase, and bounded explanations. Tasks reference these IDs rather than redefining them.

Each test case records:

- stable ID and mapped requirement/scenario or task acceptance references;
- test level;
- purpose/risk;
- preconditions/fixtures;
- action or command intent;
- expected observable result;
- failure meaning;
- required/advisory disposition or justified non-applicability.

Each gate records:

- stable ID;
- explicit mapped current requirement/scenario or task-acceptance references (never inferred from scope prose);
- command or inspection intent and scope;
- pass condition;
- required/advisory disposition;
- execution phase;
- permitted waiver condition, if any.

Alternative: add a Horsepower-owned `test-plan.json`. Rejected because it creates a parallel planning artifact outside the active official schema and is easy to desynchronize.

### 3. Separate artifact-recorded choices from runtime proof of user confirmation

A model-written `confirmed: true` field cannot prove that a user actually confirmed it. The artifacts record the selected values and expanded plan; `/horsepower-campaign` supplies the enforceable interaction by displaying the normalized current plan and requiring affirmative confirmation alongside task scope and execution mode. Campaign state stores only a process-lifetime digest/snapshot needed for authorization, not an independent planning source.

The bundled Horsepower Skill will also instruct the Captain, while authoring or revising OpenSpec, to draft the complete plan, explain it, ask the user, and only then finalize the selected profile fields. If the user cancels, the draft may remain planning work but Horsepower cannot start a campaign.

Alternative: trust a text marker as confirmation. Rejected because the Captain could fabricate it and campaign creation could not distinguish user choice from generated prose.

### 4. Parse and normalize through the OpenSpec boundary

The boundary obtains artifact paths from official `openspec status`, validates the change strictly, applies existing no-follow/regular-file/size protections, and parses the documented section with explicit bounds. It maps plan references to current requirement/scenario identities and selected tasks, rejects duplicates or ambiguity, and computes a SHA-256 digest over normalized semantic fields rather than raw Markdown bytes.

Formatting and unrelated prose changes therefore do not invalidate confirmation, while changed profiles, cases, gates, mappings, commands/intents, fixtures, expectations, waiver conditions, or acceptance facts do.

### 5. Extend campaign confirmation and snapshots

`/horsepower-campaign` will present, in order:

1. current task selection;
2. execution mode;
3. selected testing and gate profiles with concrete effects;
4. every in-scope case and applicable gate explanation;
5. one final combined confirmation.

Campaign state snapshots plan digest, normalized selected-task mappings, and stable case/gate IDs. A cancellation or validation failure creates no campaign and does not end an existing one. Dispatch-time OpenSpec revalidation compares the current normalized plan before budget or process creation. Automatic compaction continuation carries no new authority and remains subject to the same check.

### 6. Extend completion reconciliation without replacing the verification manifest

The existing verification manifest remains the only runtime completion-evidence structure. The plan parser exposes acceptance, case, and gate references that completion must cover. Required plan entries require fresh successful Captain-observed command evidence or an explicitly allowed valid waiver with concrete mapped alternative evidence. Advisory entries remain visible but cannot substitute for mandatory evidence.

Alternative: create a new test-result registry. Rejected because it duplicates current verification facts and would violate OpenSpec/runtime ownership boundaries.

### 7. Make case explanations useful rather than ceremonial

Authoring guidance and validators reject generic `test it`, profile-only plans, and unmapped command lists. Exact command syntax may be deferred only when a future implementation harness is genuinely unknown; the test level, harness/command intent, setup, action, expected observable result, and failure meaning must still be concrete. Tasks include reconciliation of deferred command intent before implementation completion.

### 8. Bound all interactions and mappings

The plan will have documented limits for total bytes, cases, gates, mappings per entry, and field lengths, aligned with current task/verification bounds. Large plans use paginated or staged UI presentation but cannot silently omit IDs. Human explanations are localized; profile values, IDs, commands, paths, and references remain untranslated.

## Risks / Trade-offs

- **[More prompts slow small changes]** → Recommend `targeted`/`required` for genuinely small work, but still require one informed confirmation.
- **[Plans become boilerplate]** → Require acceptance mappings and failure meaning; reject generic cases and commands without behavioral explanation.
- **[Parsing Markdown couples Horsepower to formatting]** → Isolate one documented bounded section and derive paths from official CLI output; fail closed on ambiguity.
- **[Profile semantics conflict with repository scripts]** → Expanded gate entries are authoritative for the change, while mandatory repository floors remain non-waivable.
- **[Campaign interaction becomes long]** → Group by test level/gate phase, page within bounds, and provide a final normalized summary without omitting selectable facts.
- **[Artifacts claim confirmation without user input]** → Do not trust a marker; enforce actual affirmative confirmation at campaign creation.
- **[Cross-change scope drift]** → Digest normalized plan plus mapped acceptance and require a new campaign on relevant drift.
- **[Existing active changes lack plans]** → Introduce an explicit migration path that requires adding and confirming a plan before new Horsepower implementation campaigns; observation and cleanup remain available.

## Migration Plan

1. Document and test the Markdown plan grammar, bounds, profile floors, and acceptance mappings.
2. Add the parser/snapshot to the OpenSpec boundary with strict no-follow and drift behavior.
3. Update bundled Horsepower authoring instructions to draft, explain, and ask before finalization without touching official generated Skills.
4. Extend campaign UI, state, kickoff context, and dispatch-time revalidation.
5. Extend completion acceptance snapshots to require applicable planned case/gate evidence.
6. Add migration diagnostics for existing changes missing a plan and update English/Chinese documentation.
7. Exercise real Pi authoring confirmation, cancellation, campaign confirmation, drift, and completion evidence in a new immutable alpha release.

Rollback removes plan enforcement and campaign fields. Official OpenSpec Markdown remains ordinary design content; no external state migration or deletion is needed.

## Open Questions

None. Exact parser bounds will be fixed and documented during implementation, and must remain sufficient for the existing maximum of 100 selected tasks while keeping UI and artifact reads bounded.
