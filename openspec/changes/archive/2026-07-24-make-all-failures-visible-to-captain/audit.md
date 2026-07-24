# Classified failure audit (tasks 1.1–1.4)

This foundational audit inventories the principal failure mechanisms and assigns the projection class used by the shared contract. Detailed migration of individual boundaries remains in later tasks.

| Surface | Mechanism | Classification | Existing authority / required projection |
| --- | --- | --- | --- |
| Extension/tool handlers | thrown validation and execution errors | blocking | structured tool result |
| One-shot/orchestration batches | `Promise.allSettled`, child reports | composite-child | ordered child outcomes; parent fails |
| Persistent workers | process/RPC/message settlement | asynchronous-settlement | worker/message status and event stream |
| Run lifecycle | terminalization and cleanup | blocking / observational cleanup | run terminal truth plus secondary diagnostic |
| Handoffs | managed write/report/terminalization | blocking / observational cleanup | handoff identity and bounded cause |
| Webhooks | transport, receiver, retry exhaustion | observational-degradation | delivery evidence; never changes business truth |
| TUI/progress/localization | renderer/callback/locale fallback | observational-degradation | bounded diagnostic, no recursive retry |
| CLI/setup/configuration | parse, read/write, compatibility | blocking | command result with remediation |
| Updater/release | verification, activation, rollback | blocking | truthful installation state and primary cause |
| OpenSpec/campaign/review/verification | authorization, drift, evidence | blocking | existing change/campaign/evidence identity |
| Optional configuration/telemetry | absent optional input | expected-absence | silent only where contract declares absence valid |

The shared module `src/failures/captain-failure.ts` is the single normalization boundary for Captain-facing data. It allowlists fields, normalizes control characters, redacts credential-shaped values and private paths, applies UTF-8 field/aggregate bounds, and projects composite primary failures by canonical input order. Raw exception objects and unrestricted output do not cross this boundary.
