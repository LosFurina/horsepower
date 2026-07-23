## Context

The installed `v0.1.0-alpha.26` discovery path reproduces the reported delay in three of three real Pi runs: the picker did not appear within 30 seconds for seven unfinished changes. Boundary timing shows `list` plus initial `doctor` costs about 3 seconds, each candidate's `status + strict validate` costs roughly 2.2–3.9 seconds, and `loadTaskInventory()` also repeats `version + doctor` for every candidate. The work is independent across candidates but currently serialized.

The fix must not trust `openspec list` alone, skip strict validation, cache authorization across user interactions, expose raw diagnostics, or change official ordering.

## Goals / Non-Goals

**Goals:**

- Make the changes picker appear promptly for a bounded multi-change project.
- Perform installation/project validation once per discovery operation.
- Bound concurrent candidate inspection and preserve deterministic official ordering and fail-closed semantics.
- Retain fresh selected-change and exact-task revalidation before campaign creation.
- Lock the user-visible latency regression with real installed-Pi evidence.

**Non-Goals:**

- Removing strict OpenSpec validation from candidate eligibility.
- Persisting discovery caches or treating discovery as campaign authority.
- Searching other projects or registered stores.
- Changing picker content, selection semantics, task scope choices, or execution modes.
- Optimizing OpenSpec CLI internals.

## Decisions

### 1. Split installation validation from candidate inspection

Discovery obtains one verified operation context containing the supported CLI version and project root. Candidate inspection receives that context and performs only the candidate-specific `status`, strict `validate`, secure task-path inspection, and task parsing. Existing `loadTaskInventory()` entry points used for authorization continue to perform fresh installation validation unless explicitly supplied the private operation-local verified context.

This avoids seven duplicate `doctor` calls without creating a cross-operation cache.

### 2. Use a small bounded concurrency pool

Eligible list entries are inspected through a fixed-size pool, initially at most four concurrent candidates. Results are stored by official list index and flattened only after every admitted inspection settles. Candidate count remains capped before scheduling.

`Promise.all` over all candidates was rejected because the existing maximum of 100 could create an uncontrolled process burst. Fully serial inspection was rejected because its latency grows linearly with OpenSpec process startup.

### 3. Preserve deterministic fail-closed outcomes

Every candidate inspection returns either eligible, intentionally skippable (`missing` or not apply-ready), or a bounded failure. After all admitted work settles, failures are evaluated in official list order so scheduling races cannot change the user-visible diagnostic. Strict-invalid, malformed, timeout, truncation, project mismatch, and ambiguous progress remain fatal.

### 4. Define a measurable user-facing latency gate

A real Pi RPC harness measures from submitting `/horsepower-campaign` to the first discovered-change picker request. The fixture uses multiple strictly valid unfinished changes, installed immutable release bits, offline Pi, and bounded output. The acceptance threshold must be generous enough for supported CI variance but low enough to catch the prior 30+ second serial behavior; targeted local regression also asserts command counts and maximum in-flight candidate inspections deterministically.

The primary correctness gate is command topology and bounded concurrency; wall-clock E2E is supplementary because host load varies.

## Risks / Trade-offs

- **[Concurrent CLI processes increase short-lived CPU usage]** → Cap concurrency at four and candidate count before scheduling.
- **[Concurrent failure order becomes nondeterministic]** → Retain indexed outcomes and adjudicate failures in official order.
- **[Operation-local context is accidentally reused as authorization]** → Keep it private to one discovery call; campaign confirmation invokes the existing fresh revalidation path.
- **[Wall-clock tests become flaky]** → Pair the installed-Pi latency gate with deterministic command-count and controlled-delay concurrency tests.
- **[OpenSpec CLI itself is slow on a host]** → Use a bounded, documented threshold and retain progress/failure diagnostics rather than weakening validation.

## Migration Plan

1. Add red command-count, controlled-delay concurrency, ordering, and failure tests.
2. Refactor the boundary to share only operation-local installation context.
3. Add bounded candidate scheduling and deterministic outcome reduction.
4. Run focused/full suites and real installed-Pi latency acceptance.
5. Publish and install a new immutable alpha release. Rollback points `current` to `v0.1.0-alpha.26`; no state migration is required.

## Open Questions

None.
