## Context

Horsepower already has several local failure forms: `toolFailure` metadata, verification/review codes, dispatch terminal reports, batch outcomes, worker event streams, updater statuses, doctor findings, and bounded webhook delivery evidence. These mechanisms are unevenly projected. Some paths preserve actionable context; others collapse errors into `DISPATCH_FAILED`, convert them to transient text, return a fallback without stating that degradation occurred, detach asynchronous settlement without a durable Captain-visible conclusion, or intentionally catch an observational exception with no later diagnostic.

A project-wide review must therefore classify failures by effect rather than mechanically replace every `catch`. Business and authority failures must affect the operation result. Observational failures must not corrupt terminal truth, but they must remain safely inspectable. Existing OpenSpec, campaign, lifecycle, worker, handoff, and release artifacts remain the authoritative facts.

## Goals / Non-Goals

**Goals:**

- Give Captain a bounded structured explanation for every failure that changes, prevents, partially completes, or makes uncertain an operation.
- Attribute failures to a stable boundary, stage, action, and available identity such as input path, child index/name, worker/message/run/change ID, command path, or provider.
- Preserve component outcomes for composite operations and never report a required composite operation as completed when a child failed.
- Make post-admission asynchronous failure inspectable through existing durable status, worker event, lifecycle, doctor, or command-result surfaces.
- Keep presentation and notification errors observational while exposing bounded diagnostics.
- Apply one redaction and bounding policy before errors leave their owning boundary.
- Improve initial dispatch guidance by naming `coder` explicitly for implementation examples while keeping `agent`, `workKind`, and `modelSlot` independent.

**Non-Goals:**

- Creating another terminal, evidence, acceptance, campaign, task, or planning registry.
- Exposing prompts, reasoning, credentials, private handoff paths, full reports, raw provider bodies, unrestricted stderr, or unrestricted tool output.
- Treating webhook, localization, progress callback, renderer, or other observational failures as worker/change failure.
- Automatically retrying, changing a model binding, changing a thinking level, restarting workers, fixing configuration, or broadening campaign authority.
- Guaranteeing recovery of process-local diagnostics after host termination.

## Decisions

### 1. Classify failures by operational effect

Each audited failure site will be classified as one of:

- **Blocking**: the requested operation cannot safely begin or finish. Return `failed` or `canceled` with structured failure data.
- **Composite child**: one member of a required batch fails. Preserve all child outcomes and fail the parent operation.
- **Asynchronous settlement**: admission succeeded but later work failed. Store the failure on the existing worker message/run/handoff/lifecycle surface and emit a durable bounded Captain-facing conclusion where Pi supports it.
- **Observational degradation**: execution truth is unchanged, but rendering, localization, notification, or best-effort cleanup failed. Record a bounded diagnostic and keep the authoritative terminal state.
- **Expected absence/fallback**: absence is part of the interface, such as optional configuration or unavailable telemetry. It remains silent only when the contract explicitly declares it non-failure; a degraded fallback must identify itself.

Alternative considered: convert every caught exception into a thrown business error. Rejected because renderer, progress, notification, and shutdown failures must not reverse valid worker or lifecycle truth.

### 2. Use one safe failure projection contract

Introduce a shared bounded failure projector used at boundary exits. The minimum shape is:

```ts
interface CaptainFailure {
  code: string;
  boundary: string;
  stage: string;
  message: string;
  remediation: string;
  retryable?: boolean;
  path?: string;
  index?: number;
  name?: string;
  workerId?: string;
  messageId?: string;
  runId?: string;
  changeId?: string;
  provider?: string;
}
```

Fields are allowlisted, UTF-8 bounded, normalized, and redacted. Existing stable domain codes take precedence; unknown failures receive a boundary-specific code rather than a universal generic classification when the owner can identify the boundary. Raw exception objects never cross the Captain-facing boundary.

Alternative considered: add structured fields independently in every module. Rejected because divergent bounds and redaction would recreate the current ambiguity.

### 3. Keep authority in existing stores

The new projection is not a new source of truth. Dispatch terminal status remains in run lifecycle, persistent message state remains in the worker manager, handoff status remains in the handoff store, campaign/review/verification authority remains in existing managers, and updater/CLI status remains in command results. Diagnostics reference those identities and summarize existing facts.

Asynchronous `wait:false` failures are attached to the existing message/run identity and made visible through existing status/read/list or durable extension entries. No detached failure journal is authoritative.

Alternative considered: a global persistent error log. Rejected because it would add retention/privacy complexity and compete with existing lifecycle facts.

### 4. Preserve complete bounded composite outcomes

`parallel`, `chain`, cleanup batches, release checks, and similar composite operations will retain a canonical ordered component projection. A required child failure makes the parent `failed`; successful, failed, canceled, and skipped child states remain visible. The primary failure is selected deterministically by canonical input order, not asynchronous settlement order. Secondary cleanup errors are attached without replacing the primary cause.

Alternative considered: return only the first exception. Rejected because Captain cannot identify which child or cleanup step failed and may repeat successful work.

### 5. Separate tool result from TUI delivery

A tool operation must always produce a non-empty terminal result when its handler regains control. TUI cards display a concise localized projection, while `details` carries the bounded stable diagnostic. If rendering or update delivery fails, the business result is preserved and a diagnostic is exposed through an available safe fallback surface. Renderer recursion and unbounded retries are prohibited.

### 6. Audit fallbacks and catches systematically

Implementation will inventory `catch`, `.catch`, `Promise.allSettled`, process/RPC exit/error handlers, parser defaults, locale/config fallbacks, notification abandonment, updater rollback, installer shell error handling, and release verification. Each site receives an explicit classification and a regression test or documented expected-absence rationale. Static checks will target known dangerous silent patterns without banning legitimate isolation.

### 7. Keep Skill correction small and explicit

The bundled Skill will state before its first dispatch example that implementation work uses `agent: "coder"`, and every `single`, `parallel`, `chain`, and `create` item must explicitly provide both `agent` and `modelSlot`. It will repeat that `agent`, `workKind`, and `modelSlot` are independent and cannot be inferred from one another. Runtime validation remains the ultimate guardrail and returns the input path on failure.

## Risks / Trade-offs

- **[Risk] Error payloads become noisy or large** → Apply per-field, item-count, and aggregate UTF-8 byte limits; use concise TUI summaries and fuller bounded details.
- **[Risk] Error projection leaks sensitive material** → Allowlist fields, apply one redaction policy before localization/rendering, and test secrets, provider bodies, stderr, prompts, and private paths.
- **[Risk] Observational failures accidentally change terminal truth** → Model them separately and test first-terminal-wins and notification/rendering independence.
- **[Risk] Detached `wait:false` failures remain unnoticed** → Attach settlement to existing worker/run identity and add durable Captain-facing notification where the host permits it.
- **[Risk] New generic abstraction erases domain detail** → Preserve existing domain codes and let owners supply typed metadata before shared projection.
- **[Risk] Audit mechanically changes intentional fallbacks** → Require classification and rationale for every changed catch/fallback rather than blanket replacement.
- **[Risk] Compatibility changes for callers expecting sparse results** → Add fields compatibly where possible; retain existing stable statuses and machine tokens.

## Migration Plan

1. Add shared failure/diagnostic types, redaction, bounds, deterministic composite selection, and tests.
2. Inventory and classify current failure sites before modifying behavior.
3. Migrate tool/orchestration, worker/process/RPC, lifecycle/handoff, OpenSpec/campaign/review/verification, CLI/config/updater/release, webhook, localization, and TUI paths in risk order.
4. Add durable asynchronous settlement visibility using existing run/worker surfaces.
5. Update Skill and documentation.
6. Run source tests, real Pi E2E, CLI/update/install/release E2E in isolated release output, strict OpenSpec validation, privacy scans, and malformed/failure-path tests.
7. Ship through a new immutable release; rollback remains activation of the previous immutable version.

## Open Questions

- Which existing Pi durable entry surface is best for process-lifetime non-worker asynchronous failures when no active tool result can be updated?
- Should `doctor` summarize only currently unresolved observational diagnostics, or also bounded recent resolved degradation for the running process?
- Which current CLI commands already expose sufficient structured failure fields and can adopt the shared projector without changing their public JSON envelope?
