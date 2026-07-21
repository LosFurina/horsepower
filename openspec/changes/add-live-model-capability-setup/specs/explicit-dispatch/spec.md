## ADDED Requirements

### Requirement: Pre-launch live model capability gate
Before spawning a one-shot or persistent worker, Horsepower SHALL require fresh supported evidence for its resolved provider/model and exact thinking level. If evidence is absent, stale, or invalidated, Horsepower SHALL perform a bounded live probe before worker creation and SHALL create no process, run, or handoff when the result is unsupported or inconclusive.

#### Scenario: Fresh supported evidence exists
- **WHEN** dispatch resolves to an exact combination with matching unexpired process-local evidence
- **THEN** Horsepower may create the requested worker without another capability probe

#### Scenario: Evidence requires refresh
- **WHEN** evidence is missing, older than ten minutes, invalidated, or associated with another model-catalog revision
- **THEN** Horsepower reprobes the exact combination before creating the worker

#### Scenario: Revalidation does not confirm support
- **WHEN** pre-launch probing reports unsupported or inconclusive
- **THEN** Horsepower rejects dispatch before creating a child, run, handoff, or automatic fallback
