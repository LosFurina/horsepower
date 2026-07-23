## 1. Continuation State and Authority

- [ ] 1.1 Add failing implementation-campaign tests for a bounded process-local continuation lease containing exact campaign/change/task/mode/inventory identity and invalidation on switch, end, explicit pause/block/terminal state, project/session replacement, and duplicate generation.
- [ ] 1.2 Implement continuation lease lifecycle without storing duplicate OpenSpec task facts or restoring authorization across Pi process restart.
- [ ] 1.3 Add failing OpenSpec-boundary tests proving post-compaction continuation revalidates exact selected order, description, section, pending state, inventory digest, apply readiness, strict validity, project ownership, and supported CLI version.
- [ ] 1.4 Implement pre-continuation OpenSpec revalidation while preserving existing dispatch-time revalidation and fail-closed no-side-effect behavior.

## 2. Pi Compaction Lifecycle

- [ ] 2.1 Add failing extension tests covering `session_before_compact`, successful `session_compact`, `reason=threshold|overflow|manual`, `willRetry`, `agent_settled`, `ctx.isIdle`, `ctx.hasPendingMessages`, repeated hooks, and event-order permutations.
- [ ] 2.2 Implement exactly-once automatic continuation for successful threshold/overflow compaction only when Pi will not retry, no continuation is pending, and the same campaign remains eligible.
- [ ] 2.3 Add regression tests proving manual, failed, aborted, switched, ended, paused, blocked, terminal, drifted, duplicate, and Pi-native-retry cases enqueue no Horsepower continuation and create no worker/run/handoff/budget side effect.
- [ ] 2.4 Add bounded localized continuation/stop notices and a private follow-up payload containing only stable campaign ID, change ID, exact task IDs, mode, and current-context guidance.

## 3. Integration and Acceptance

- [ ] 3.1 Update the bundled Horsepower Skill and English/Chinese documentation: an active eligible campaign continues automatically after auto-compaction, users do not type `go`, manual compaction does not imply continuation, and scope/mode never change.
- [ ] 3.2 Add real Pi E2E fixtures for threshold compaction without retry, overflow compaction with native retry, repeated auto-compaction, and scope drift; assert exactly one continuation and no duplicate kickoff.
- [ ] 3.3 Run focused campaign, OpenSpec boundary, extension/runtime, lifecycle, localization, and real Pi compaction tests; then run strict OpenSpec validation, CI-version `npm ci`, typecheck, full unit/E2E suites, deterministic build/release privacy scans, `npm run check`, and `git diff --check`.
- [ ] 3.4 Build and install a new immutable alpha release, start a fresh user-selected campaign, force automatic compaction during active work, and verify execution continues without `go`, retains exact scope/mode, reaches truthful managed terminal evidence, and leaves no duplicate dispatch or orphan.
