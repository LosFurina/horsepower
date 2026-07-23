## 1. Performance Regression Loop

- [x] 1.1 Add a deterministic RED boundary test proving one discovery operation invokes OpenSpec installation/version/project validation only once for multiple candidates.
- [x] 1.2 Add controlled-delay RED tests proving candidate inspections use no more than four concurrent slots, preserve official order despite out-of-order settlement, and select fatal diagnostics in official order.
- [x] 1.3 Add a real Pi latency harness that fails when a bounded multi-change changes picker exceeds the documented acceptance budget and records installed release identity.

## 2. Operation-Local Validation Context

- [x] 2.1 Refactor OpenSpec installation/project validation into an operation-local verified context that candidate inspection can reuse without any cross-operation cache.
- [x] 2.2 Refactor task inventory loading so discovery can use the verified context while authorization and confirmation-time revalidation continue to perform fresh validation.
- [x] 2.3 Add regression tests proving separate discovery calls and campaign confirmation do not reuse prior authorization or stale project/task facts.

## 3. Bounded Candidate Inspection

- [x] 3.1 Implement a fixed four-slot candidate inspection scheduler with candidate-count admission before process creation.
- [x] 3.2 Aggregate indexed candidate outcomes in official order, retaining skippable missing/unready handling and deterministic fail-closed strict-invalid/malformed/timeout/truncation behavior.
- [x] 3.3 Verify command counts, maximum in-flight work, official-order output, privacy bounds, zero/one/multiple candidates, and no campaign/run/worker/handoff side effects on failure.

## 4. Verification and Release

- [x] 4.1 Run focused OpenSpec discovery, boundary, CLI runner, extension interaction, and campaign drift suites.
- [x] 4.2 Run strict OpenSpec validation, typecheck, full unit/E2E suites, deterministic release/privacy checks, `npm run check`, and `git diff --check`.
- [x] 4.3 Build and immutably install the next alpha release without changing prior version trees, then run fresh official Pi latency acceptance against the installed extension.
