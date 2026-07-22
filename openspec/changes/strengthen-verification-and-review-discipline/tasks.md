## 1. Verification Manifest Contract

- [ ] 1.1 Add failing schema and lifecycle tests for bounded command evidence, stable evidence IDs, UTC observation timestamps, acceptance mappings, current-scope reconciliation, and concrete mapped E2E waivers.
- [ ] 1.2 Add failing tests proving stale, future-skewed, pre-run, failed, missing, partial, scope-drifted, legacy-unmapped, and worker-report-only evidence cannot report `completed`, while non-complete terminal states remain compatible.
- [ ] 1.3 Implement the shared fresh-evidence validator with injected clock, bounded freshness/skew constants, evidence-reference integrity, exact result handling, and machine-stable diagnostics.
- [ ] 1.4 Extend the OpenSpec boundary to produce and validate a current acceptance snapshot for the active change and task scope without creating a parallel planning or verification store.
- [ ] 1.5 Replace the `report_terminal` completion payload and verification gate with the claim-matched manifest, preserving explicit mapped waiver behavior and process-local terminal lifecycle semantics.

## 2. Review Finding Adjudication

- [ ] 2.1 Add failing review-campaign tests for pending findings; Captain-only accepted, rejected, needs-clarification, and blocked-needs-human dispositions; bounded rationale/evidence; duplicate occurrence preservation; and cross-project/change/campaign rejection.
- [ ] 2.2 Implement review finding disposition state and orchestration actions without consuming budget, dispatching work, or allowing workers and reviewer verdicts to set authority.
- [ ] 2.3 Add failing tests for accepted-open finding resolution using fresh targeted evidence and for rejection of stale, failed, missing, mismatched, worker-report-only, invalid-transition, and already-resolved attempts.
- [ ] 2.4 Implement evidence-backed finding resolution through the shared validator, retaining bounded process-local timestamps and root-cause correlation.
- [ ] 2.5 Gate `end_review_campaign(outcome: "accepted")` on every in-scope finding being technically rejected with rationale or accepted and resolved, while preserving truthful non-accepted outcomes.

## 3. Corrective Dispatch Authority

- [ ] 3.1 Add failing implementation-campaign and orchestration tests requiring each `fix` dispatch in a review campaign to name one accepted unresolved in-scope `reviewFindingRootCauseId` before budget consumption.
- [ ] 3.2 Implement corrective-dispatch correlation across project, change, implementation campaign, review campaign, fixed acceptance scope, and root cause; reject pending, rejected, unclear, blocked, out-of-scope, resolved, unknown, or cross-campaign findings.
- [ ] 3.3 Add regression tests proving reviewer verdicts, recommendations, duplicate examples, finding disposition, resolution, and campaign acceptance never auto-dispatch a fixer/reviewer or auto-extend/reset budget.

## 4. Captain Interface and Compatibility

- [ ] 4.1 Update the public tool schema, extension/runtime wiring, TypeScript types, and localized Captain-facing errors/status for verification manifests, finding disposition/resolution, and corrective root-cause correlation while preserving stable machine fields.
- [ ] 4.2 Update the bundled Horsepower Skill guidance so the Captain runs and reads fresh full verification, reconciles claims, independently checks worker/reviewer output, technically evaluates feedback, and never treats confidence or performative agreement as evidence.
- [ ] 4.3 Update English and Chinese READMEs, CLI/tool examples, project metadata, webhook evidence handling, release fixtures, deterministic archive expectations, and privacy/size bounds for the breaking completion payload.
- [ ] 4.4 Add migration-oriented tests and documentation proving legacy bare `e2e`/`e2eWaiver` completion payloads fail closed with an actionable replacement shape while `failed`, `canceled`, and `blocked_needs_human` remain usable.

## 5. Verification and Acceptance

- [ ] 5.1 Run focused lifecycle, OpenSpec-boundary, review-campaign, implementation-campaign, orchestration, extension, localization, webhook, and schema tests and fix only defects within this change scope.
- [ ] 5.2 Run `openspec validate --change strengthen-verification-and-review-discipline`, typecheck, full tests, deterministic build/release checks, and the repository's complete `npm run check` gate.
- [ ] 5.3 Conduct bounded implementation and specification reviews through a Horsepower review campaign; disposition every in-scope finding, correlate any corrective dispatch to an accepted root cause, and resolve accepted findings with fresh targeted evidence within budget.
- [ ] 5.4 Run a fresh Captain-selected successful E2E command covering claim-matched completion and adjudicated review closure, then submit the Horsepower terminal report with current acceptance mapping, exact command results, timestamps, summaries, and evidence references.
