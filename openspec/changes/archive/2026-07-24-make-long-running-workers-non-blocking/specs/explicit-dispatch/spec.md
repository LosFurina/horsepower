## ADDED Requirements

### Requirement: Dispatch policy distinguishes short one-shot work from non-blocking work
Horsepower campaign guidance SHALL require persistent non-blocking dispatch when work is expected to exceed the confirmed polling interval, involves multiple implementation/test/review agents, waits on external work, may require user steering, or previously stalled. It SHALL permit one-shot dispatch only for demonstrably short, bounded, non-steerable work.

#### Scenario: Captain prepares long implementation work
- **WHEN** an implementation assignment satisfies any persistent-dispatch criterion
- **THEN** Captain explicitly sends `agent`, `workKind`, and `modelSlot` through `create` and then sends the assignment with `wait=false`

#### Scenario: Captain prepares short inspection work
- **WHEN** an assignment is short, bounded, non-steerable, and expected to settle before the confirmed polling interval
- **THEN** Captain may explicitly use `single` without changing agent or slot semantics

### Requirement: Parallel persistent admission preserves independent identities
When non-blocking campaign work is parallelized, Horsepower SHALL preserve one stable worker and message identity per admitted child and SHALL not wait for all children to settle before returning control to Captain.

#### Scenario: Multiple workers are admitted
- **WHEN** Captain creates and asynchronously sends work to multiple persistent workers
- **THEN** each admission result is independently attributable and one child's failure does not hide another child's admission or settlement state
