## 0. Dispatch Reliability and Bundled Agents

- [x] 0.1 Keep the bundled-agent realpath fix and regression tests proving direct immutable-release and managed integration-symlink loading discover the same valid agent catalog.
- [x] 0.2 Add failing orchestration/extension tests proving pre-run validation failures and post-handoff spawn/stream/report failures return non-empty structured `failed` results rather than `No result provided`.
- [x] 0.3 Implement one idempotent dispatch/handoff finalizer that preserves the primary stage/cause, records exactly one terminal status for every created artifact, handles cleanup evidence, and forbids non-terminal orphan manifests.
- [x] 0.4 Add doctor and dispatch-preflight tests for catalog unavailable, configured model absent, exact thinking unverified/unsupported, and verified readiness; fail before handoff creation unless the selected binding is currently dispatchable.

## 1. OpenSpec Task Inventory

- [x] 1.1 Add failing parser tests for ordered numbered sections, pending/completed checkbox tasks, canonical IDs, bounded descriptions, digest stability, and current generated OpenSpec task fixtures.
- [x] 1.2 Add failing adversarial tests for duplicate IDs, malformed checkbox lines, tasks outside sections, empty inventories, oversized files/counts/descriptions, symlink/path issues, and unsupported task syntax.
- [x] 1.3 Implement the bounded observation-only OpenSpec task-inventory parser and stable inventory/selected-task digest representation.
- [x] 1.4 Extend the OpenSpec boundary to discover the resolved tasks path from official status output and return the task inventory only after supported-version, doctor, integration, apply-ready, and strict-validation checks.

## 2. Canonical Campaign Authorization

- [x] 2.1 Add failing implementation-campaign tests replacing arbitrary strings and numeric ranges with ordered unique exact task IDs plus a confirmed selected-task snapshot.
- [x] 2.2 Implement canonical campaign task selection, bounded state, exact-ID subset checks, and migration errors for ranges, arbitrary labels, completed IDs, unknown IDs, and cross-change input.
- [x] 2.3 Add failing runtime tests proving current OpenSpec tasks are revalidated before dispatch accounting, review-budget consumption, run creation, handoff creation, or worker launch.
- [x] 2.4 Implement dispatch-time project/change/task snapshot revalidation that rejects selected-task completion, removal, renumbering, movement, description drift, and invalid OpenSpec state while ignoring unrelated unselected-task drift.
- [x] 2.5 Add regression tests proving campaign cancellation creates no state, campaign switching remains explicit, one campaign cannot span changes, and no revalidation path silently refreshes or broadens authority.

## 3. OpenSpec-Aware Campaign Interaction

- [x] 3.1 Add failing extension interaction tests for change-first loading, bounded grouped inventory display, all-unfinished selection, section selection, manual exact-ID selection, duplicate normalization, final task confirmation, mode choice, cancellation, and invalid entries.
- [x] 3.2 Add complete English and Chinese localization messages for campaign inventory, choices, validation, confirmation, cancellation, drift remediation, kickoff instructions, and summaries without bilingual prompt labels or translated behavior tokens.
- [x] 3.3 Implement the staged `/horsepower-campaign` flow over injected task-inventory and campaign interfaces, creating no campaign until normalized task scope and mode are explicitly confirmed.
- [x] 3.4 Trigger exactly one Captain turn after successful campaign creation using Pi custom-message `followUp` delivery with `triggerTurn: true`; add idle, active-turn, cancellation, creation-failure, and repeated-command tests proving no missing or duplicate kickoff.
- [x] 3.5 Add bounded large-inventory and no-unfinished-task UI tests that preserve every selectable machine task ID and return actionable outcomes without unbounded output.

## 4. Live Worker Observability and Identity

- [x] 4.1 Add failing one-shot runner tests that normalize ordered assistant/tool lifecycle NDJSON into bounded redacted accepted/starting/assistant/tool/handoff/terminal progress events, including malformed, oversized, credential, and private-path cases.
- [x] 4.2 Thread an observational progress sink from Pi's `horsepower_subagent` `onUpdate` callback through extension runtime and orchestration to single, parallel, and chain runners; ensure callback failure never changes worker truth.
- [x] 4.3 Add failing title/identity tests for dispatch name, agent name and role, requested/resolved slot mapping, concrete model, thinking, handoff mode, invocation/run IDs, fallback slots, parallel/chain children, localization, and control-character/length bounds.
- [x] 4.4 Implement immutable resolved worker identities and deterministic full-identity tool titles/partial results for all one-shot stages and terminal outcomes.
- [x] 4.5 Add Pi extension E2E proving a tool-using subagent shows live attributed steps before its final result and that failed execution visibly terminates instead of waiting silently.

## 5. Captain Contract and Documentation

- [x] 5.1 Update the bundled Horsepower Skill to require apply-ready change creation before campaign selection, explain one change per campaign, tell Captains to use exact selected task IDs, and require immediate failure reporting rather than silent worker waiting.
- [x] 5.2 Update English and Chinese READMEs, command descriptions, examples, project metadata, and public campaign result details to document task selection, automatic post-confirmation start, live worker progress, full execution identity, terminal failure behavior, and dispatch-time drift failure.
- [x] 5.3 Update extension/runtime types, release fixtures, deterministic archive expectations, privacy scans, and schema-sensitive tests for canonical task IDs, bounded progress events, worker identity, and terminal evidence.
- [x] 5.4 Add migration tests proving old numeric ranges/free-form scopes fail with exact-ID guidance while legacy invisible/empty dispatch outcomes are replaced by structured progress and terminal results.

## 6. Verification and Acceptance

- [x] 6.1 Run focused OpenSpec boundary/parser, implementation-campaign, extension/runtime, one-shot runner, localization, schema, handoff lifecycle, and Pi command tests and fix only defects within this change scope.
- [x] 6.2 Run `openspec validate make-campaign-scope-selection-openspec-aware --type change --strict`, typecheck, full tests, deterministic build/release checks, and the repository's complete `npm run check` gate.
- [x] 6.3 Conduct bounded implementation and specification reviews through a Horsepower review campaign and adjudicate every in-scope finding under the verification/review discipline available in the implementation release.
- [x] 6.4 Run a fresh Captain-selected Pi E2E covering bundled agent discovery through integration symlink, current model readiness, real OpenSpec task selection, exactly-once automatic kickoff, full worker identity title, live tool steps, valid managed report completion, structured spawn/report failure without orphan state, selected dispatch, and drift rejection; report exact current evidence.
