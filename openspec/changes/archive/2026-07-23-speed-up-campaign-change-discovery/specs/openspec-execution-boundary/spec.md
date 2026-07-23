## ADDED Requirements

### Requirement: Campaign discovery is prompt and resource-bounded
Horsepower SHALL avoid repeated installation validation within one campaign discovery operation and SHALL inspect independent candidate changes with bounded concurrency. It SHALL preserve official candidate order, candidate and byte limits, strict eligibility validation, deterministic fail-closed diagnostics, privacy filtering, and fresh confirmation-time revalidation. Discovery acceleration SHALL NOT persist or reuse authorization across operations, campaigns, changes, task-state changes, or Pi processes.

#### Scenario: Multiple unfinished changes are discovered
- **WHEN** the current project contains multiple bounded apply-ready unfinished changes
- **THEN** Horsepower validates the installation and project once, inspects candidate-specific facts with a fixed concurrency bound, and presents eligible candidates in official list order

#### Scenario: Candidate count grows
- **WHEN** discovery receives more candidates than one inspection batch can process concurrently
- **THEN** Horsepower admits no more than the documented fixed concurrency bound and processes the remaining candidates without an unbounded process burst

#### Scenario: Concurrent candidates finish out of order
- **WHEN** candidate status or strict-validation operations settle in a different order than the official list
- **THEN** Horsepower presents successful candidates and selects any fatal diagnostic according to official list order rather than settlement order

#### Scenario: One candidate is invalid during concurrent discovery
- **WHEN** any candidate returns strict-invalid, malformed, truncated, timed-out, ambiguous, unsupported, or project-conflicting facts
- **THEN** Horsepower fails the whole discovery with a bounded actionable diagnostic and creates no campaign or execution side effect

#### Scenario: Selected candidate drifts after prompt discovery
- **WHEN** a promptly discovered candidate or its selected tasks change before campaign confirmation
- **THEN** Horsepower performs fresh selected-change and task-snapshot validation, rejects stale authorization, and creates no campaign or execution side effect

#### Scenario: Real Pi opens a bounded multi-change picker
- **WHEN** a fresh supported Pi process invokes `/horsepower-campaign` against the installed immutable release in a bounded fixture with multiple eligible changes
- **THEN** the first explicit changes picker appears within the documented acceptance budget without provider or network dependence
