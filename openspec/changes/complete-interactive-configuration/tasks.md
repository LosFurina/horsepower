## 1. CLI Contract and Localization

- [x] 1.1 Add failing CLI contract tests proving `configure --interactive` starts complete configuration while existing locale-only configure and model-only setup remain compatible.
- [x] 1.2 Add failing table-driven terminal tests covering English and Chinese model list, model/thinking selection, invalid input, capability actions, cancellation, and summaries.
- [x] 1.3 Add complete localization catalog entries and make the setup terminal consume the effective locale without translating stable identifiers or machine values.

## 2. Complete Configuration Orchestration

- [x] 2.1 Add failing unit tests for the ordered locale, Skill-boundary/audit, webhook, and model journey, including clean audit education and default-No exposed/uncertain audit gating.
- [x] 2.2 Implement a typed complete-configuration orchestrator over existing locale, audit, webhook, and guided model services.
- [x] 2.3 Wire `horsepower configure --interactive` into the CLI, preserve non-interactive `configure --locale`, and return localized per-section outcomes and exact follow-up commands.
- [x] 2.4 Add cancellation and failure tests proving external Skills are never modified, prior model-slot bytes survive incomplete setup, and confirmed independent sections are reported accurately.

## 3. Installer Integration

- [x] 3.1 Add failing installer E2E coverage for the complete bilingual prompt order, unconditional Horsepower/Superpowers boundary explanation, conditional pre-activation audit gate, and post-activation CLI journey.
- [x] 3.2 Refactor `install.sh` to retain staged pre-activation audit safety, invoke the reusable complete configuration journey after activation, and avoid duplicate exposure confirmation.
- [x] 3.3 Add unattended installer tests proving `--no-setup` suppresses interaction, retains audit warnings, and prints `horsepower configure --interactive` plus model-only guidance where applicable.
- [x] 3.4 Verify installer refusal and post-activation configuration failure preserve the required preexisting topology and transactional configuration bytes.

## 4. Documentation and Release Contracts

- [x] 4.1 Update English and Chinese READMEs to make interactive installation the primary path, document unattended installation separately, and distinguish complete configuration from model-only setup.
- [x] 4.2 Document the main-Captain versus worker Skill boundary, explicitly describe Superpowers as user-managed external Skill behavior, and avoid implying Horsepower configures it.
- [x] 4.3 Update CLI help, release fixtures, deterministic archive expectations, privacy scans, and version-sensitive documentation tests for the new command and guidance.

## 5. Verification and Acceptance

- [x] 5.1 Run focused unit and installer E2E suites for both locales and fix only defects within this change scope.
- [x] 5.2 Run `openspec validate --change complete-interactive-configuration`, typecheck, full tests, deterministic build/release checks, and the repository's complete `npm run check` gate.
- [x] 5.3 Conduct bounded implementation and specification reviews, record/deduplicate findings through the Horsepower review campaign, and remediate all in-scope findings within budget.
- [x] 5.4 Run a fresh Captain-selected successful installer/configuration E2E command and report the Horsepower terminal result with exact command, exit code, duration, summary, and evidence references.
