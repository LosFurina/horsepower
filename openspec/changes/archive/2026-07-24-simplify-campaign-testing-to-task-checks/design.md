## Context

Horsepower currently parses a second planning language from `design.md`, expands testing and gate profiles, maps acceptance references to `TC-*`/`G-*` entries, snapshots a plan digest, and revalidates it throughout campaign lifecycle. This duplicates official OpenSpec tasks and scenarios and can reject a strict-valid apply-ready change for Horsepower-specific formatting reasons.

The simpler contract keeps OpenSpec as the only planning authority. Verification intent belongs beside the work item in `tasks.md`; campaign-specific desired test breadth is ordinary user instruction confirmed with the campaign, not a new planning schema.

## Goals / Non-Goals

**Goals:**

- Allow every strict-valid, apply-ready change with unfinished canonical tasks to reach campaign confirmation without a separate plan section.
- Parse optional task-local `Check:` lines conservatively and bind them to their immediately preceding task.
- Ask for one non-empty bounded testing-intensity prompt on every campaign creation.
- Confirm and preserve exact task scope, checks, mode, and testing prompt.
- Revalidate official task identity and checks before advancing work.
- Keep fresh Captain-observed completion evidence and all platform safety boundaries.
- Delete obsolete test-and-gate parser machinery rather than retaining a dormant parallel model.

**Non-Goals:**

- Define testing profile enums or prescribe a universal number or kind of tests.
- Require every task to contain a `Check:` line.
- Add a second test, gate, acceptance, confirmation, or evidence registry.
- Let a user prompt waive OpenSpec validity, privacy, security, compatibility, scope, lifecycle truth, or claim-matched terminal evidence.
- Change OpenSpec’s own validation rules or file format.

## Decisions

### 1. Task-local checks are optional OpenSpec task metadata

A task may be followed by one or more indented bullets whose normalized text begins with `Check:`. Each check belongs only to the immediately preceding recognized task and is retained in source order. A task without checks remains eligible because official OpenSpec strict validity is the only planning-format gate.

The parser applies existing artifact limits plus bounded check counts and UTF-8 lengths, rejects malformed or unsafe values, and includes checks in the task inventory digest. This ensures a selected task’s verification intent cannot change silently while preserving ordinary OpenSpec compatibility.

Example:

```markdown
- [ ] 1.1 Preserve actionable campaign failures.
  - Check: Run the focused campaign command test.
  - Check: A strict-valid fixture reaches combined confirmation.
```

### 2. Testing intensity is free-form confirmed instruction

`/horsepower-campaign` asks the user to describe the desired testing intensity in one bounded, non-empty prompt. It offers localized examples only as guidance and does not default, infer, persist globally, or constrain the response to machine enums.

The prompt is normalized, redacted using the same credential/private-path discipline as other bounded UI content, and capped at 2,000 UTF-8 bytes. Empty, canceled, oversized, or unsafe input creates no campaign.

This prompt is execution guidance. It does not become an OpenSpec artifact, acceptance registry, or authority to weaken mandatory platform rules.

### 3. Combined confirmation is the authorization boundary

Before campaign creation, Horsepower presents:

- change ID;
- exact selected pending task IDs and descriptions;
- each selected task’s current `Check:` lines, or an explicit `none` marker;
- `multi_agent` or `main_agent` mode;
- the normalized testing-intensity prompt.

Only one affirmative combined confirmation creates a campaign and kickoff. Cancellation or failure leaves existing campaign state unchanged.

### 4. Campaign authority snapshots checks and prompt, not a plan digest

Implementation campaign state replaces `CampaignPlanSnapshot` with a bounded testing-guidance snapshot containing the confirmed prompt and selected task/check records. Continuation identity continues to use the official inventory digest, which now includes task checks. Dispatch and continuation reload canonical tasks and fail closed when a selected task’s ID, description, section, pending state, or checks drift.

The user’s prompt remains unchanged for the campaign lifetime. A different prompt requires a new campaign; workers and reviewers cannot mutate it.

### 5. Completion remains claim-matched without planned gate IDs

Horsepower no longer reconciles `TC-*` or `G-*`. Captain verification instead uses current selected task acceptance plus confirmed task-local checks as concrete guidance. Checks requiring commands or observable outcomes must receive fresh matching evidence before the task is claimed complete. When no check exists, Captain still supplies fresh evidence appropriate to the task and cannot rely solely on worker reports.

The testing-intensity prompt guides breadth but does not itself create an individually claim-matched check and cannot authorize fabricated, stale, failed, or unmapped evidence.

### 6. Remove obsolete machinery end-to-end

The implementation removes `src/openspec/test-and-gate-plan.ts`, plan-specific lifecycle types, UI/profile localization, parser fixtures, and tests whose only purpose is the removed contract. Existing tests are rewritten around task checks and free-form prompt confirmation. Release and privacy validation remain unchanged.

### 7. Installed compatibility is release-bound

This is a breaking campaign contract delivered as a new immutable version. Reloading replaces process-local runtime state; active campaigns are not serialized or migrated. Older installed versions remain immutable and may continue to enforce their old contract when explicitly selected.

## Risks / Trade-offs

- **[Free-form prompts are less mechanically comparable]** → Keep them bounded, confirmed, immutable for the campaign, and subordinate to task checks and platform invariants.
- **[Optional checks may produce underspecified verification]** → Prompt visibly shows `none`; Captain must still collect fresh task-appropriate evidence, while authors are encouraged—not blocked—to add checks.
- **[Indented task prose could be misclassified]** → Recognize only explicit normalized `Check:` child bullets immediately following a canonical task.
- **[Removing plan machinery touches many modules]** → Delete it in small compiler-guided steps and replace production-path campaign E2E coverage before removing legacy fixtures.
- **[Old active campaign shapes are incompatible]** → Campaign authority is process-local; release activation requires reload and starts a fresh campaign.
