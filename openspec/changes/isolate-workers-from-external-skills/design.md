## Context

Horsepower uses the installed Pi executable for one-shot JSON workers and persistent RPC workers. It already removes delegation tools and appends a no-delegation instruction, but its child launch arguments do not disable Pi Skill discovery. A worker can therefore inherit global, project, settings, package, or extension-contributed Skills whose workflow instructions compete with the Captain-controlled OpenSpec campaign, review budget, and completion gate.

The main Captain intentionally remains in the user's normal Pi environment. Horsepower must not disable or rewrite the user's Skills, settings, packages, extensions, or trust decisions. Instead, installation and a repeatable CLI command will disclose statically resolvable Skill exposure for the current working-directory context. Official OpenSpec remains mandatory and its compatibility must be bounded before Horsepower downloads or advances work.

## Goals / Non-Goals

**Goals:**

- Make zero automatically discovered Pi Skills a hard invariant for every Horsepower worker.
- Audit the main Captain's statically resolvable Skills using Pi 0.80.10's own package/resource resolution rules without loading extensions or executing Skill content.
- Warn users clearly, require confirmation in interactive installation, and preserve unattended installation semantics.
- Exclude only cryptographically owned Horsepower resources and structurally verified official OpenSpec Skills from the warning list.
- Enforce one OpenSpec compatibility contract, `>=1.6.0 <2.0.0`, across bootstrap, release, doctor, and runtime.
- Preserve privacy, deterministic release construction, exact rollback, localization, and the official OpenSpec boundary.

**Non-Goals:**

- Disabling, deleting, rewriting, quarantining, or classifying user Skills as malicious.
- Isolating the main Captain from its normal Pi Skills.
- Loading user extensions solely to enumerate dynamically contributed Skills.
- Automatically scanning the entire home directory or filesystem.
- Adding worker Skill allowlists, `--skill` escape hatches, or domain-Skill inheritance.
- Treating process isolation as filesystem, credential, network, or operating-system sandboxing.

## Decisions

### 1. Workers unconditionally use Pi's `--no-skills`

Both persistent RPC launch construction and one-shot JSON launch construction will include exactly one `--no-skills` argument and no implicit `--skill` argument. This is not user-configurable in this change. Agent persona prompts, explicit tools, model/thinking selection, task text, and managed handoffs remain unchanged.

This uses Pi's supported hard boundary instead of trying to identify “workflow” Skills by name or content. A denylist would be incomplete and would drift as users install new Skills.

### 2. Audit uses Pi's static package manager, not a full resource loader

A dedicated Skill exposure audit module and `horsepower skill-audit [--json]` command will instantiate Pi 0.80.10's `SettingsManager` and `DefaultPackageManager` for the requested `cwd` and agent directory, call `resolve()` with missing package sources skipped, and inspect only enabled Skill resources. It will parse Skill metadata without executing Skill scripts.

`DefaultResourceLoader.reload()` is rejected because it can load extensions to discover dynamic resources; installation must not execute arbitrary third-party extension code merely to produce a warning. The audit result will state that extension-contributed Skills are not enumerated.

The CLI command is observation-only, requires no active OpenSpec change, and can be rerun from another project directory.

### 3. Audit states are explicit and conservative

Results use `complete`, `partial`, or `failed`:

- `complete`: Pi's static resolver completed for current global and `cwd` context. The documented dynamic-extension limitation still applies.
- `partial`: static resolution skipped missing packages, encountered unreadable/invalid resources, or a safe fallback scan was required.
- `failed`: neither static resolution nor fallback scanning can provide reliable candidates.

Fallback scanning is limited to standard global and current-project-context Skill locations. A zero-result fallback never claims that no external Skills exist.

The audit returns stable machine fields and localized human summaries. It does not persist results, emit webhook data, or print Skill bodies.

### 4. Exclusions require provenance, not names

A Skill named `horsepower` is excluded only when its path is an owned active or staged release entry and its digest agrees with the verified release manifest. An unrelated same-name Skill remains reportable.

An OpenSpec-like Skill is excluded only when its expected project integration location and official generated frontmatter/command contract are valid, its `generatedBy` value is valid, and the integration agrees with the installed supported OpenSpec CLI. Name prefix alone is insufficient. Unverifiable lookalikes remain in the warning list.

### 5. Installer audits before activation

Installation order is:

1. Validate platform, Node, Pi, and official OpenSpec compatibility.
2. Reject missing, unparseable, prerelease, `<1.6.0`, or `>=2.0.0` OpenSpec before downloading Horsepower.
3. Download and verify release archive/checksum/layout.
4. Run staged release preflight.
5. Run the staged CLI Skill audit for the installer invocation's original `cwd`.
6. Display warnings and limitations.
7. In an interactive installation, require explicit `y`, `Y`, or `yes` when external Skills exist or the audit is not complete; empty or other input declines.
8. In a non-interactive installation or with `--no-setup`, write the warning to stderr and continue.
9. Only then mutate versions, `current`, links, or settings.

Declining therefore requires no rollback and leaves an existing installation unchanged.

### 6. Home-directory scan remains user-run advice

The warning will include a portable `find "$HOME" ...` command that prunes noisy directories and locates `SKILL.md` plus direct `.pi/skills/*.md` candidates. Horsepower never executes it automatically. The text states that candidates are not necessarily enabled, may belong to another harness, and that installation cannot predict Skills in future projects.

### 7. Compatibility has one tested contract

The supported values are:

- Node: `>=22.19.0`
- Pi: `0.80.10`
- OpenSpec: `>=1.6.0 <2.0.0`

A shared TypeScript compatibility module will drive release manifest, preflight, doctor, and runtime checks. `install.sh` necessarily contains a bootstrap copy before release download; release and installer tests will assert byte-for-byte semantic agreement with the shared contract. Strict semver parsing rejects unsupported prereleases rather than guessing compatibility.

### 8. Installation output is bounded and private

Human output shows Skill name, user/project scope, source category, and a home/project-folded path. It never prints Skill content, full settings, credentials, private package metadata, or stores the audit in Horsepower state. JSON output may contain local paths for local machine automation but remains local and credential-free.

## Risks / Trade-offs

- **[Dynamic extension Skills are not enumerated]** → The audit explicitly discloses this limitation; worker isolation remains complete because `--no-skills` applies independently of discovery source.
- **[Pi SDK resource semantics can change]** → Horsepower pins Pi 0.80.10 and uses its exported static package manager; compatibility changes require a separate release and tests.
- **[Project trust can affect the Captain's actual view]** → The audit reports the current `cwd` and resolution scope without modifying trust; documentation states that future projects can expose additional Skills.
- **[Interactive warning adds installation friction]** → Confirmation is requested only when external Skills are found or completeness is uncertain, defaults to No, and unattended installation warns without blocking.
- **[OpenSpec 2.x may be compatible in practice]** → It remains blocked until Horsepower explicitly validates and releases support, avoiding accidental major-version acceptance.
- **[Fallback scan can over-report files]** → Results are labeled candidates and partial, and no file is disabled or changed.

## Migration Plan

1. Add failing unit tests for no-Skill launch arguments and compatibility boundaries.
2. Add the static audit module and CLI command with complete/partial/failed fixtures.
3. Integrate audit and confirmation into the installer before activation.
4. Update compatibility metadata and all runtime/doctor checks.
5. Add real Pi worker leakage E2E and installer interaction/rollback E2E in both locales.
6. Update English and Chinese documentation and release/privacy tests.
7. Release as a new immutable version; existing installations remain functional until upgraded and `/reload`ed or restarted.

Rollback is the normal immutable-release rollback: restore the previous `current` target. The feature writes no audit state and modifies no user Skill configuration, so no data migration is needed.

## Open Questions

None. Worker Skill allowlisting and dynamic extension Skill enumeration are explicitly deferred to future OpenSpec changes.
