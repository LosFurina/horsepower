## MODIFIED Requirements

### Requirement: Bounded private audit output
Skill audit SHALL localize human conclusions and complete-configuration guidance while preserving stable machine fields and SHALL NOT print Skill bodies, credentials, complete settings, or private package metadata. Audit results SHALL remain process-local and SHALL NOT be written to Horsepower state, handoffs, webhooks, or telemetry.

#### Scenario: Human-readable audit output
- **WHEN** external Skills are resolved
- **THEN** output contains bounded Skill name, scope, source category, folded path, audit status, and limitations without Skill content

#### Scenario: JSON audit output
- **WHEN** the user runs `horsepower skill-audit --json`
- **THEN** Horsepower returns stable structured fields suitable for local automation without persisting or transmitting the result

#### Scenario: Complete configuration renders audit guidance
- **WHEN** complete configuration presents a clean, partial, failed, or exposed audit result
- **THEN** its human explanation uses the effective `en` or `zh-CN` locale while audit status, source, scope, evidence, and paths remain stable and untranslated

## ADDED Requirements

### Requirement: External Skill boundary education is distinct from exposure warning
Horsepower SHALL distinguish unconditional education about the external Skill boundary from conditional audit warnings. The educational explanation SHALL state that external Skills such as Superpowers remain user-managed, the main Captain runs in the user's normal Pi environment, and Horsepower workers use `--no-skills`; only actual exposure or audit uncertainty SHALL trigger a default-No confirmation gate.

#### Scenario: Complete audit finds no exposure
- **WHEN** an interactive installation or complete configuration receives a complete zero-external result
- **THEN** it shows the localized boundary explanation without claiming external Skills are impossible in other contexts and without requiring risk confirmation

#### Scenario: External exposure is found
- **WHEN** the audit reports one or more external Skills
- **THEN** Horsepower shows the boundary explanation plus bounded evidence and requires explicit affirmative confirmation before the gated operation continues

#### Scenario: Audit cannot establish exposure
- **WHEN** audit status is `partial` or `failed`
- **THEN** Horsepower explains the uncertainty and requires the same explicit affirmative confirmation without modifying Skill configuration
