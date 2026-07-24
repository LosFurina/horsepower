## 1. Task-local checks

- [x] 1.1 Extend the canonical OpenSpec task inventory to parse bounded ordered `Check:` child bullets, include them in selected-task identity and inventory digest, and keep tasks without checks eligible.
  - Check: Run the focused task-inventory unit tests covering multiple checks, no checks, malformed or oversized checks, ownership, ordering, and digest drift.

- [x] 1.2 Replace implementation campaign plan snapshots with bounded immutable testing guidance containing the user prompt and exact selected task/check snapshots; update continuation and dispatch drift checks accordingly.
  - Check: Run the focused implementation-campaign and extension-runtime tests covering admission, immutability, selected-check drift, continuation, and no-check tasks.

## 2. Campaign interaction and completion

- [x] 2.1 Simplify `/horsepower-campaign` to accept every strict-valid apply-ready change, request a bounded non-empty testing-intensity prompt, present selected task checks or `none`, and atomically confirm change, tasks, checks, mode, and prompt.
  - Check: Run the focused extension command tests in `en` and `zh-CN`, including confirmation, empty/canceled/oversized prompt rejection, no-check tasks, and exactly-one kickoff.

- [x] 2.2 Replace planned `TC-*`/`G-*` completion reconciliation with fresh claim-matched evidence for current selected tasks and their task-local checks while keeping platform invariants non-waivable.
  - Check: Run focused verification and lifecycle tests proving uncovered checks block completion, no-check tasks still require fresh evidence, weak prompts cannot waive invariants, and worker reports alone are insufficient.

## 3. Remove the legacy plan contract

- [x] 3.1 Delete the standalone test-and-gate parser, plan-profile lifecycle types, plan-specific diagnostics/localization, and obsolete fixtures/tests; update all remaining call sites and schemas to the simplified authority model.
  - Check: Run typecheck and a repository search proving production code no longer requires `TestAndGatePlan`, `testIntensity`, `gateStrictness`, `TC-*`, `G-*`, or `PLAN_*` campaign authority.

- [x] 3.2 Rewrite the bundled Horsepower Skill and user documentation to instruct authors to use optional task-local `Check:` lines and to ask users for a testing-intensity prompt without inventing fixed profiles or a parallel plan.
  - Check: Inspect the bundled and packaged Skill plus English and Simplified Chinese documentation for the exact simplified workflow and absence of mandatory legacy plan authoring.

## 4. Production-path verification

- [x] 4.1 Replace the legacy plan-scaffolding E2E with a production-wired `/horsepower-campaign` test using an official temporary OpenSpec root, a strict-valid multi-spec change without `## Test and Gate Plan`, task-local checks, real task/mode/prompt selections, and combined confirmation.
  - Check: Run the focused E2E in `en` and `zh-CN` and observe that plan presentation is never requested, task checks and prompt are displayed, cancellation creates no state, and confirmation creates one campaign and kickoff.

- [x] 4.2 Run typecheck, build, relevant unit and E2E tests, strict OpenSpec validation, `git diff --check`, and release privacy/manifest checks; record fresh Captain-observed evidence before completion.
  - Check: Every listed command exits zero, current acceptance is mapped to fresh evidence, and no installed immutable version is overwritten.
