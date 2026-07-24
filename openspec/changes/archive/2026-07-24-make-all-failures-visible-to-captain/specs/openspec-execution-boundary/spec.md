## ADDED Requirements

### Requirement: OpenSpec and campaign failures retain owning fact and safe scope identity
Official CLI, project discovery, authorization, inventory, campaign, continuation, review, and verification failures SHALL return stable OpenSpec/campaign boundary codes, the safe change/task/campaign/run identity available at failure, and remediation appropriate to the rejected fact. Horsepower SHALL NOT collapse these failures into an undifferentiated dispatch failure or silently continue from guessed filesystem or stale campaign facts.

#### Scenario: Official CLI command fails
- **WHEN** a supported OpenSpec doctor, list, status, instructions, validation, or version command exits unsuccessfully, times out, or returns malformed or excessive output
- **THEN** Horsepower reports the command class, stable OpenSpec boundary code, bounded redacted evidence, and required next action without returning raw command output

#### Scenario: Selected task or check drifts
- **WHEN** campaign authorization finds task ID, description, section, status, ordering, or `Check:` drift
- **THEN** Horsepower identifies the affected task and drift class and requires a fresh campaign before side effects

#### Scenario: Completion evidence is insufficient
- **WHEN** terminal verification lacks fresh successful claim-matched evidence
- **THEN** Horsepower returns each bounded uncovered or failed acceptance reference and preserves the non-terminal change state

### Requirement: Suppressed automatic continuation explains the stopping boundary
When an armed automatic-compaction continuation becomes ineligible after asynchronous revalidation, Horsepower SHALL expose a bounded reason category through the existing campaign continuation notice or status surface without revealing compaction text, prompts, credentials, or private paths. Suppression SHALL create no new campaign authority or terminal fact.

#### Scenario: Continuation stops on official drift
- **WHEN** the same campaign fails official OpenSpec, selected task/check, project, session, pending-message, or disposition revalidation
- **THEN** Horsepower queues no continuation and informs Captain of the bounded stopping category and required fresh action
