# captain-failure-visibility Specification

## Purpose
Defines project-wide bounded, privacy-safe, attributable failure and observational diagnostic visibility for Captain-facing Horsepower operations.

## Requirements
### Requirement: Business failures are Captain-visible
Every Horsepower failure that prevents, changes, partially completes, or makes uncertain a requested operation SHALL produce a non-empty bounded Captain-visible result. The result SHALL contain a stable code, boundary, stage, redacted message, and actionable remediation, plus available safe operation identity. Horsepower SHALL NOT convert such a failure into silent success, an empty result, or only a transient progress indication.

#### Scenario: Validation fails before side effects
- **WHEN** input, configuration, compatibility, OpenSpec, campaign, agent, slot, model, or capability validation fails before mutation or process creation
- **THEN** Captain receives a structured failed result identifying the owning boundary, failure stage, safe input path or identity when available, and remediation without fabricated lifecycle artifacts

#### Scenario: Execution fails after admission
- **WHEN** an admitted process, worker, RPC request, handoff, lifecycle transition, verification, update, install, or release operation fails
- **THEN** Captain receives or can inspect the existing authoritative operation identity with its actual failed or canceled status and structured bounded cause

### Requirement: Failure projection is bounded and privacy-safe
Captain-facing failure and diagnostic projection SHALL use allowlisted fields, deterministic UTF-8-safe field and aggregate bounds, normalization, and redaction before localization, rendering, webhook adaptation, persistence, or tool delivery. Horsepower SHALL NOT expose prompts, reasoning, credentials, authentication values, private handoff paths, full reports, raw provider payloads, unrestricted stderr, unrestricted command/tool output, or complete conversation history.

#### Scenario: Raw failure contains private material
- **WHEN** an exception, receiver response, subprocess stderr, parser input, path, report, or provider payload contains excluded or credential-shaped content
- **THEN** Horsepower emits only a bounded redacted classification and remediation without forwarding the original private bytes

#### Scenario: Many or oversized failures occur
- **WHEN** a composite operation produces more errors or error text than documented bounds permit
- **THEN** Horsepower preserves deterministic primary and bounded component identity, truncates safely with an omission indication, and does not expose omitted raw content

### Requirement: Composite operations retain attributable outcomes
A required composite operation SHALL retain canonical ordered outcomes for admitted components. If any required component fails, the parent SHALL NOT report `completed`; it SHALL report failure while preserving bounded successful, failed, canceled, and skipped component facts. Primary failure selection SHALL use canonical input order rather than settlement order, and secondary cleanup failures SHALL NOT replace the primary cause.

#### Scenario: Parallel children settle differently
- **WHEN** parallel children complete, fail, cancel, or are skipped in an order different from submitted order
- **THEN** the parent failed result identifies every bounded child by canonical index and stable identity and preserves each known terminal outcome

#### Scenario: Cleanup fails after a primary failure
- **WHEN** process cleanup, handoff terminalization, rollback, notification teardown, or another secondary operation fails after the primary operation failed
- **THEN** Horsepower preserves the primary failure and appends bounded cleanup diagnostics with the remaining invariant state

### Requirement: Asynchronous settlement failures remain inspectable
When Horsepower acknowledges admission before execution settles, any later failed or canceled settlement SHALL be attached to the existing worker, message, run, handoff, update, or lifecycle identity and SHALL remain inspectable through an existing Captain-visible durable or status surface. Admission acknowledgement SHALL NOT be retroactively described as completed execution.

#### Scenario: Non-waited persistent message later fails
- **WHEN** `send(wait:false)` returns an accepted message identity and that message later fails
- **THEN** `status` or `read` exposes the failed message and bounded structured cause, and available Pi durable output informs Captain without creating another message or terminal authority

#### Scenario: Detached settlement has no live tool callback
- **WHEN** an admitted asynchronous operation fails after its initiating tool call can no longer be updated
- **THEN** Horsepower records the result on the existing authoritative operation surface and emits at most one bounded process-local Captain-facing diagnostic through an available durable host surface

### Requirement: Observational degradation is visible without changing terminal truth
Rendering, progress delivery, localization fallback, webhook delivery, and best-effort cleanup failures SHALL remain observational when the owning business operation is otherwise authoritatively settled. Horsepower SHALL expose a bounded diagnostic through an available status, doctor, command result, durable entry, or fallback UI surface and SHALL NOT change, duplicate, or contradict the operation terminal state.

#### Scenario: Renderer or progress callback fails
- **WHEN** a TUI renderer or partial-result callback throws while worker execution continues
- **THEN** Horsepower preserves execution and first-terminal-wins truth and makes a bounded rendering diagnostic inspectable without recursive rendering retries

#### Scenario: Notification delivery fails
- **WHEN** webhook rendering, timeout, receiver rejection, retry exhaustion, or abandonment occurs after a valid terminal event
- **THEN** Horsepower preserves the original terminal state and exposes bounded redacted provider delivery evidence without claiming notification success

#### Scenario: Localization fallback is used
- **WHEN** configured locale resolution fails and Horsepower can safely use a documented fallback
- **THEN** the operation continues with the fallback locale and exposes a bounded degradation diagnostic rather than silently implying configured localization succeeded

### Requirement: Failure ownership and remediation are stable
Failure codes, boundaries, stages, statuses, action names, command paths, IDs, model/slot values, providers, JSON fields, and input paths SHALL remain untranslated machine values. Human messages and remediation SHALL use the effective output locale when available. Domain-specific failure metadata SHALL be preserved instead of being flattened to a generic dispatch code when the owning boundary can classify the cause.

#### Scenario: Known domain error crosses a tool boundary
- **WHEN** OpenSpec, campaign, review, verification, agent catalog, model configuration, worker process, handoff, webhook, updater, installer, release, or CLI code produces a classified failure
- **THEN** the final result retains that stable code and boundary with localized explanation and remediation

#### Scenario: Unclassified exception crosses a boundary
- **WHEN** an exception has no recognized safe metadata
- **THEN** the owning boundary assigns a bounded boundary-specific failure code and remediation without exposing the raw object or misclassifying the operation as success
