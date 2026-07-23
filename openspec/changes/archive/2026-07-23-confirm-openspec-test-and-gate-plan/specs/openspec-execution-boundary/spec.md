## ADDED Requirements

### Requirement: User-confirmed OpenSpec test-and-gate plan
Before Horsepower treats an OpenSpec change as eligible for implementation, Horsepower-assisted authoring SHALL present the user with an explicit bounded choice of `testIntensity` (`targeted`, `standard`, `exhaustive`, or `custom`) and `gateStrictness` (`required`, `strict`, `release`, or `custom`), explain the concrete consequences of each offered choice for the current change, and obtain affirmative confirmation of the fully expanded plan. Horsepower SHALL NOT silently select, inherit, or reuse a profile across changes or materially changed plans. No profile SHALL weaken mandatory OpenSpec validity, privacy, security, compatibility, lifecycle truth, current-scope claim matching, or E2E-or-valid-waiver requirements.

#### Scenario: User confirms recommended profiles
- **WHEN** Horsepower recommends profiles based on the current change and the user affirmatively selects and confirms them after seeing the expanded cases and gates
- **THEN** the official OpenSpec artifacts record those exact machine profile values and the confirmed expanded plan

#### Scenario: User selects custom profiles
- **WHEN** the user chooses `custom` for testing or gates
- **THEN** Horsepower requires bounded explicit test cases or gate entries that satisfy all mandatory floors before the plan can be confirmed

#### Scenario: User cancels or does not confirm
- **WHEN** the user cancels, declines, supplies an unsupported value, or does not affirm the expanded plan
- **THEN** Horsepower does not represent the plan as confirmed and does not treat the change as ready for Horsepower implementation

#### Scenario: A prior change had a confirmed plan
- **WHEN** Horsepower authors another change
- **THEN** it asks again and does not infer test intensity or gate strictness from the earlier change, global settings, agent output, or repository history

### Requirement: Concrete test-case explanation
A confirmed test-and-gate plan SHALL contain one or more stable unique test-case IDs and SHALL explain each case with bounded mappings to current OpenSpec requirement/scenario or task-acceptance references, test level, purpose or risk, preconditions and fixtures, action or command intent, expected observable result, and the meaning of failure. The plan SHALL cover every current acceptance scenario in scope or identify a concrete justified non-applicability entry; profile names alone, generic phrases such as “add tests,” and unmapped command lists SHALL NOT be sufficient.

#### Scenario: Test case is presented for confirmation
- **WHEN** Horsepower explains a proposed test case to the user
- **THEN** the explanation states what acceptance claim it proves, how it will be exercised, what result must be observed, and what defect or risk a failure would reveal

#### Scenario: Acceptance scenario has no case
- **WHEN** a current in-scope requirement scenario maps to neither a concrete test case nor a justified non-applicability entry
- **THEN** the plan is incomplete and Horsepower blocks implementation eligibility

#### Scenario: One case covers multiple scenarios
- **WHEN** one concrete case genuinely proves multiple acceptance scenarios
- **THEN** every covered reference is listed explicitly and no coverage is inferred for an unlisted scenario

#### Scenario: Planned command is not yet final
- **WHEN** exact implementation-specific command syntax cannot be known during planning
- **THEN** the case records a concrete test level, harness or command intent, setup, action, and expected result and requires the exact command to be reconciled before completion evidence is accepted

### Requirement: Explicit gate explanation and mandatory floors
A confirmed plan SHALL contain stable unique gate IDs and explain for each gate its explicit mapped current requirement/scenario or task-acceptance references, command or inspection intent, scope, pass condition, required/advisory disposition, execution phase, and any permitted waiver condition. Gate acceptance mappings SHALL be resolved and included in the semantic digest; Horsepower SHALL NOT infer them from scope prose. `required` SHALL include all repository-defined baseline checks and current completion requirements; `strict` SHALL additionally require applicable full regression suites and zero unresolved in-scope required failures; `release` SHALL additionally require applicable deterministic release, privacy, packaged artifact, installation, and real-environment acceptance checks. A `custom` plan SHALL enumerate its gates and SHALL remain at least as strict as every mandatory floor applicable to the change.

#### Scenario: Gate profile is explained
- **WHEN** Horsepower presents `required`, `strict`, `release`, or a custom gate profile
- **THEN** it shows the concrete current-change gate entries and pass, waiver, and execution expectations rather than only the profile label

#### Scenario: Release-affecting change selects release gates
- **WHEN** the confirmed plan uses `release` for a release or installation-affecting change
- **THEN** it includes applicable deterministic archive/privacy, packaged CLI, immutable installation, rollback or upgrade, and real acceptance gates

#### Scenario: Custom gate weakens a mandatory floor
- **WHEN** a custom plan omits or makes advisory an applicable mandatory OpenSpec, privacy, security, compatibility, terminal-truth, or completion-evidence gate
- **THEN** Horsepower rejects the plan and identifies the mandatory gate that cannot be weakened

#### Scenario: Waiver is permitted
- **WHEN** a gate explicitly allows waiver and its documented applicability condition is met
- **THEN** the eventual waiver still requires a concrete reason and mapped alternative evidence under the existing verification contract

### Requirement: Official-artifact ownership and bounded plan parsing
The expanded plan and selected profiles SHALL live in official OpenSpec planning artifacts using a documented bounded Markdown contract. Horsepower SHALL derive a normalized plan snapshot and digest from the current validated artifacts without creating a separate persistent planning, test, gate, acceptance, or confirmation registry. It SHALL reject missing sections, malformed or duplicate IDs, unknown profile values, unsafe or oversized fields, unresolved mappings, unsupported counts, symbolic-link or ownership violations, and ambiguous plans.

#### Scenario: Valid plan is loaded
- **WHEN** the current strict-valid OpenSpec change contains one unambiguous documented test-and-gate plan
- **THEN** Horsepower returns the selected profiles, ordered cases, ordered gates, coverage references, and normalized digest without modifying the artifacts

#### Scenario: Plan is malformed
- **WHEN** the plan has duplicate IDs, unknown enums, missing required fields, ambiguous mappings, unsupported bounds, or conflicting plan sections
- **THEN** Horsepower fails closed with actionable bounded diagnostics instead of guessing intent

#### Scenario: Agent or reviewer supplies a separate plan
- **WHEN** a worker, reviewer, report, prompt, settings file, or Horsepower runtime object contains testing or gate recommendations
- **THEN** those remain advisory until incorporated and confirmed in the official OpenSpec artifacts

#### Scenario: Plan is observed repeatedly
- **WHEN** Horsepower loads or revalidates the plan
- **THEN** it performs observation only and does not modify OpenSpec artifacts, confirmation, tasks, or archive facts

### Requirement: Relevant plan drift requires renewed confirmation
Horsepower SHALL compute confirmation against the normalized current profiles, test cases, gates, mappings, and acceptance scope. Adding, removing, reordering, or changing an in-scope requirement/scenario, task acceptance, profile, test case, gate, command intent, fixture/environment assumption, pass condition, waiver rule, or mapping SHALL invalidate prior confirmation. Unrelated prose or formatting changes that do not alter the normalized plan or acceptance scope SHALL NOT invalidate it.

#### Scenario: Test case or gate changes after confirmation
- **WHEN** a case, gate, mapping, profile, or relevant acceptance fact changes
- **THEN** Horsepower requires the user to review and affirm the newly expanded plan before campaign creation or advancing work

#### Scenario: Only unrelated prose changes
- **WHEN** an edit changes no normalized plan field and no mapped acceptance fact
- **THEN** the current plan digest remains valid and Horsepower does not demand confirmation solely because file bytes changed

#### Scenario: Drift occurs during implementation
- **WHEN** dispatch-time revalidation finds relevant drift from the campaign-confirmed plan snapshot
- **THEN** Horsepower blocks new work before budget or process creation and requires a newly confirmed campaign plan
