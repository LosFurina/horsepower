## Context

Horsepower has four related configuration concerns but no single reusable user journey. `install.sh` owns locale selection, pre-activation Skill exposure gating, webhook questions, and an optional call into model setup. The CLI's `setup --interactive` owns only model slots, while `configure` currently changes locale only. Documentation recommends `--no-setup` followed by the model-only setup command, so users reasonably infer that locale, webhook, and external Skill/Superpowers guidance do not exist.

The installer must retain its pre-activation security boundary: exposure or audit uncertainty must be disclosed before links, settings, or `current` are changed. The CLI flow, by contrast, operates on an already installed release and can provide education and current-context audit results without pretending to recreate that pre-activation gate.

## Goals / Non-Goals

**Goals:**

- Give `horsepower configure --interactive` an explicit complete-configuration meaning while preserving existing non-interactive `configure --locale` behavior.
- Reuse typed, testable terminal interaction and configuration services rather than growing more shell-only questionnaires.
- Keep `horsepower setup --interactive` as the documented model-only workflow for revalidation and reselection.
- Render every complete-configuration and model-guidance prompt in the effective `en` or `zh-CN` locale.
- Explain the Captain/worker Skill boundary and how external Skills such as Superpowers coexist with Horsepower, regardless of whether an audit finds exposure.
- Preserve atomic model-slot writes, private webhook handling, audit non-mutation, and installer rollback guarantees.

**Non-Goals:**

- Install, remove, enable, disable, or configure Superpowers or any other external Skill.
- Allow Horsepower workers to discover Skills; `--no-skills` remains mandatory.
- Change Pi provider/model configuration or `~/.pi/agent/models.json`.
- Add locales beyond `en` and `zh-CN`, change persisted schema, or introduce a general-purpose wizard framework.

## Decisions

### 1. Separate complete configuration from model-only setup

`horsepower configure --interactive` will run the complete installed-release journey. Existing `horsepower configure --locale <locale> [--scope ...]` remains non-interactive and compatible. `horsepower setup --interactive` remains model-only and all capability-remediation messages continue to point to it.

The complete journey is ordered as:

1. Choose or confirm locale and persist it before rendering later questions.
2. Explain Horsepower's Skill boundary, naming Superpowers as an example of an external Skill without treating that name specially.
3. Run and present the current-context static Skill audit; require explicit confirmation only for external exposure or audit uncertainty.
4. Offer optional webhook configuration or disable/skip.
5. Offer required model-slot setup and delegate to the same transactional guided setup service.
6. Print a localized summary of configured, skipped, canceled, or incomplete sections and exact follow-up commands.

Alternative considered: broaden `setup --interactive` into the complete wizard. Rejected because runtime capability errors already use that command as a precise model-remediation path, and changing it would add unrelated prompts during urgent revalidation.

### 2. Keep pre-activation installer gating, then invoke the reusable post-activation journey

`install.sh` retains staged preflight and staged Skill audit before activation. When exposure or uncertainty exists, it keeps the current default-No confirmation before any mutation. A clean audit still prints a short localized Skill-boundary explanation during interactive installation.

After successful activation and doctor, interactive installation invokes `horsepower configure --interactive` using the installer's controlling-terminal streams. To avoid duplicate audit confirmation, the CLI receives an internal, release-owned installer context indicating that the exact staged audit gate has already run; it still prints the educational boundary text, while direct CLI invocation performs its own current-context audit. This context is not a public bypass for pre-activation checks.

Alternative considered: keep locale/webhook/model prompts in shell and independently recreate them in TypeScript. Rejected because prompt wording, validation, localization, and behavior would drift again.

### 3. Make terminal interaction locale-aware through message IDs

Terminal adapters receive an `OutputLocale` and render prompts through the localization catalog. Stable choices and machine fields remain untranslated: model IDs, thinking IDs, statuses, evidence codes, command names, and JSON keys. Human labels, instructions, validation errors, and summaries are translated.

The setup domain continues to return stable actions (`retry`, `reselect`, `skip`, `cancel`) and never depends on translated input values. Numbered selection is the primary localized-neutral input; stable English action tokens remain accepted for automation and power users.

Alternative considered: interpolate bilingual strings directly in `src/cli/terminal.ts`. Rejected because it repeats the installer problem and prevents localization completeness tests from sharing the existing catalog.

### 4. Model the journey as orchestration over existing services

A small complete-configuration orchestrator coordinates injected interfaces for locale persistence, Skill audit, webhook updates, guided model setup, and terminal input/output. It does not own low-level JSON writes or webhook credential parsing. This keeps cancellation and error behavior independently testable and permits the installer E2E harness to inject deterministic TTY streams.

Locale selection is committed first because it controls all subsequent human output. Webhook writes use existing validated deep-patch behavior. Model selections retain their existing all-slots atomic transaction. Cancellation never rolls back previously confirmed independent sections; the final summary states exactly what changed and what remains incomplete. A model failure after locale/webhook success does not claim complete configuration.

### 5. Make unattended behavior explicit

`--no-setup` means no interactive configuration. It still performs the observation-only staged audit, warns on exposure or uncertainty, installs safely, persists an explicitly supplied locale when present, and prints `horsepower configure --interactive` as the complete follow-up. Documentation shows interactive installation without `--no-setup` as the primary path and documents unattended installation separately.

`horsepower setup --interactive` is documented under model-slot reconfiguration, not as the general post-install command.

## Risks / Trade-offs

- **[Installer and CLI can still diverge at the pre-activation boundary]** → Keep only the security-critical staged audit/gate in shell; test that all post-activation questions come from the CLI journey.
- **[An internal installer context could become an audit bypass]** → Scope it to a private environment contract set only by the repository-owned installer after a successful staged audit, and never skip direct CLI audit by default.
- **[Complete configuration can partially succeed]** → Treat locale, webhook, and model setup as explicit sections, preserve each section's transaction guarantees, and report per-section outcomes without a false all-complete summary.
- **[Localization can regress as prompts are added]** → Centralize message IDs and add table-driven tests covering every terminal branch in both locales.
- **[Users may think Horsepower manages Superpowers]** → State explicitly that external Skills remain user-managed, affect only the main Captain according to Pi discovery, and are never loaded by Horsepower workers.

## Migration Plan

1. Add failing CLI and terminal tests for complete configuration and localized prompts.
2. Add the orchestrator and localization messages while preserving existing command forms.
3. Change the installer to retain pre-activation gating and invoke complete configuration after activation.
4. Update installer E2E, release fixtures, and both READMEs.
5. Release as a new immutable version; existing installations can run `horsepower configure --interactive` after upgrading and `/reload` or restart only if integration links changed.

Rollback restores the previous immutable release through the existing `current` mechanism. Persisted locale, webhook, and model-slot formats are unchanged and remain readable by the prior release.

## Open Questions

None. The user accepted the complete configuration command, documentation correction, full interactive localization, and explicit Horsepower/Superpowers guidance as one scoped change.
