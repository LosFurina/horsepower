## ADDED Requirements

### Requirement: Guided model-slot installation setup
After verified activation and Skill exposure handling, interactive installation SHALL offer to run guided setup for the required `judgment`, `craft`, and `utility` model slots. The guide SHALL use the current Pi model catalog and live selected-combination validation, and SHALL allow retrying, choosing another model or thinking level, skipping setup for the documented follow-up command, or canceling without partial model-slot writes.

#### Scenario: Interactive user configures required slots
- **WHEN** a controlling terminal is available and the user chooses guided model setup
- **THEN** the installer guides all three required slots and completes only after their exact combinations are currently verified and atomically saved

#### Scenario: Probe is unsupported or inconclusive
- **WHEN** a selected combination is rejected or cannot be conclusively validated
- **THEN** the guide offers retry, reselection, skip, or cancel and does not claim the combination is supported

#### Scenario: Setup is skipped
- **WHEN** the user skips guided setup, `--no-setup` is supplied, or no controlling terminal is available
- **THEN** installation preserves existing slot configuration and prints the exact `horsepower setup --interactive` follow-up command

#### Scenario: Guided configuration fails after activation
- **WHEN** guided setup is canceled or cannot validate all required slots after Horsepower code activation succeeded
- **THEN** the installed code remains valid, previous slot configuration remains byte-for-byte unchanged, and output distinguishes installation success from incomplete model setup
