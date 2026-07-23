## 1. RED Plan Grammar and Profile Contracts

- [x] 1.1 Add failing parser tests for the documented `## Test and Gate Plan` grammar, all stable profile values, ordered `TC-*` and `G-*` IDs, required fields, mappings, applicability, waiver conditions, and deterministic normalized digests.
- [x] 1.2 Add failing bound and safety tests for missing/duplicate/unknown IDs, unknown enums, generic or incomplete case explanations, unresolved acceptance mappings, conflicting sections, oversized counts/fields/files, links, unsafe paths, and ambiguous plans.
- [x] 1.3 Add failing profile-floor tests proving `targeted|standard|exhaustive|custom` expand concretely and `required|strict|release|custom` cannot weaken applicable OpenSpec, privacy, security, compatibility, terminal-truth, E2E, or release floors.
- [x] 1.4 Add failing semantic-drift tests proving changes to profiles, cases, gates, mappings, command intent, fixtures, expectations, waiver rules, or acceptance invalidate the digest while unrelated prose/formatting does not.

## 2. OpenSpec Plan Boundary

- [x] 2.1 Implement bounded test-case, gate, profile, mapping, applicability, and non-applicability domain types plus a deterministic normalized digest independent of Markdown formatting.
- [x] 2.2 Resolve the official design/spec/task artifacts from `openspec status`, apply existing regular-file/no-follow/ownership/size protections, and parse exactly one documented test-and-gate plan without writing OpenSpec facts.
- [x] 2.3 Map each test case and gate to current official requirement/scenario or selected-task acceptance, require complete in-scope coverage or concrete non-applicability, and return actionable stable diagnostics for every invalid state.
- [x] 2.4 Expose plan snapshots through the OpenSpec boundary and integrate strict validity/current-scope reconciliation without creating a persistent parallel test, gate, acceptance, or confirmation store.

## 3. Authoring Interaction and Skill Guidance

- [x] 3.1 Update the bundled Horsepower Skill authoring guidance to draft concrete current-change testing/gate options, explain profile consequences and each case, ask the user explicitly, and never silently choose or reuse a profile.
- [x] 3.2 Add tests/fixtures for recommended, alternative, and custom profile dialogue; cancellation, unsupported input, and non-affirmation must leave the plan unconfirmed for Horsepower execution.
- [x] 3.3 Require authoring to write the expanded confirmed plan into official OpenSpec design/tasks, use stable case/gate references, reconcile deferred command intent, and never modify official generated OpenSpec Skills/prompts.
- [x] 3.4 Add localized `en` and `zh-CN` explanations for intensity, strictness, test level, setup, action, expectation, failure meaning, gate phase/pass/waiver, cancellation, invalidity, and drift while preserving machine tokens.

## 4. Campaign Confirmation and Revalidation

- [x] 4.1 Extend `/horsepower-campaign` tests to present selected tasks, mode, profiles, every in-scope case/gate, and one normalized combined confirmation without silently omitting bounded facts.
- [x] 4.2 Extend implementation-campaign state with the official normalized plan digest, selected-task mappings, and stable case/gate references while keeping it process-lifetime authorization evidence rather than planning authority.
- [x] 4.3 Implement atomic campaign creation behavior: affirmative confirmation creates and kicks off exactly one campaign; cancellation, invalid plan, or creation failure preserves the active campaign and emits no kickoff.
- [x] 4.4 Revalidate the current plan before every work-producing dispatch and eligible automatic continuation, rejecting drift before budget, run, handoff, or process creation and ignoring worker/reviewer recommendations as authority.

## 5. Completion Gate Integration

- [x] 5.1 Extend acceptance snapshots and verification-manifest validation so every applicable required `TC-*` and `G-*` reference has fresh successful Captain-observed mapped evidence or a plan-permitted valid waiver.
- [x] 5.2 Add failing completion tests for missing, stale, failed, worker-only, advisory-only, unmapped, scope-drifted, and improperly waived plan evidence plus successful required-gate and valid-waiver cases.
- [x] 5.3 Preserve existing E2E-or-valid-waiver, first-terminal-wins, review adjudication, privacy, and official OpenSpec ownership rules regardless of user-selected profiles.

## 6. Migration, Documentation, and Acceptance

- [x] 6.1 Add localized migration diagnostics for existing apply-ready changes with no valid plan and document how to revise and reconfirm them without fabricating user confirmation.
- [x] 6.2 Update English and Chinese documentation with profile semantics, mandatory floors, complete example cases/gates, authoring confirmation, campaign confirmation, semantic drift, cancellation, and completion evidence mapping.
- [x] 6.3 Add real Pi E2E for authoring-profile choice and case explanation, cancellation, successful combined campaign confirmation, relevant versus prose-only drift, dispatch blocking, and claim-matched planned-gate completion.
- [x] 6.4 Run focused boundary/campaign/verification/extension/Skill tests, strict OpenSpec validation, CI-version `npm ci`, typecheck, full unit/E2E suites, deterministic release/privacy checks, `npm run check`, and `git diff --check`.
- [x] 6.5 Build and install a new immutable alpha release, manually exercise Chinese and English test-plan confirmation plus a real selected-strength campaign, and submit fresh claim-matched terminal evidence.
