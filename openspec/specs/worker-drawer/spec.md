# worker-drawer Specification

## Purpose
Define the centered, read-only interactive worker drawer and its bounded non-TUI fallback for unified worker observation.

## Requirements


### Requirement: Worker command opens a centered read-only drawer
In interactive TUI mode, `/horsepower-workers` SHALL open a fresh centered Pi overlay that lists the current unified worker inventory and SHALL permit only navigation, refresh, and close interactions.

#### Scenario: User opens the drawer
- **WHEN** the user invokes `/horsepower-workers` in TUI mode
- **THEN** Horsepower opens a centered responsive overlay using the official custom overlay API

#### Scenario: User attempts drawer interaction
- **WHEN** the drawer has focus
- **THEN** arrow/page keys scroll, `r` refreshes, Escape or `q` closes, and no key sends, steers, aborts, destroys, retries, or mutates a worker

### Requirement: Drawer includes active one-shot and retained persistent workers
The drawer SHALL show every bounded active one-shot worker and every process-lifetime persistent worker, including reusable `idle` workers. Active one-shot entries SHALL disappear after authoritative one-shot tool settlement; persistent entries SHALL follow existing destroy/process-cleanup retention.

#### Scenario: Parallel and persistent workers coexist
- **WHEN** one-shot children are active while persistent running and idle workers exist
- **THEN** the drawer displays all of them with an explicit worker-kind distinction

#### Scenario: One-shot dispatch settles
- **WHEN** the authoritative one-shot tool execution settles
- **THEN** its observational entries are removed without changing or inferring terminal truth

#### Scenario: Persistent worker becomes idle
- **WHEN** a persistent message completes and the worker becomes reusable idle
- **THEN** the worker remains visible until explicit destroy or process cleanup

### Requirement: Drawer refresh is observational
Drawer refresh SHALL read safe existing worker projections and update presentation without polling providers, changing campaign observation, emitting stall authority, sending messages, or mutating worker lifecycle state.

#### Scenario: User refreshes the drawer
- **WHEN** the user presses `r`
- **THEN** Horsepower replaces the displayed bounded snapshot from current authoritative sources without worker mutation

#### Scenario: Derived time advances
- **WHEN** the drawer remains open
- **THEN** it may refresh progress-age and next-poll display through a presentation timer that is cleared on close

### Requirement: Drawer handles viewport and empty inventory
The drawer SHALL remain ANSI/Unicode width-safe, support line-aware scrolling for content beyond the viewport, and visibly render an empty unified inventory.

#### Scenario: Worker cards exceed available height
- **WHEN** rendered cards exceed the overlay viewport
- **THEN** the drawer shows a bounded scroll window and worker/position hints without losing access to later cards

#### Scenario: No workers exist
- **WHEN** neither active one-shot nor retained persistent workers exist
- **THEN** the drawer still opens and visibly reports zero workers

### Requirement: Non-TUI modes fail over explicitly
RPC, JSON, and print modes SHALL not attempt to open an overlay and SHALL expose a bounded safe unified inventory or explicit localized fallback result.

#### Scenario: Command runs through RPC
- **WHEN** `/horsepower-workers` is invoked outside interactive TUI
- **THEN** Horsepower returns bounded structured/text worker data and does not claim an overlay was displayed
