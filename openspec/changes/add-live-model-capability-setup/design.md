## Context

Horsepower stores explicit model/thinking bindings for capability slots. CLI configuration currently accepts typed identifiers and runtime model validation maps Pi's boolean `reasoning` field to all Horsepower thinking levels. That mapping is not evidence that an upstream provider accepts each exact value, and provider support can change after setup.

The solution crosses installer, CLI, Pi integration, slot resolution, worker launch, localization, and tests. It must not expose credentials, silently alter user intent, or turn temporary provider failures into false capability claims.

## Goals / Non-Goals

**Goals:**
- Guide users through current Pi-visible models for all required slots.
- Establish support for each selected exact model/thinking combination against the current upstream when exact authoritative metadata is unavailable.
- Revalidate capability evidence close to worker creation and react safely to upstream changes.
- Keep setup atomic and distinguish unsupported from inconclusive failures.
- Keep probe content, output, credentials, and evidence bounded and private.

**Non-Goals:**
- Benchmarking model quality, latency, context limits, or cost.
- Probing every level of every model in advance.
- Persisting a durable global capability database or background monitoring daemon.
- Silently mapping provider-specific thinking names, lowering thinking, changing models, or selecting slots on the user's behalf.
- Calling real paid providers from automated tests.

## Decisions

### 1. Separate discovery, declared evidence, and live evidence

A model catalog adapter will produce stable provider/model IDs and a non-secret revision. Exact thinking support may come from authoritative enumerated metadata when Pi exposes it. The existing `reasoning` boolean only indicates that some reasoning mode exists and never expands to all levels.

When exact support is absent, a `ModelCapabilityProbe` interface will test one selected combination. This keeps setup and dispatch independent of provider-specific implementations and permits deterministic local fixtures.

**Alternative considered:** derive all levels from `reasoning`. Rejected because it is the current false-positive source.

### 2. Probe only the exact selected combination

Interactive setup lists current models and canonical Horsepower thinking identifiers, then probes the user's chosen pair. Unsupported users reselect; inconclusive users may retry, reselect, skip, or cancel. Horsepower does not fan out seven probes per model because that can create avoidable latency, quota use, and cost.

The default production probe launches Pi with the exact model and thinking under `--no-session --no-skills --no-tools`, a fixed minimal prompt, bounded output, and no shell. Probe output is discarded except for bounded classified evidence.

**Alternative considered:** enumerate every model/level pair. Rejected as expensive and potentially abusive to upstream accounts.

### 3. Classify outcomes conservatively

Probe results are `supported`, `unsupported`, or `inconclusive`. Only successful completion establishes support. `unsupported` requires an explicit Pi/provider capability rejection or an authoritative accepted-values response excluding the selection. Authentication, quota, rate limit, timeout, network, service, and unknown failures are inconclusive.

Classification uses structured process/provider evidence where available and a tested bounded adapter for known Pi error contracts. Unknown text never becomes positive evidence.

### 4. Use process-local positive cache with a ten-minute maximum TTL

The cache key contains provider/model, exact thinking, and catalog revision. It stores only timestamp and bounded non-secret evidence. It is not written to disk. Setup verifies before writing but a later Pi process must probe again; within one runtime, repeated dispatches may reuse evidence for up to ten minutes.

An explicit capability rejection during a real worker launch invalidates the matching entry immediately. Horsepower preserves user configuration but blocks subsequent launches until successful reprobe or reconfiguration.

**Alternative considered:** persistent cache. Rejected because stale cross-process evidence would weaken the live boundary and create another state migration surface.

### 5. Put the capability gate before side effects

One-shot and persistent paths call one shared gate after slot resolution and before run, handoff, temporary prompt, or child creation. Setup validates all proposed bindings first, then commits one atomic configuration transaction. No unsupported or inconclusive path partially writes required slots.

### 6. Keep installation and setup separable

`install.sh` activates verified code before optional model setup because probing needs the installed CLI and may depend on the user's provider availability. Setup cancellation is not an installation rollback: code remains installed, prior model configuration remains unchanged, and the installer clearly reports that setup is incomplete. `--no-setup` and no-TTY modes remain deterministic and print `horsepower setup --interactive`.

### 7. Test through a local provider boundary

Unit tests cover catalog revisions, classification, TTL, invalidation, atomic configuration, and pre-side-effect ordering. Integration/E2E tests run actual Pi subprocess contracts against a local deterministic provider fixture that accepts and rejects configured thinking values. Tests contain no real model mappings, API keys, or paid requests.

## Risks / Trade-offs

- **[Probe adds latency or small provider cost]** → Probe only selected combinations, keep prompt/output minimal, and reuse positive evidence for at most ten minutes.
- **[Provider errors are ambiguous]** → Distinguish unsupported from inconclusive and never infer support from failure text.
- **[Pi exposes only coarse capability metadata]** → Treat coarse metadata as insufficient and use the live probe.
- **[Support changes inside the TTL]** → Invalidate on actual upstream rejection; keep TTL short and never silently retry with altered settings.
- **[Setup succeeds but later process must probe again]** → Document that setup validates current support but does not promise permanent upstream availability.
- **[Interactive installation has already activated code when setup fails]** → Preserve previous configuration and report installation and configuration as separate outcomes.

## Migration Plan

1. Add capability discovery/probe/cache abstractions and conservative classifiers behind tests.
2. Replace boolean reasoning expansion with exact evidence requirements.
3. Add transactional interactive and explicit setup flows.
4. Add the shared pre-launch gate to one-shot and persistent paths before side effects.
5. Integrate optional installer setup and localized remediation.
6. Update doctor, docs, release fixtures, and local-provider E2E.

Rollback removes the guided/probe path and restores the prior release version through the existing immutable-version/current symlink mechanism. Existing model-slot JSON remains structurally readable; no automatic configuration rewrite is required.

## Open Questions

- Whether a future Pi release will expose authoritative per-model thinking-level metadata; the adapter should prefer it when available without changing the live-probe fallback contract.
- Which structured Pi/provider error fields are stable enough to classify as explicit capability rejection; implementation must verify against Pi 0.80.10 behavior before adding text-based adapters.
