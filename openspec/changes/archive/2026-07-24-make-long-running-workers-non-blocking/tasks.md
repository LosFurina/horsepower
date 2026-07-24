## 1. Campaign Polling Authority

- [x] 1.1 Add bounded positive-integer `pollIntervalSeconds` campaign schema, default resolution to 30 seconds, persistence, confirmation, and scope digest participation.
- [x] 1.2 Add a localized `/horsepower-campaign` polling prompt before combined confirmation and reject invalid values without creating authority.
- [x] 1.3 Preserve and revalidate the exact interval through current campaign access, dispatch authorization, drift checks, and eligible automatic compaction continuation.
- [x] 1.4 Add focused campaign unit and production Pi acceptance tests for default, custom, invalid, drifted, and continued polling intervals.

## 2. Non-Blocking Dispatch Policy

- [x] 2.1 Update the bundled Horsepower Skill to require `create` plus `send(wait=false)` for long, multi-agent, externally waiting, steerable, or previously stalled campaign work while retaining explicit one-shot criteria.
- [x] 2.2 Add Captain-facing examples that keep `agent`, `workKind`, and `modelSlot` independent and use `agent="coder"` for implementation.
- [x] 2.3 Add production Pi E2E proving a qualifying campaign delegation returns after admission, leaves Captain able to process a user steering message, and does not use blocking one-shot dispatch.

## 3. Runtime-Owned Worker Observation

- [x] 3.1 Add campaign/worker/message observation metadata to existing persistent runtime state without creating a second authoritative registry.
- [x] 3.2 Implement one generation-safe process-local polling scheduler using the campaign interval and bounded manager status/telemetry reads.
- [x] 3.3 Invalidate scheduled callbacks after terminal settlement, destruction, campaign replacement, project/session replacement, shutdown, or identity drift.
- [x] 3.4 Deduplicate unchanged probes and update durable observational output only when bounded presentation materially changes.

## 4. Stall and Settlement Delivery

- [x] 4.1 Track substantive progress revisions and emit one `WORKER_PROGRESS_STALLED` episode after two consecutive unchanged polls.
- [x] 4.2 Include bounded `dispatchStatus=running`, `elapsedMs`, `lastProgressAgeMs`, and `lastOperation`, then reset the episode after new substantive progress.
- [x] 4.3 Preserve prior stall context in later failed or canceled settlement without allowing stall to change terminal truth or authorize lifecycle actions.
- [x] 4.4 Deliver controlled Captain follow-ups only for first stall, classified asynchronous failure, or terminal settlement, with user pending messages and active turns taking precedence.
- [x] 4.5 Make terminal follow-ups expose only stable bounded identities and direct Captain to existing `status`/`read` surfaces rather than embedding private reports or claiming completion.

## 5. Worker Inventory and Steering

- [x] 5.1 Extend persistent worker presentation with safe campaign identity, next poll, last substantive progress age, stall state, active message, status, and bounded telemetry.
- [x] 5.2 Make `/horsepower-workers` visibly acknowledge successful populated and empty snapshots in interactive TUI mode and provide bounded append/render fallbacks.
- [x] 5.3 Ensure periodic observation does not block `status`, `read`, `steer`, `abort`, or `destroy`, and require explicit `workerId` selection for ambiguous natural-language steering.
- [x] 5.4 Add focused renderer, command, lifecycle, steering, empty-list, and privacy-bound tests.

## 6. Verification and Release Safety

- [x] 6.1 Add deterministic fake-timer unit tests for interval validation, two-poll stall behavior, progress reset, deduplication, stale timer invalidation, and shutdown cleanup.
- [x] 6.2 Add integration tests for parallel persistent admission, partial admission failure, independent settlement, pending-message races, session/project replacement, and compaction continuation without recreation or resend.
- [x] 6.3 Run typecheck, build, focused and full tests justified by the changed runtime scope, production Pi E2E, strict OpenSpec validation, git diff checks, and release privacy/manifest scans.
