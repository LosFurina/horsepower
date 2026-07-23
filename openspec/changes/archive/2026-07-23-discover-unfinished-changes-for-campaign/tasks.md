## 1. Discovery Contract

- [x] 1.1 Add failing OpenSpec-boundary tests for zero, one, and multiple eligible changes; deterministic ordering; bounded display progress; and exclusion of completed, archived, unready, invalid, or taskless changes.
- [x] 1.2 Add failing boundary tests for malformed/truncated CLI JSON, duplicate or invalid change IDs, unsupported schemas, candidate/byte/count limits, validation failures, and CLI timeout/error diagnostics.
- [x] 1.3 Implement bounded current-project change discovery through supported official OpenSpec CLI operations, reusing task-inventory normalization and exposing no raw paths or unrestricted payloads.

## 2. Campaign Selection Interaction

- [x] 2.1 Add failing extension tests proving `/horsepower-campaign` no longer requests free-form change-ID input and explicitly presents one or multiple discovered eligible candidates.
- [x] 2.2 Add failing interaction tests for no eligible candidates, user cancellation, picker/render failure, localized labels, bounded progress context, and absence of campaign/run/worker/handoff side effects.
- [x] 2.3 Implement explicit discovered-change selection while preserving the existing all-unfinished, section, exact-task-ID, confirmation, and `multi_agent`/`main_agent` choices.

## 3. Drift and Authorization Safety

- [x] 3.1 Add failing tests for a selected change becoming missing, completed, archived, invalid, unready, or task-drifted while the picker is open.
- [x] 3.2 Revalidate candidate eligibility and the exact task snapshot immediately before campaign creation, requiring fresh discovery after drift and preserving exactly-once Captain kickoff.
- [x] 3.3 Add regression tests proving discovery never auto-selects a change, task scope, or mode; never searches unrelated projects/stores; and never mutates OpenSpec or reuses prior campaign authorization.

## 4. Guidance and Acceptance

- [x] 4.1 Update localized Captain-facing messages, bundled Horsepower Skill guidance, and English/Chinese documentation for discovered unfinished-change selection and failure remediation.
- [x] 4.2 Run focused OpenSpec boundary, task-inventory, campaign lifecycle, extension interaction, localization, and orchestration tests; fix only defects within this change scope.
- [x] 4.3 Run strict OpenSpec validation, typecheck, full unit/E2E suites, deterministic build/release privacy checks, `npm run check`, and `git diff --check`.
- [x] 4.4 Perform a real Pi acceptance covering multiple unfinished changes, explicit selection, task/mode confirmation, exactly-once kickoff, and fail-closed drift before side effects.
