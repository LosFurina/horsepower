## Context

Horsepower has two worker execution paths. One-shot workers normalize bounded Pi JSON events through `one-shot-runner.ts`; persistent workers retain an RPC process and expose message-correlated status/read/send operations through `persistent-manager.ts`. The extension converts normalized progress into Pi partial tool results and stable operation cards.

The runtime already accumulates final one-shot input/output usage and emits bounded assistant summaries, but elapsed time and usage are not carried as live card snapshots. Persistent `send(wait: false)` is intended to be asynchronous, yet the public contract does not require prompt acknowledgement before completion and existing fast-worker tests cannot prove that the Captain remains free while a long turn runs. The latest worker utterance is available only as event data and is not consistently projected into the stable card.

Progress remains observational and privacy-sensitive. It cannot expose prompts, reasoning, raw provider events, unrestricted tool output, private handoff paths, credentials, or full reports, and rendering failure cannot change execution or terminal truth.

## Goals / Non-Goals

**Goals:**

- Prove that persistent `create` acknowledges worker/message admission and that `send(wait: false)` / `steer(wait: false)` acknowledge a message promptly without awaiting worker completion.
- Preserve structured, orphan-free terminal truth when a human presses `Esc` to cancel a blocking one-shot wait.
- Preserve one worker identity and conversation across idle periods and multiple follow-ups until explicit destroy or process cleanup.
- Present monotonic elapsed time, aggregate input/output token counts, and the latest privacy-safe worker utterance on stable one-shot and persistent operation cards.
- Keep telemetry bounded, ordered, normalized, redacted, deterministic in tests, and non-authoritative.
- Cover slow-worker concurrency, reuse, terminal settlement, privacy, and real Pi rendering.

**Non-Goals:**

- Stream model reasoning, raw provider payloads, full prompts, full reports, unrestricted tool output, or complete conversation history.
- Estimate tokens when Pi does not report usage, translate stable usage fields, or infer provider-specific accounting.
- Keep workers alive across host Pi process termination or restore conversations from retained handoffs.
- Change model-slot selection, OpenSpec authority, campaign authorization, managed handoff semantics, or terminal status rules.

## Decisions

### 1. Make non-blocking acknowledgement a distinct result

Persistent `create` returns after the worker process and initial message are accepted and exposes `workerId`, `messageId`, message status, and worker status; it does not await the initial turn's completion. Likewise, for `wait: false`, persistent delivery returns after Pi accepts/queues the message and exposes stable identity without invoking the message-completion waiter. Completion remains discoverable through `status`, cursor-based `read`, or a later waited operation. A deterministic deferred worker fixture will hold a turn open while the test proves the caller regains control and can execute unrelated Captain work.

A fast worker may finish before the acknowledgement is rendered; in that race, the returned snapshot may already say `completed`, but implementation must not intentionally await completion. Tests therefore use a controlled unresolved turn rather than wall-clock timing alone.

Alternative: always return an acknowledgement even when completion is synchronously known. Rejected because returning a truthful completed snapshot is useful; the normative property is no completion wait, not forced stale status.

### 2. Project one bounded telemetry snapshot onto every card

Introduce a normalized observational snapshot containing:

- `elapsedMs`: non-negative monotonic duration from dispatch/message acceptance to observation or terminal settlement;
- optional `usage.input` and `usage.output`: non-negative finite integer totals reported by Pi for the current dispatch/message;
- optional `latestAssistantSummary`: the newest eligible normalized assistant utterance.

The runtime attaches snapshots to progress events and terminal results without changing identity or terminal fields. Cards render fixed labels and omit unavailable token counts rather than displaying guessed zeroes. Elapsed time is formatted for humans while raw bounded milliseconds remain in structured details.

Alternative: let the extension calculate elapsed time and usage from arbitrary raw events. Rejected because it duplicates execution state, cannot cover persistent status/read consistently, and weakens privacy normalization.

### 3. Treat latest utterance as a replaceable snapshot, not a transcript

Only the latest completed assistant text segment is retained for card projection. It passes the existing credential/path/control-character normalization, receives a tighter UTF-8-safe display bound, and replaces the prior utterance. It consumes the existing aggregate progress event/byte budget and is never appended into an unbounded transcript.

Tool targets remain separately normalized operation data. Reasoning deltas, incomplete text deltas, user messages, system prompts, provider metadata, full reports, and raw tool results are ineligible.

Alternative: show raw streaming deltas. Rejected because partial text is unstable, high-churn, harder to redact safely, and can reveal transient secrets that the completed normalized projection would suppress.

### 4. Aggregate usage only from authoritative Pi usage records

Input/output totals are summed from eligible assistant completion usage records for one dispatch/message. Missing values remain absent. Values must be finite non-negative safe integers and are bounded before public projection. Provider cost and identifiers are not added to the card. Persistent aggregation resets at each substantive message so one follow-up does not inherit prior message tokens; worker lifetime totals may remain internal unless separately specified later.

Alternative: show cumulative lifetime usage. Rejected because users asked for execution-card traffic and lifetime totals make later follow-ups misleading.

### 5. Human cancellation has explicit terminal truth

When a human presses `Esc` while Captain is blocked on a one-shot dispatch, Horsepower propagates cancellation to the admitted run, records structured `canceled` identity, and finishes managed handoff state without accepting an absent report. Tests hold a worker unresolved, cancel the public wait, and prove no active child/run remains hidden. Partial repository edits remain ordinary untrusted working-tree state and require Captain inspection.

### 6. Rendering and telemetry failures remain observational

Clock, usage, utterance normalization, callback, and card rendering failures are caught at the progress boundary. They may omit telemetry but SHALL NOT abort a child, settle a message, validate a handoff, change a run result, or destroy a persistent worker. Terminal truth continues to come from execution and managed-report validation.

## Risks / Trade-offs

- **[Provider events may report usage differently]** → Accept only normalized Pi numeric input/output fields and leave unavailable values absent.
- **[A latest utterance can still contain sensitive prose]** → Apply credential and path redaction before a small UTF-8-safe bound; exclude raw deltas, reasoning, prompts, and reports.
- **[Frequent elapsed updates can create churn]** → Update on existing meaningful progress events and optional bounded timer ticks only; preserve aggregate event/byte limits.
- **[Wall-clock tests can be flaky]** → Inject clocks and deferred completion primitives; use real Pi E2E only for integration evidence, not timing thresholds.
- **[Persistent and one-shot paths may drift]** → Share normalized telemetry types/helpers and contract tests, while retaining separate lifecycle ownership.
- **[A fast turn can complete before non-blocking acknowledgement returns]** → Assert absence of completion waiting with a controlled pending turn rather than requiring a running status in every race.
- **[Esc cancellation races worker completion]** → Preserve the first authoritative terminal settlement, correlate it to run/message identity, and validate any managed report only when actually present.

## Migration Plan

1. Add failing persistent-manager/facade tests for controlled non-blocking delivery, Captain concurrency, session reuse, and explicit destruction.
2. Add failing runner/progress/extension tests for elapsed time, per-message token aggregation, latest utterance redaction, bounds, and observational failures.
3. Implement shared normalized telemetry and persistent message snapshots without changing terminal authority.
4. Update operation-card rendering, bundled Skill, English/Chinese docs, fixtures, and public privacy tests.
5. Run focused tests, full checks, real Pi E2E, strict OpenSpec validation, deterministic release checks, and an installed-release manual smoke.

Rollback restores the previous immutable release. Persistent state is process-local and no durable migration is required; retained managed handoffs remain compatible.

## Open Questions

None. Token fields are omitted when unavailable, usage is per dispatch/message, and only the latest completed privacy-safe assistant utterance is displayed.
