## Why

`/horsepower-workers` currently writes a persistent-worker-only session entry, while active one-shot workers exist only inside transient parallel cards. Users cannot get one coherent, visible overview, and Agent Card information/style is duplicated across independent renderers that drift when changed.

## What Changes

- Replace the interactive TUI behavior of `/horsepower-workers` with a centered Pi overlay drawer using the official `ctx.ui.custom(..., { overlay: true })` API.
- Show all active one-shot workers and all process-lifetime persistent workers, including reusable `idle` workers; remove active one-shot entries after authoritative tool settlement and persistent entries only after `destroy` or process cleanup.
- Make the drawer read-only in Pi: users can scroll, refresh, and close, but cannot send, steer, abort, destroy, or mutate workers from the drawer.
- Preserve Captain-only subagent communication through Horsepower tools; external CLI control remains outside the Pi drawer.
- Extract a shared bounded `WorkerCardModel` and renderer used by both parallel Agent Cards and drawer cards, so identity, status, operation, slot/model/thinking, telemetry, progress, stall, failure, localization, privacy, and width behavior change in one place.
- Add a bounded process-local observational projection for active one-shot workers without creating new execution or terminal authority.
- Keep explicit non-TUI RPC/JSON/print fallback behavior and visible empty-inventory output.
- Include the already-fixed `horsepower update` human-readable summary bug in the next immutable release, with regression coverage preventing `undefined` version output.

## Capabilities

### New Capabilities

- `worker-drawer`: Defines the centered read-only worker overlay, unified inventory, interaction, refresh, lifecycle, and fallback behavior.
- `shared-worker-card`: Defines the shared worker card view model and rendering contract for parallel cards and the worker drawer.

### Modified Capabilities

- `persistent-workers`: Expands worker presentation from persistent-only session entries to a unified drawer that retains idle persistent workers and includes active one-shot workers.
- `explicit-dispatch`: Makes admitted active one-shot identities available to the bounded observational inventory while preserving existing execution authority.
- `github-release-installation`: Corrects localized update success summaries to use the actual resolved release version.

## Impact

Affected areas include parallel progress projection, persistent worker presentation, extension command UI, process-local observational state, Pi overlay components, localization, width-aware TUI rendering, tests, release privacy fixtures, and CLI update summary rendering. No user-facing Pi worker mutation controls and no new authoritative worker, campaign, handoff, or terminal store are introduced.
