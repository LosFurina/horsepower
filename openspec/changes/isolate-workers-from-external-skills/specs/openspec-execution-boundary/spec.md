## MODIFIED Requirements

### Requirement: Official OpenSpec is mandatory
Horsepower SHALL require the official Fission-AI/OpenSpec CLI at a stable semantic version in the range `>=1.6.0 <2.0.0` and SHALL NOT install, bundle, patch, replace, or automatically upgrade OpenSpec. Installer bootstrap, release manifest and preflight, doctor, and runtime work authorization SHALL enforce the same compatibility contract.

#### Scenario: OpenSpec CLI missing
- **WHEN** Horsepower installation or doctor cannot find `openspec`
- **THEN** it fails with the detected state and official OpenSpec installation guidance

#### Scenario: Unsupported OpenSpec version during installation
- **WHEN** `openspec --version` fails, is not strict semantic version output, is a prerelease, is older than `1.6.0`, or is `2.0.0` or newer
- **THEN** installation exits before downloading a Horsepower release and does not offer a warning-confirmation bypass

#### Scenario: Unsupported OpenSpec version during operation
- **WHEN** doctor or a work-advancing runtime action observes an OpenSpec version outside `>=1.6.0 <2.0.0`
- **THEN** Horsepower blocks the incompatible operation and reports the required range without changing OpenSpec facts

#### Scenario: Compatibility declarations drift
- **WHEN** installer bootstrap, source compatibility, release manifest, doctor, or runtime boundary declare different OpenSpec ranges
- **THEN** release verification fails before publication
