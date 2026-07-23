## MODIFIED Requirements

### Requirement: Optional dispatch notification
Dispatch-level webhook notification SHALL be disabled by default and MAY be enabled by user configuration. When enabled, each dispatch terminal event SHALL be normalized once and delivered through the explicitly configured `generic` or `discord` provider adapter. Provider rendering or delivery failure SHALL NOT change the dispatch terminal status, create another terminal event, or expose private handoff data.

#### Scenario: Dispatch notification disabled
- **WHEN** a dispatch reaches terminal status under default configuration
- **THEN** no dispatch webhook is sent

#### Scenario: Dispatch notification enabled
- **WHEN** a dispatch reaches terminal status and dispatch notification is enabled
- **THEN** Horsepower sends one logical terminal notification through the selected provider adapter and bounded in-process delivery attempts

#### Scenario: Provider delivery fails
- **WHEN** the selected Discord or generic receiver rejects or cannot receive a dispatch notification
- **THEN** Horsepower preserves the dispatch terminal status and records only bounded redacted delivery evidence
