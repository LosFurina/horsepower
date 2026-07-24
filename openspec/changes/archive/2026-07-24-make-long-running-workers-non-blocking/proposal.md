## Why

Long-running `single`, `parallel`, and `chain` dispatches currently keep Captain blocked until settlement, prevent timely user steering, and remain absent from `/horsepower-workers`. Existing stall projection is event-driven rather than a real periodic probe, so a silent worker can remain invisible indefinitely.

## What Changes

- Add an immutable positive-integer worker polling interval to every implementation campaign, prompted once before confirmation and defaulted to 30 seconds when the user accepts the default.
- Require long-running, multi-agent, externally waiting, or steerable campaign work to use non-blocking persistent workers while retaining one-shot dispatch for genuinely short, bounded, non-steerable work.
- Separate worker admission, background settlement, observation, and terminal delivery so Captain regains control after `create` plus `send(wait=false)`.
- Add runtime-owned periodic worker probing; it does not rely on the model remembering to wake itself.
- Treat two consecutive polls without substantive progress as a bounded observational `WORKER_PROGRESS_STALLED` diagnostic without changing terminal truth.
- Wake Captain only for terminal settlement, classified asynchronous failure, or stall requiring attention; routine progress updates remain bounded durable TUI observations, and pending user messages win delivery races.
- Make `/horsepower-workers` always provide visible success feedback and show active persistent campaign workers with campaign identity, status, next poll, last substantive progress age, and bounded telemetry.
- Preserve the confirmed polling interval and worker observation identity across eligible automatic compaction continuation without recreating workers or resending work.

## Capabilities

### New Capabilities

- `non-blocking-worker-observation`: Defines campaign polling configuration, background persistent-worker observation, stall detection, wake-up arbitration, and steerable non-blocking settlement.

### Modified Capabilities

- `explicit-dispatch`: Defines when campaign work must use persistent non-blocking execution and when one-shot execution remains permitted.
- `persistent-workers`: Extends persistent worker inventory, campaign correlation, probing, steering, and durable presentation requirements.
- `openspec-execution-boundary`: Adds polling interval to exact campaign authority and automatic-continuation revalidation.

## Impact

Affected areas include campaign prompting and immutable snapshots, extension commands and lifecycle hooks, orchestration policy, persistent worker state, progress telemetry, durable TUI entries, automatic compaction continuation, bundled Skill guidance, localization, and production Pi tests. No new planning registry or terminal authority is introduced; existing campaign, worker, message, run, handoff, and terminal owners remain authoritative.
