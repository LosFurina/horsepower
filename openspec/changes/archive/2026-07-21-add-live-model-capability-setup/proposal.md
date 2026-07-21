## Why

Horsepower currently requires users to type all required model-slot bindings manually, while its runtime reduces Pi model capability data to `reasoning: true` or `false` and incorrectly treats every reasoning model as supporting every Horsepower thinking level. Installation and dispatch therefore cannot reliably prevent unsupported model/thinking combinations or respond safely when upstream capabilities change.

## What Changes

- Add an interactive setup flow that lists models visible to the current Pi installation and guides users through model and thinking selection for `judgment`, `craft`, and `utility`.
- Add live, bounded capability probes for model/thinking combinations when Pi metadata cannot establish exact support, distinguishing supported, unsupported, and inconclusive outcomes.
- Cache positive capability evidence for a short bounded lifetime, revalidate before worker creation when evidence is absent or stale, and invalidate it immediately after an upstream capability rejection.
- Reject unknown or unverified model/thinking combinations without silently lowering thinking, changing models, or partially writing configuration.
- Preserve `--no-setup` installation and explicit non-interactive setup, while making both interactive and automated configuration transactional.
- Localize Captain-facing setup and remediation output in `en` and `zh-CN` while preserving model IDs, thinking levels, evidence, and error codes.

## Capabilities

### New Capabilities
- `live-model-capability`: Current Pi model discovery, exact thinking-level capability evidence, bounded live probes, cache lifetime, invalidation, and safe inconclusive outcomes.

### Modified Capabilities
- `model-slots`: Slot configuration requires currently verified model/thinking combinations and supports transactional guided setup.
- `github-release-installation`: Interactive installation offers guided required-slot configuration; non-interactive and `--no-setup` paths remain deterministic and provide exact follow-up guidance.
- `explicit-dispatch`: Worker creation revalidates absent or stale capability evidence and refuses unsupported or inconclusive combinations without implicit fallback.

## Impact

Affected areas include `install.sh`, Horsepower CLI setup/configuration commands, Pi model-registry integration, model-slot validation, one-shot and persistent pre-launch authorization, localization, doctor diagnostics, release fixtures, and unit/integration/E2E tests. Live probes make minimal upstream requests and therefore may incur small provider latency or cost; tests SHALL use a local deterministic provider fixture rather than real credentials or paid APIs.
