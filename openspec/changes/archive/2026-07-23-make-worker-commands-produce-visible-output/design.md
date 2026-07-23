## Context

The persistent manager already returns deterministic `WorkerSummary[]` data containing stable worker identity, process-lifetime status, active/queued message correlation, and bounded telemetry. The `/horsepower-workers` command currently calls the safe runtime `list` action, serializes the result, sends it through `ctx.ui.notify`, and returns `void`.

Pi documents `ui.notify` as a notification surface. Durable TUI-only content that must not enter LLM context is instead represented by `pi.appendEntry(customType, data)` plus `pi.registerEntryRenderer(customType, renderer)`. This distinction explains why the command can appear silent or disappear even though the runtime list succeeds.

One-shot `single`, `parallel`, and `chain` children are intentionally terminal child processes, while `/horsepower-workers` is a view of reusable process-lifetime workers created by `create`. The UI needs to state this boundary explicitly.

## Goals / Non-Goals

**Goals:**

- Make every `/horsepower-workers` invocation visibly and durably produce a result in Pi TUI.
- Give empty lists a clear localized explanation.
- Show complete bounded persistent-worker identity, state, message correlation, and available telemetry.
- Keep output TUI-only and outside model context.
- Make runtime and presentation failure visible without changing workers.
- Exercise real Pi command behavior and preserve the structured `list` tool action.

**Non-Goals:**

- Retain or display one-shot execution history as persistent workers.
- Fix parallel child-card replacement; that belongs to `render-stable-cards-for-parallel-agents`.
- Persist worker processes across Pi host-process termination.
- Add worker creation, abort, destroy, or send controls to the list card.
- Expose raw event streams, prompts, reports, message bodies, private paths, or credentials.
- Store worker-list entries as planning, lifecycle, usage, or terminal authority.

## Decisions

### 1. Append a TUI-only custom entry for every successful command

The extension will register a stable custom entry type such as `horsepower-worker-list` and its renderer at extension load. `/horsepower-workers` will call runtime `list`, project the result into a bounded presentation DTO, and append that DTO using `pi.appendEntry`. This places the result in the transcript without sending it to the LLM.

Alternative: call `pi.sendMessage({ display: true })`. Rejected because custom messages participate in LLM context and a status/list command should not consume model context or trigger behavior.

Alternative: continue using `ui.notify`. Rejected because notifications are transient and are the current user-visible defect.

### 2. Store only a bounded presentation snapshot in the entry

The custom entry contains a localized output locale, observation timestamp or relative snapshot metadata as appropriate, an explicit persistent-only scope marker, and up to the existing eight projected worker summaries. It does not retain raw runtime results. Projection reuses the existing privacy-safe latest utterance and telemetry semantics and applies deterministic field/aggregate bounds before append.

This is historical presentation of what the command observed, not a live widget. Re-running the command appends a new snapshot; it does not mutate prior transcript entries or become runtime truth.

Alternative: install a live widget above the editor. Rejected because a widget can still disappear on session/UI changes and introduces subscriptions/lifecycle complexity not needed for an explicit command result.

### 3. Register a compact custom entry renderer

The renderer displays a localized title and persistent-only explanation, then either an explicit empty state or one compact section per worker. Expanded mode may reveal additional already-bounded identity and telemetry fields; collapsed mode must still show every worker ID/name/status. Both are derived solely from the stored safe DTO.

Renderer exceptions are caught at the extension boundary where supported. The stored DTO remains valid even if styling/rendering fails; a minimal textual fallback is preferred. No renderer may query runtime, append another entry, or mutate state.

### 4. Keep one-shot history out of the persistent list

The empty state and scope label explicitly state that only `create` workers in the current Pi process are listed and that terminal `single`, `parallel`, and `chain` children are not persistent workers. This corrects interpretation without inventing a one-shot history registry.

A future one-shot run-history command would require its own lifecycle/storage contract and is out of scope.

### 5. Localize prose while preserving machine identity

The command resolves effective `en` or `zh-CN` before projection. Headings, empty text, scope explanation, and errors are localized; IDs, statuses, slots, models, thinking levels, modes, and command names stay stable. Locale failure falls back to English and remains visible.

### 6. Fail visibly without disturbing runtime

If runtime `list` fails, the handler sends a bounded localized error notification because there is no trustworthy snapshot to append. If `appendEntry` fails, it sends an explicit fallback notification stating durable output failed. Neither path retries indefinitely or changes worker state. Rendering errors produce minimal safe fallback output where Pi's renderer API permits.

### 7. Test the actual command and transcript entry path

Unit tests assert that the handler invokes only safe `list`, appends exactly one bounded custom entry on success, appends an explicit empty snapshot, uses notification only for failure fallback, and does not call `sendMessage`. Renderer tests cover eight workers, localization, expanded/collapsed output, privacy, and bounds.

Real Pi E2E will invoke the supported command path in TUI or the closest official RPC command-execution seam and inspect the resulting custom entry/rendered output. Existing command-enumeration tests alone are insufficient because they cannot catch a silent handler.

## Risks / Trade-offs

- **[Every invocation adds a transcript entry]** → This is intentional durable command output; each bounded snapshot is user-requested and TUI-only.
- **[Custom entry APIs differ by Pi version]** → Use the supported Pi compatibility range and packaged E2E; fail explicitly if unavailable.
- **[Historical snapshot becomes stale]** → Label it as an observed snapshot and require rerunning the command for current state.
- **[Eight detailed workers create tall output]** → Use compact collapsed rendering and bounded expanded fields while retaining every identity.
- **[Latest utterance was already normalized but future fields regress]** → Project through an explicit allowlist and rerun privacy fixtures against source and packaged artifacts.
- **[RPC cannot render TUI entries]** → Preserve the structured tool `list` action and emit an explicit mode-appropriate outcome rather than claiming a TUI render occurred.

## Migration Plan

1. Add RED handler, projection, renderer, empty-state, failure, localization, privacy, and real-Pi tests.
2. Introduce the bounded presentation DTO and TUI-only entry renderer.
3. Change `/horsepower-workers` from notification-only success to durable entry append with explicit failure fallback.
4. Update English/Chinese documentation to distinguish persistent workers from one-shot children.
5. Build a new immutable alpha release and manually verify empty and populated command output across subsequent renders.

Rollback restores the notification-only command. Stored custom entries remain inert transcript data and no worker/configuration migration is needed.

## Open Questions

None. The implementation must use the official Pi custom-entry API available in the supported compatibility range and must not send worker-list content into model context.
