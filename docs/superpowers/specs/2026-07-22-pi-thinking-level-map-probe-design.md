# Pi Thinking-Level Map Probe Design

## Goal

Determine the exact Pi thinking-level support exposed by the currently configured upstream models and update `~/.pi/agent/models.json` with explicit, model-specific `thinkingLevelMap` entries.

## Scope

Probe the ten models currently configured under the `liweijun` and `liweijun-ds` providers. For each model, test all seven Pi thinking identifiers:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

The probe may make at most 70 upstream model calls.

## Probe Method

Each combination receives one bounded, non-interactive Pi invocation with:

- a fixed minimal prompt;
- the exact provider/model identifier;
- the exact Pi thinking identifier;
- no tools or Skills;
- no retained session;
- tightly bounded output;
- serial execution to reduce rate-limit risk.

Probe output must not include credentials. Raw diagnostic output may be retained only in a temporary local working directory and must be removed after the result is summarized.

## Classification

Each model/level combination is classified as follows:

- **Supported:** the upstream request completes successfully with the exact requested level.
- **Unsupported:** Pi or the upstream explicitly rejects the thinking parameter/value, or returns an authoritative accepted-value set that excludes it.
- **Inconclusive:** authentication, quota, rate limit, timeout, transport, malformed-response, or unknown failure prevents a reliable conclusion.

An inconclusive result must never be converted to an unsupported result.

## Mapping Construction

For every model with conclusive probe results:

- supported levels map to the provider wire value demonstrated by the current Pi adapter;
- explicitly unsupported levels map to `null`;
- inconclusive levels preserve their existing entry, if any;
- inconclusive omitted levels remain omitted rather than being guessed.

Because Pi's `thinkingLevelMap` controls the provider wire value, the proposed map must account for the active API and compatibility adapter. The final result table will show both Pi-level support and the proposed configured value before any write.

## Write Safety

Before changing `~/.pi/agent/models.json`:

1. Parse and validate the existing JSON.
2. Present the complete result table and proposed maps.
3. Create a timestamped sibling backup.
4. Write a temporary file with restrictive permissions.
5. Parse the temporary file and atomically rename it over the original.

No provider URL, API key, model metadata, or unrelated configuration may be changed.

## Verification

After the write:

1. Run `pi --list-models` and confirm all ten models still load.
2. Verify Pi exposes only the intended thinking levels for representative changed models.
3. Run minimal sample requests for at least one GPT model and one DeepSeek model using configured supported levels.
4. Confirm Horsepower's catalog sees the exact declared thinking levels.

If validation fails, restore the timestamped backup and report the failure.
