## Why

Horsepower workers currently inherit Pi's automatic Skill discovery, so unrelated workflow or orchestration Skills can compete with the Captain's explicit OpenSpec campaign, dispatch, review-budget, and completion controls. Workers need a hard no-Skill execution boundary, while installers should warn users—without changing their configuration—about other Skills that can still influence the main Captain.

## What Changes

- Disable all automatic Pi Skill discovery for every one-shot and persistent Horsepower worker.
- Add a safe, repeatable Skill exposure audit that uses Pi's static package/resource resolver without loading extensions or executing Skill content.
- Exclude only manifest-verified Horsepower and verified official OpenSpec Skills from external-Skill warnings.
- Warn interactively and require confirmation when external Skills are found or the audit is incomplete; warn but continue in non-interactive installation.
- Provide a portable, user-run `$HOME` candidate scan command without automatically scanning, persisting, disabling, or deleting Skills.
- Tighten the mandatory official OpenSpec compatibility range to `>=1.6.0 <2.0.0` across installer bootstrap, release metadata, doctor, and runtime validation; incompatible, missing, or unparseable OpenSpec blocks installation before release download.

## Capabilities

### New Capabilities
- `skill-exposure-audit`: Safe inspection and user-facing disclosure of non-Horsepower, non-official-OpenSpec Skills visible to the main Pi Captain in the current installation context.

### Modified Capabilities
- `persistent-workers`: Persistent workers must disable all Pi Skill discovery while retaining their explicit persona, prompt, tools, and handoff behavior.
- `explicit-dispatch`: One-shot single, parallel, and chain workers must run with the same no-Skill boundary.
- `github-release-installation`: Installation must perform the safe Skill audit before activation, apply interactive/non-interactive warning policy, and enforce the bounded OpenSpec version requirement before download.
- `openspec-execution-boundary`: Official OpenSpec compatibility changes from an unbounded minimum to `>=1.6.0 <2.0.0`, with one shared contract across installation, diagnostics, release metadata, and runtime work gates.

## Impact

Affected areas include Pi child-process launch arguments, one-shot and persistent runtime tests, a new CLI audit command and static Pi resource-resolution adapter, installer interaction and fallback scanning, OpenSpec version parsing and compatibility metadata, doctor/runtime boundary checks, localized messages, release determinism/privacy validation, documentation, and mandatory E2E coverage. No user Skill, Pi setting, trust setting, OpenSpec artifact, or extension is automatically modified or executed by the audit.
