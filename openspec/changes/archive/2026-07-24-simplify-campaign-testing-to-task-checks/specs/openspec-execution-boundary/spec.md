## ADDED Requirements

### Requirement: Optional task-local verification checks
Horsepower SHALL recognize bounded `Check:` child bullets associated with canonical OpenSpec tasks, preserve their source order in the official task inventory, and include them in inventory drift identity. A strict-valid apply-ready change and unfinished canonical task SHALL remain eligible when no `Check:` is present. Horsepower SHALL NOT require a separate test-and-gate plan, profile, case, gate, coverage mapping, or plan digest.

#### Scenario: Task contains checks
- **WHEN** a canonical task is immediately followed by one or more valid `Check:` child bullets
- **THEN** Horsepower associates those normalized checks only with that task and exposes them with the task inventory

#### Scenario: Task contains no check
- **WHEN** a strict-valid apply-ready change has an unfinished canonical task without a `Check:` child bullet
- **THEN** Horsepower keeps the task campaign-eligible and presents that no task-local check was provided

#### Scenario: Task check changes
- **WHEN** a selected task’s check is added, removed, reordered, or materially changed after confirmation
- **THEN** the official task inventory identity changes and Horsepower requires a fresh campaign before advancing work

### Requirement: Strict-valid OpenSpec is the campaign planning-format boundary
Horsepower SHALL determine planning-format eligibility from the supported official OpenSpec boundary, strict change validation, apply-ready artifact status, and canonical unfinished tasks. Horsepower SHALL NOT reject an otherwise eligible change because `design.md` lacks Horsepower-specific test or gate syntax.

#### Scenario: Strict-valid change has no legacy plan section
- **WHEN** an apply-ready change passes official strict OpenSpec validation and contains unfinished canonical tasks but no `## Test and Gate Plan`
- **THEN** Horsepower permits task selection and campaign confirmation

#### Scenario: Official OpenSpec validation fails
- **WHEN** the selected change is not apply-ready, strict-valid, or owned by the current official OpenSpec project
- **THEN** Horsepower rejects campaign creation before state mutation with bounded actionable diagnostics

## REMOVED Requirements

### Requirement: User-confirmed OpenSpec test-and-gate plan
**Reason**: Separate profiles and expanded plan entries duplicate OpenSpec task guidance and can block strict-valid changes for Horsepower-specific formatting.
**Migration**: Put concrete verification guidance under relevant tasks as `Check:` child bullets and provide a testing-intensity prompt during `/horsepower-campaign`.

### Requirement: Concrete test-case explanation
**Reason**: Mandatory `TC-*` records create a parallel testing registry.
**Migration**: Record concrete commands or observable verification outcomes as task-local `Check:` lines.

### Requirement: Explicit gate explanation and mandatory floors
**Reason**: Mandatory `G-*` records make platform invariants depend on user-authored ceremony.
**Migration**: Horsepower continues enforcing its non-negotiable platform boundaries directly; task-specific gates belong in `Check:` lines.

### Requirement: Official-artifact ownership and bounded plan parsing
**Reason**: The dedicated plan grammar and parser are removed.
**Migration**: Official OpenSpec remains authoritative; bounded task-local checks are parsed with the canonical task inventory.

### Requirement: Relevant plan drift requires renewed confirmation
**Reason**: There is no independent plan snapshot after this change.
**Migration**: Selected task descriptions, sections, pending states, and task-local checks participate in official task-inventory drift detection.
