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
- Name every requested `modelSlot`; Horsepower never selects a model from an agent role.
- Dispatch only the requested `single`, `parallel`, `chain`, or persistent action.
- Keep proposal, design, specs, tasks, verification, and archive facts in official OpenSpec artifacts.
- Do not ask workers to create other workers.
- Treat workers as process-isolated, not security-isolated; they share the user's filesystem, environment, credentials, and network.
