## Context

Horsepower currently offers synchronous one-shot dispatch and reusable persistent workers. Captain has typically used one-shot `single`/`parallel` for implementation and test delegation because it closes in one call, but the Pi tool call remains pending until settlement. During that interval Captain cannot perform its own status checks, and active one-shot children do not appear in `/horsepower-workers`. The existing 30-second card stall projection only evaluates when a new event arrives, so it is not an independent heartbeat.

Campaign authority already owns exact change/task/check/mode/testing guidance. Persistent worker, message, run, handoff, and terminal stores already own execution facts and must remain authoritative. New polling behavior must be bounded, privacy-safe, observational, compatible with pending user messages and automatic compaction, and must not duplicate terminal or campaign authority.

## Goals / Non-Goals

**Goals:**

- Prompt once per campaign for a positive-integer polling interval in seconds, with 30 seconds as the accepted default.
- Make potentially long, multi-agent, externally waiting, or user-steerable work non-blocking through persistent workers.
- Keep one-shot execution available for demonstrably short, bounded, non-steerable work.
- Let Horsepower, rather than the model, own periodic timers and bounded probes.
- Provide visible active-worker inventory and reliable stall/terminal notifications without reversing terminal truth.
- Preserve user-message priority and exact campaign authorization across asynchronous and compaction boundaries.

**Non-Goals:**

- Removing one-shot dispatch.
- Making every persistent worker wake Captain on every poll.
- Creating another worker, campaign, task, evidence, or terminal registry.
- Automatically restarting, canceling, destroying, completing, or steering a stalled worker.
- Treating observational stall as business failure.

## Decisions

### Campaign polling interval is immutable execution authority

`pollIntervalSeconds` SHALL be a positive integer entered before combined campaign confirmation. An empty/default acceptance resolves to `30`. It participates in the campaign scope digest and confirmation summary. Selected campaign continuation reuses the exact value; changing it requires new campaign authorization.

A broad implementation safety bound may protect timers and numeric storage, but the user-facing contract is “positive integer seconds” rather than a narrow product range.

### Persistent execution is required by explicit risk criteria

The bundled Skill and Captain instructions SHALL require `create` followed by `send(wait=false)` when any of these apply: work is expected to exceed one polling interval, uses multiple implementation/test/review agents, waits on external processes or networks, is likely to need user steering, or previously stalled. One-shot remains permitted only for short, bounded, non-steerable work.

This is policy rather than slot inference: `agent`, `workKind`, and `modelSlot` remain independently explicit.

### Runtime timers own observation

The extension runtime SHALL maintain one process-local timer schedule for active campaign-associated persistent messages. At each interval it reads existing manager state and bounded telemetry. The model does not schedule sleeps or hold an open tool call merely to poll.

Timer callbacks use generation tokens and worker/message/campaign identity so stale callbacks after terminal settlement, destruction, campaign replacement, project/session replacement, or shutdown become no-ops.

### Two unchanged polls produce a soft stall

A substantive progress revision advances on meaningful assistant/tool/usage/protocol progress, not on polling itself. Two consecutive polls with no revision change produce one deduplicated `WORKER_PROGRESS_STALLED` diagnostic containing bounded `elapsedMs`, `lastProgressAgeMs`, and `lastOperation`. New substantive progress clears the consecutive count and allows a later independent stall episode.

Stall never changes `running` status and never authorizes cancellation, destruction, retry, completion, or verification.

### Durable observations and Captain wake-ups are separate

Every materially changed probe may replace or append a bounded TUI-only worker observation using existing durable entry facilities. Routine unchanged polls do not start LLM turns. Horsepower sends a controlled Captain follow-up only for first stall in an episode, classified asynchronous failure, or terminal settlement. Pending user messages, active turns, project/session replacement, and stale campaign authority suppress or defer automatic follow-up.

### Persistent settlement remains inspectable

`create` and `send(wait=false)` return admission identities immediately. Background failure or completion remains in existing worker/message/run/handoff state. A terminal follow-up carries only bounded stable identities and tells Captain to inspect through existing `status`/`read`; it does not embed private reports or claim task completion.

### Worker list becomes visibly useful

`/horsepower-workers` continues to list process-lifetime persistent workers, not one-shot children. It SHALL visibly acknowledge successful invocation even when empty, and display campaign correlation, active message, status, next poll, last substantive progress age, stall state, and bounded telemetry when available. Rendering failure gets a bounded fallback notification. The command remains a snapshot, while runtime observation entries may update independently.

## Risks / Trade-offs

- **[Timer and entry noise]** → Deduplicate unchanged polls, cap active observations, and wake Captain only for actionable boundaries.
- **[False stalls during long silent tools]** → Require two consecutive unchanged probes and keep stall explicitly observational.
- **[Stale asynchronous callbacks]** → Revalidate generation, worker/message, campaign, project/session, pending-message, and terminal state before delivery.
- **[Persistent worker leakage]** → Preserve explicit destroy/process cleanup and expose idle/terminal workers clearly; do not silently destroy reusable workers.
- **[Users choose extreme intervals]** → Validate positive safe integers and apply only a broad technical timer bound, with clear remediation rather than silent coercion.
- **[Captain policy remains probabilistic]** → Encode mandatory criteria and concrete examples in the bundled Skill and exercise them in production Pi tests.

## Migration Plan

1. Extend campaign schema, confirmation, digest, persistence, and continuation with `pollIntervalSeconds`, defaulting legacy in-process absence only where explicitly compatible.
2. Add persistent observation metadata and generation-safe scheduler without changing one-shot behavior.
3. Add durable worker observation and terminal/stall follow-up arbitration.
4. Improve `/horsepower-workers` success feedback and fields.
5. Update Skill, locale, unit, integration, and production Pi E2E coverage.
6. Release immutably; rollback by restoring the previous installed version symlink. Existing persistent workers remain governed by process lifetime and are not migrated across restart.
