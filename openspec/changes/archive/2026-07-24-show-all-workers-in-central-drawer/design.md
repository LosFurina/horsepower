## Context

Pi exposes centered overlay UI through `ctx.ui.custom(component, { overlay: true, overlayOptions })`; it does not expose a separately named drawer API. Horsepower currently projects parallel one-shot progress in `parallel-card.ts` and persistent workers in `worker-list.ts`, with overlapping identity, telemetry, localization, redaction, and rendering logic. Active one-shot state is closure-local, while persistent state is process-lifetime manager-owned. `/horsepower-workers` appends a persistent-only custom entry and therefore cannot show active one-shot children or provide a coherent live view.

The drawer must be observational and read-only. Worker execution, terminal truth, campaigns, handoffs, messages, and persistent lifecycle remain owned by existing modules. Pi users must not gain worker mutation controls; Captain continues to communicate through the Horsepower tool, while external CLI control remains separate.

## Goals / Non-Goals

**Goals:**

- Open a centered, responsive, scrollable worker overlay from `/horsepower-workers` in interactive TUI mode.
- Display active one-shot workers and all process-lifetime persistent workers, including idle reusable workers.
- Share one bounded worker card model and renderer between parallel Agent Cards and the drawer.
- Refresh the drawer without blocking worker execution or creating business-state authority.
- Preserve privacy, localization, ANSI/Unicode width correctness, non-TUI fallbacks, and visible empty state.
- Ship the update-summary `undefined` regression fix in the same immutable release.

**Non-Goals:**

- User steering, sending, aborting, destroying, retrying, or otherwise mutating workers from the Pi drawer.
- Persisting completed one-shot children after authoritative one-shot tool settlement.
- Replacing existing campaign, worker, message, run, handoff, or terminal stores.
- Exposing prompts, reasoning, raw provider payloads, raw tool output, private paths, reports, or credentials.
- Making drawer refresh drive campaign polling, stall authority, or Captain wake-ups.

## Decisions

### Use official centered overlay API

The command SHALL call `ctx.ui.custom()` only when `ctx.mode === "tui"`, with `overlay: true` and centered responsive options such as `width: "80%"`, `minWidth`, `maxHeight: "80%"`, and margins. Every invocation creates a fresh component. Escape and `q` close; arrow/page keys scroll; `r` refreshes the snapshot.

RPC/JSON/print modes retain bounded textual or structured output and do not attempt custom UI.

### Extract shared card model and renderer

Create a shared module containing `WorkerCardModel`, safe projection helpers, localized labels, and a width-aware themed renderer. Parallel-card event reduction and drawer inventory adaptation remain separate data-source adapters, but both render through this module. This avoids coupling the drawer to parallel-card settlement mechanics while ensuring visual fields evolve once.

The model includes safe worker kind/identity, agent/role, requested/resolved slot, model/thinking, lifecycle and dispatch status, operation/target, campaign/message/queue identity, elapsed and authoritative usage, latest bounded summary, polling/progress age, stall diagnostic, and failure/remediation.

### Add bounded active one-shot observational inventory

Introduce one process-local registry containing only safe active one-shot card models. Parallel and single/chain admission/progress replace entries by stable invocation identity. Authoritative tool settlement removes corresponding one-shot entries. The registry is bounded by task limits and byte limits, is non-persistent, and never determines terminal truth.

Persistent cards are projected on demand from `PersistentWorkerManager.list()`. Idle persistent workers remain until explicit destroy or process cleanup. Failed/canceled persistent workers follow existing manager retention semantics.

### Drawer refresh is presentation-only

The overlay component obtains snapshots through a callback. A lightweight render timer may update age/countdown fields and request a render; `r` requests an immediate snapshot. It does not poll providers, emit stall diagnostics, send messages, or mutate worker state. Component close/disposal clears timers.

### Drawer is read-only

No selected-card action invokes Horsepower operations. Worker IDs are shown for external reference, but keystrokes are limited to navigation, refresh, and close. Natural-language user input outside the drawer remains normal Pi input; only Captain may call subagent communication tools.

### Preserve fallback and empty behavior

When inventory is empty, the TUI still opens and displays zero workers. If overlay creation/rendering fails, a bounded localized notification is shown. Non-TUI modes return the same safe unified inventory in bounded form. The old durable entry renderer may remain only for compatibility during migration, but the interactive command's primary surface is the overlay.

### Update summary fix uses result-owned variables

CLI summary rendering SHALL prefer dynamic `CommandResult.summaryVariables` over static command-definition variables. Successful update/no-op text must never contain `undefined` and must reflect the actual resolved/current release identity.

## Risks / Trade-offs

- **[One-shot observational registry diverges]** → Update only from canonical orchestration progress and remove on tool settlement; never use it for authority.
- **[Drawer and parallel card visuals drift]** → Require both paths to call the same shared renderer and test parity snapshots.
- **[Long lists overflow overlay]** → Implement line-aware viewport scrolling rather than relying on Pi max-height clipping.
- **[Timers leak after close]** → Make component cleanup idempotent and test disposal/session shutdown.
- **[Fast updates create TUI churn]** → Refresh only on material snapshot change and use a modest presentation tick for derived ages.
- **[Narrow terminals]** → Use official width utilities and responsive overlay options; provide bounded fallback notification when hidden/unavailable.

## Migration Plan

1. Extract shared card model/renderer and migrate parallel cards without changing behavior.
2. Add active one-shot observational inventory and lifecycle cleanup.
3. Adapt persistent snapshots to the shared model.
4. Implement centered read-only worker overlay and command mode fallbacks.
5. Remove or de-emphasize duplicate worker-list rendering code after parity tests pass.
6. Retain the update-summary bug fix and regression test.
7. Validate in official Pi TUI manually if automated overlay input capture is unavailable, then release immutably.
