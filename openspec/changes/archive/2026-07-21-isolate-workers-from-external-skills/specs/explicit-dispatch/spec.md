## ADDED Requirements

### Requirement: One-shot workers disable Skill discovery
Every `single`, `parallel`, and `chain` child SHALL run with Pi Skill discovery disabled by exactly one `--no-skills` argument and with no implicit `--skill` path. Explicit agent persona, task, model, thinking, tools, output bounds, and managed handoff behavior SHALL remain available.

#### Scenario: One-shot task starts
- **WHEN** the Captain dispatches a valid single task or a valid parallel or chain step
- **THEN** Horsepower starts the child with `--no-skills` and executes only the explicit task under its selected agent persona

#### Scenario: External workflow Skill is present
- **WHEN** a Skill in the child environment would otherwise require another planning, orchestration, delegation, or completion workflow
- **THEN** the one-shot child does not load the Skill and remains governed by Horsepower's explicit dispatch contract
