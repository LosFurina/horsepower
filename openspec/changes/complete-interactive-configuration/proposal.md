## Why

Horsepower currently presents two different experiences as “setup”: the installer owns locale, Skill exposure, webhook, and model guidance, while `horsepower setup --interactive` configures models only. The documented `--no-setup` installation path suppresses the broader installer prompts and then directs users to the model-only command, making language, external Skill/Superpowers guidance, and other promised configuration appear missing.

## What Changes

- Add a complete interactive configuration entry point that guides locale, external Skill/Superpowers awareness, optional webhook settings, and required model slots in a clear sequence.
- Keep model-only setup available while naming and documenting its narrower responsibility unambiguously.
- Localize all interactive model, thinking-level, capability-result, retry, skip, and cancellation prompts in `en` and `zh-CN`.
- Show a concise Horsepower-versus-external-Skills/Superpowers explanation during complete configuration even when the static audit is clean; retain the stricter confirmation gate when exposure or uncertainty exists.
- Align interactive installation with the same complete configuration flow and make `--no-setup` explicitly mean unattended installation with a precise complete-configuration follow-up command.
- Correct English and Chinese installation documentation and add regression/E2E coverage for both locales, interactive and unattended paths, and preserved configuration on cancellation or failure.

## Capabilities

### New Capabilities
- `interactive-configuration`: A reusable, localized complete configuration journey spanning locale, Skill/Superpowers guidance, webhook choices, and model-slot setup.

### Modified Capabilities
- `github-release-installation`: Installation and documentation must expose the complete configuration journey without conflating it with model-only setup.
- `skill-exposure-audit`: Complete configuration must always explain the external Skill boundary while retaining evidence-driven warnings and confirmation behavior.
- `live-model-capability`: Every human-facing guided model selection and capability-validation interaction must honor the effective output locale.

## Impact

Affected areas include the CLI command surface, terminal interaction adapters, installer orchestration, localization messages, settings/webhook/model configuration transactions, Skill-audit presentation, release documentation, unit tests, installer E2E fixtures, release determinism expectations, and user-facing follow-up commands. Existing non-interactive model-slot flags and persisted configuration formats remain compatible.
