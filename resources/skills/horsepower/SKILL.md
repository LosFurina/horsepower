---
name: horsepower
description: Explicitly dispatch one-shot or persistent Horsepower workers through capability slots while official OpenSpec remains the source of change facts. Use when independent execution would help an OpenSpec task.
---

# Horsepower

Before producing work, ask the user to run `/horsepower-campaign` and choose `multi_agent` or `main_agent` for the declared OpenSpec change and task scope. Never infer or choose that mode for the user.

Use `horsepower_subagent` only for work the Captain explicitly chooses to dispatch and the active implementation campaign permits.

- In `main_agent` mode, do not dispatch a worker unless the user separately authorizes a bounded reviewer with `/horsepower-review-authorize`; reviewer output never authorizes a fixer or another review.
- In `multi_agent` mode, delegate substantive work explicitly; the Captain retains scope, budget, finding deduplication, verification, and final judgment.
- Include the active `implementationCampaignId`, exact `taskScope`, and `workKind` in every work-producing dispatch.
- Present principal user-facing conclusions in the `outputLocale` returned by Horsepower (`en` or `zh-CN`), even when worker briefs, reports, reviewer discussion, or raw evidence are English. Preserve machine fields, commands, paths, IDs, digests, artifact references, and raw evidence verbatim.
- `horsepower disable` removes only the Horsepower extension and skill links; `horsepower enable` restores only those links after validating the active release. Both preserve the CLI, versions, configuration, state, and handoffs, and take effect in an existing Pi process only after `/reload` or restart.
- Name every requested `modelSlot`; Horsepower never selects a model from an agent role.
- Before dispatch, Horsepower requires current support for the exact configured thinking value. Successful evidence is process-local and reusable for at most ten minutes only when the exact identifier, thinking value, and catalog revision still match.
- Treat `unsupported` as an explicit capability exclusion and `inconclusive` as a temporary inability to prove support. Horsepower must never silently lower thinking, change identifiers, or retry through a fallback. Preserve the configured binding and direct the user to `horsepower setup --interactive` to reselect, or to retry after an inconclusive condition clears.
- Dispatch only the requested `single`, `parallel`, `chain`, or persistent action.
- Keep proposal, design, specs, tasks, verification, and archive facts in official OpenSpec artifacts.
- Do not ask workers to create other workers.
- Every one-shot and persistent worker runs with `--no-skills`: no global, project, settings, package, or extension-contributed Skill is discovered by workers, and there is no Skill allowlist escape hatch.
- The main Captain remains in the user's normal, user-controlled Pi environment. `horsepower skill-audit` observes only statically resolvable global/current-project exposure; it does not load extensions, change Skill configuration, or predict future projects.
- Treat workers as process-isolated, not security-isolated; they share the user's filesystem, environment, credentials, and network.
