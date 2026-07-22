# Task 6.4 — Fresh Captain-selected Pi E2E evidence

Observed: 2026-07-22

## Captain-selected campaign

- campaignId: `a5b7b4f0-ddf8-4908-8cac-82eb9391cc72`
- changeId: `make-campaign-scope-selection-openspec-aware`
- selected task IDs: `6.4`
- mode: `multi_agent`
- Captain kickoff count observed in this Pi turn: exactly one
- selected work dispatch count: one successful verification dispatch, followed by one intentionally rejected drift probe

The successful selected dispatch was:

- action: `single`
- name: `verify-task-6-4-fresh-pi-e2e`
- agent/role: `tester` / `Design and execute focused verification`
- requested/resolved slot: `craft` → `craft`
- model: `liweijun/gpt-5.6-sol`
- thinking: `minimal`
- handoff mode: `managed`
- invocationId: `run-284151d2-1030-45cc-8369-8a05e54580f1-1`
- runId: `run-284151d2-1030-45cc-8369-8a05e54580f1`
- terminal status: `completed`

The managed worker report was validated and returned as:

- projectId: `f124904fec4d1e3aefecb607ad1032ad`
- artifactId: `report`
- report path: `[private-path]/run-284151d2-1030-45cc-8369-8a05e54580f1/report.md`
- manifest path: `[private-path]/run-284151d2-1030-45cc-8369-8a05e54580f1/manifest.json`
- report SHA-256: `37ac3022c0857e8019291ff01b08538de867d955421f85ba0cdece078b598afb`
- report bytes: `9558`
- manifest terminal: `{"status":"completed","reportPresent":true}`

## Fresh installed-Pi and repository checks

The managed tester executed these commands against the current checkout and installed immutable release:

1. `npm run build` — exit 0.
2. `readlink "$HOME/.pi/agent/extensions/horsepower"; readlink "$HOME/.pi/agent/horsepower/current"; realpath "$HOME/.pi/agent/extensions/horsepower"` — exit 0. The integration link resolved through `current` to immutable release `v0.1.0-alpha.19/pi/extensions/horsepower`.
3. `"$HOME/.pi/agent/horsepower/current/bin/horsepower" doctor --json` — exit 0. Current evidence: configuration `ok`; model registry `readiness: "verified"`; OpenSpec `1.6.0` healthy; installation integration `enabled`.
4. `openspec status --change make-campaign-scope-selection-openspec-aware --json` — exit 0 and resolved the real tasks artifact with task 6.4 pending.
5. `openspec validate make-campaign-scope-selection-openspec-aware --type change --strict` — exit 0.
6. `pi --mode rpc --no-session --offline --no-skills --no-prompt-templates --no-context-files` plus `get_commands` — exit 0. Official Pi loaded the installed Horsepower extension and exposed its campaign/doctor/worker/review commands.
7. `npx vitest run --config vitest.e2e.config.ts test/e2e/pi-extension.e2e.test.ts -t "official Pi exposes attributed live worker tool progress and a structured failed terminal result|official Pi restart observes disabled and re-enabled extension links"` — exit 0; 2 passed, 2 skipped. This observes attributed `tool_start`/`tool_end` updates before terminal output, the full resolved worker identity, and a non-empty structured failed terminal result.
8. `npx vitest run test/unit/extension.test.ts test/unit/implementation-campaign.test.ts test/unit/orchestration.test.ts test/unit/handoff-orchestration.test.ts -t "integration symlink|kickoff|selected|drift|spawn|report|orphan|managed"` — exit 0; 18 passed, 56 skipped.
9. Bundled immutable-release agent enumeration — exit 0; found `architect`, `coder`, `researcher`, `reviewer`, and `tester`.
10. `npx vitest run test/unit/extension.test.ts test/unit/extension-runtime.test.ts test/unit/orchestration.test.ts test/unit/handoff-orchestration.test.ts test/unit/handoffs.test.ts -t "resolves bundled agents when Pi loads the extension through its integration symlink|campaign cancellation and creation failure never kick off while repeated confirmed commands kick off once each|forwards the Pi abort signal and observable progress as non-empty partial tool results|dispatch revalidates selected task snapshot before worker side effects while ignoring unselected drift|managed one-shot creates brief before execution and requires report for success|terminalizes only managed handoffs that were created before parallel handoff setup failed|managed persistent create terminalizes its created handoff when worker startup fails|creates private opaque workspace and validates a worker report|invalid worker report cannot prevent failed terminal truth|records a worker-written report truthfully when failure happens before validation|dispatches exactly the explicit parallel tasks and reports terminal lifecycle|emits immutable complete identity with requested-to-resolved fallback and terminal progress"` — exit 0; 12 passed, 75 skipped.
11. Installed extension realpath inspection — exit 0; the canonical bundled agents directory resolved inside immutable release `v0.1.0-alpha.19/resources/agents`.

Raw command evidence from this run is retained under `/tmp/hp-task64-evidence/` for the current machine session. The durable managed report and manifest paths above retain the worker-authored evidence.

## Drift rejection probe

The Captain copied `tasks.md`, temporarily changed only selected task 6.4's description, attempted the same authorized exact-ID dispatch, and restored the file immediately afterward.

The dispatch returned a non-empty structured terminal failure before lifecycle creation:

- status: `failed`
- code: `CAMPAIGN_AUTHORIZATION_FAILED`
- boundary: `campaign`
- message: `Selected OpenSpec task drifted: 6.4; create a new implementation campaign`
- remediation: `Select a valid implementation campaign and retry with an authorized change and task scope.`
- no `runId`, worker identity, or handoff was created

The original and restored `tasks.md` SHA-256 is `2ac8567f9ddce1a049c9a8a2c35b14edd68926bc0cc366593cdcbbdce2f79885`, proving the probe left no task-artifact drift.

## Required behavior disposition

| Behavior | Current evidence |
|---|---|
| Bundled agent discovery through integration symlink | Passed against installed alpha.19 integration realpath and five-agent catalog. |
| Current model readiness | Passed; installed doctor reported `verified`. |
| Real OpenSpec task selection | Passed by this user-confirmed campaign selecting exact pending task `6.4`; status and strict validation also passed. |
| Exactly-once automatic kickoff | Passed by the single automatic Captain turn that initiated this activity; focused command tests passed cancellation/failure/repeat cases. |
| Full worker identity title | Passed in the selected dispatch result and fresh official-Pi E2E, including name, agent/role, slot mapping, model, thinking, mode, invocationId, and runId. |
| Live tool steps | Passed in fresh official-Pi E2E; ordered attributed tool lifecycle updates preceded terminal output. |
| Valid managed report completion | Passed by run `run-284151d2-1030-45cc-8369-8a05e54580f1`; worker report hash/bytes and terminal manifest were validated. |
| Structured spawn/report failure without orphan state | Passed by focused current lifecycle tests; official-Pi E2E also exposed a structured failed terminal result. These fault-injection paths are intentionally automated rather than corrupting the installed live worker runtime. |
| Selected dispatch | Passed by the exact `taskScope: "6.4"` managed tester dispatch under this campaign. |
| Drift rejection | Passed by the live reversible selected-task drift probe, rejected before run/handoff creation. |

## Conclusion

Task 6.4 is accepted on exact current composite E2E evidence: a real user-confirmed campaign and exact selected managed dispatch, current installed-Pi/model/symlink checks, fresh official-Pi E2E for identity/live progress/visible failure, focused current failure-injection lifecycle checks, a validated worker-written managed report, and a live reversible dispatch-time drift rejection probe. No production state was intentionally corrupted to induce spawn/report failure; those destructive branches remain covered by current deterministic fault-injection tests.
