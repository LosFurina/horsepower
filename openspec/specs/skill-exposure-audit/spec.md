# skill-exposure-audit Specification

## Purpose
TBD - created by archiving change isolate-workers-from-external-skills. Update Purpose after archive.
## Requirements
### Requirement: Safe static Skill exposure audit
Horsepower SHALL provide an observation-only `skill-audit` command that uses the supported Pi SDK's static package/resource resolution for global and current-working-directory context without loading extensions, invoking models, executing Skill content, installing missing packages, or modifying Pi settings, packages, trust decisions, or Skill files.

#### Scenario: Static audit succeeds
- **WHEN** Pi's static resolver completes for the current context
- **THEN** Horsepower reports enabled Skill resources with stable name, scope, source, and path metadata and states that dynamically extension-contributed Skills were not enumerated

#### Scenario: Missing package source
- **WHEN** a configured package source is unavailable during audit
- **THEN** Horsepower skips installation, marks the audit `partial`, and reports the limitation without modifying package state

### Requirement: Conservative audit outcomes and fallback
Skill audit SHALL report exactly `complete`, `partial`, or `failed`. If static resolution fails, Horsepower SHALL safely scan only standard global and current-project-context Skill locations, SHALL label those results as candidates, and SHALL NOT claim absence of external Skills from an incomplete zero-result scan.

#### Scenario: Static resolver fails and fallback finds candidates
- **WHEN** static resolution fails but standard-location scanning succeeds
- **THEN** Horsepower reports `partial`, lists bounded candidates, and explains that enabled state is not fully known

#### Scenario: No reliable candidates can be determined
- **WHEN** static resolution and safe fallback cannot establish a reliable candidate set
- **THEN** Horsepower reports `failed` and does not state that no external Skills exist

### Requirement: Provenance-based warning exclusions
Skill audit SHALL exclude only manifest-owned, digest-verified Horsepower Skills and structurally verified official OpenSpec-generated Skills compatible with the installed official OpenSpec CLI. Names alone SHALL NOT establish exclusion.

#### Scenario: Owned Horsepower Skill is found
- **WHEN** a resolved Skill matches the verified active or staged Horsepower release entry and digest
- **THEN** the Skill is counted as excluded and omitted from the external warning list

#### Scenario: Unrelated Skill reuses an excluded name
- **WHEN** a Skill is named `horsepower` or resembles an OpenSpec Skill but its provenance or official generation contract cannot be verified
- **THEN** Horsepower reports it as an external Skill candidate rather than excluding it

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

### Requirement: User-run broader candidate scan guidance
Horsepower SHALL provide a portable Linux/macOS `find` command that users may run to locate candidate `SKILL.md` and direct `.pi/skills/*.md` files beneath `$HOME`, while stating that candidate existence does not imply Pi enablement and that installation cannot predict future project contexts.

#### Scenario: Audit scope is explained
- **WHEN** installer or CLI audit output describes its current-context coverage
- **THEN** it offers the command as optional advice and does not execute, persist, delete, or disable any discovered file

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

