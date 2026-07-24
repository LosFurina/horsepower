## 1. Failure Contract and Repository Audit

- [x] 1.1 Inventory project-wide `catch`, `.catch`, `Promise.allSettled`, parser fallback, process/RPC event, notification, cleanup, and command-handler failure sites and classify each as blocking, composite-child, asynchronous-settlement, observational-degradation, or expected absence.
- [x] 1.2 Add shared bounded Captain failure and observational diagnostic types with stable codes, boundaries, stages, safe identity fields, retryability, and remediation.
- [x] 1.3 Implement centralized UTF-8-safe normalization, allowlisting, redaction, per-field/item/aggregate bounds, omission markers, and tests for credentials, prompts, raw payloads, stderr, reports, and private handoff paths.
- [x] 1.4 Implement deterministic primary/secondary and canonical composite failure projection that preserves existing typed domain metadata and selects primary child failure by input order.

## 2. Tool and Dispatch Failure Visibility

- [x] 2.1 Preserve validation paths and requested-value identity for top-level and per-child `agent`, `modelSlot`, task, handoff mode, campaign, review, and required-field failures before side effects.
- [x] 2.2 Return bounded available-agent remediation for unknown agents, including explicit `coder` guidance for implementation work, without inferring agent from `workKind` or `modelSlot`.
- [x] 2.3 Extend one-shot batch and orchestration terminal results to retain ordered successful, failed, canceled, and skipped child outcomes with resolved identities and structured causes.
- [x] 2.4 Ensure spawn, stdout/protocol, capability rejection, cancellation, managed-report, terminalization, and cleanup failures retain stage-specific codes and never yield empty or falsely completed tool results.
- [x] 2.5 Update parallel operation cards and final tool details to show concise localized failure code/stage/remediation while preserving bounded structured child diagnostics and terminal truth.

## 3. Persistent Worker and Async Settlement Visibility

- [x] 3.1 Retain structured startup, RPC, prompt, queue, worker-exit, capability, cancellation, and per-message failure metadata in persistent worker state and event streams.
- [x] 3.2 Make `status`, `read`, `list`, waited sends, and future-send rejection return the correlated worker/message failure instead of collapsing classified causes to generic strings.
- [x] 3.3 Project failures occurring after `create` or `send(wait:false)` admission through existing run/worker status and one bounded durable Captain-facing Pi surface without creating another authority store.
- [x] 3.4 Preserve primary message/process failure and report bounded residual state when abort, destroy, shutdown, escalation, RPC teardown, or private temporary-resource cleanup also fails.

## 4. OpenSpec, Campaign, Review, Verification, and Handoff Boundaries

- [x] 4.1 Preserve stable command class, change/task/campaign/run identity, bounded evidence, and remediation for official OpenSpec version, doctor, discovery, status, instructions, validation, inventory, and authorization failures.
- [x] 4.2 Return exact selected-task/check drift identity and blocking campaign/review state for dispatch and automatic-compaction continuation revalidation failures.
- [x] 4.3 Preserve uncovered acceptance references, failed/missing/stale evidence identities, and finding/root-cause state for completion and review resolution failures.
- [x] 4.4 Audit managed handoff creation, transactional writes, manifest validation, report validation, terminalization, retention, and cleanup so primary and secondary failures are visible without exposing private paths or report bodies.
- [x] 4.5 Ensure eligible automatic continuation suppression reports a bounded stopping category without queuing work or creating new campaign authority.

## 5. CLI, Configuration, Installer, Updater, and Release Visibility

- [x] 5.1 Apply the shared failure envelope to CLI parsing, command dispatch, configuration reads/writes, compatibility checks, doctor, setup, configure, enable/disable, uninstall, and purge while preserving side-effect-free help.
- [x] 5.2 Distinguish supported optional absence from malformed, unreadable, unsupported, or unsafe configuration and disclose locale or presentation fallback degradation.
- [x] 5.3 Preserve stage-specific network, release identity, checksum, archive, manifest, mode, compatibility, ownership, activation, post-validation, rollback, and cleanup failures in updater and installer outcomes.
- [x] 5.4 Report truthful unchanged, staged, activated, rolled-back, or residual installation state and preserve primary failure when rollback or cleanup also fails.
- [x] 5.5 Audit release construction and verification scripts so failed checks, subprocesses, temporary isolation restoration, and privacy/manifest scans cannot be silently ignored or reported as success.

## 6. Webhook, Localization, TUI, and Observational Diagnostics

- [x] 6.1 Preserve bounded provider, attempt, timeout, transport, receiver, retry, rendering, and abandonment diagnostics for generic and Discord delivery without changing dispatch/change terminal truth.
- [x] 6.2 Add a bounded process-local observational diagnostic projection exposed through existing `doctor`, status, command result, durable entry, or fallback UI surfaces without becoming terminal authority.
- [x] 6.3 Replace silent observational catches with explicit bounded diagnostic recording where safe, while keeping progress callbacks, renderers, notifications, localization fallbacks, and shutdown cleanup isolated from business settlement.
- [x] 6.4 Add recursion, rate, item-count, byte, and first-terminal-wins protections for fallback error rendering and durable diagnostic delivery.

## 7. Skill and Documentation

- [x] 7.1 Update `resources/skills/horsepower/SKILL.md` before the first dispatch example to require explicit `agent`, `workKind`, and `modelSlot`, and show `agent: "coder"` for implementation tasks.
- [x] 7.2 Update English and Chinese documentation with the failure envelope, async settlement inspection, observational-degradation semantics, privacy bounds, and troubleshooting examples.
- [x] 7.3 Ensure human error/remediation text uses `outputLocale` while codes, boundaries, stages, paths, IDs, providers, models, slots, statuses, commands, and JSON fields remain untranslated.

## 8. Verification

- [x] 8.1 Add unit tests for error classification, redaction/bounds, path attribution, deterministic composite failures, secondary cleanup evidence, fallback rendering, and locale behavior.
- [x] 8.2 Add integration tests covering unknown/missing `coder`, unknown slot, spawn/protocol/capability failure, partial parallel failure, managed-report failure, persistent post-admission failure, RPC exit, cancellation, cleanup degradation, and automatic-continuation suppression.
- [x] 8.3 Add CLI/update/install/release and local generic/Discord receiver tests for stage-specific failures, rollback/residual-state truth, JSON/text parity, and notification independence.
- [x] 8.4 Add production Pi E2E proving the first invalid parallel implementation dispatch returns `$.tasks[0].agent` remediation and a corrected explicit `coder` dispatch uses its configured slot/model identity.
- [x] 8.5 Run typecheck, build, full tests, production Pi E2E, CLI/update/install/release E2E in isolated release output, strict OpenSpec validation, git diff checks, and release privacy/manifest scans.
