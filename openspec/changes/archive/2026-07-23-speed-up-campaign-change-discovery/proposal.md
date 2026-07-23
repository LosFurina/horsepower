## Why

`/horsepower-campaign` currently performs repeated serial OpenSpec validation for every unfinished change, so the change picker can take more than 30 seconds to appear with only seven candidates. This makes the primary authorization flow feel hung and must be fixed without weakening strict validation, current-project binding, or confirmation-time drift protection.

## What Changes

- Validate the OpenSpec installation and current project once per discovery operation instead of once per candidate.
- Evaluate independent candidate status and strict-validation facts with bounded concurrency while preserving official list order and deterministic fail-closed diagnostics.
- Keep candidate count, output-byte, timeout, schema, privacy, and project-root bounds unchanged.
- Keep fresh selected-change/task revalidation immediately before campaign creation; discovery acceleration never becomes cached authorization.
- Add command-count and real installed-Pi latency regression coverage for zero, one, and multiple candidates.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-execution-boundary`: Require bounded, prompt campaign discovery without repeated installation validation while retaining strict candidate eligibility and fail-closed behavior.

## Impact

Affected areas are `src/openspec/boundary.ts`, its CLI runner integration, discovery unit tests, extension/real-Pi acceptance harnesses, and release verification. No OpenSpec artifact format, campaign persistence format, or user authorization choice changes.
