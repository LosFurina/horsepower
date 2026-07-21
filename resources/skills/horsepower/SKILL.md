---
name: horsepower
description: Explicitly dispatch one-shot or persistent Horsepower workers through capability slots while official OpenSpec remains the source of change facts. Use when independent execution would help an OpenSpec task.
---

# Horsepower

Use `horsepower_subagent` only for work the Captain explicitly chooses to dispatch.

- Name every requested `modelSlot`; Horsepower never selects a model from an agent role.
- Dispatch only the requested `single`, `parallel`, `chain`, or persistent action.
- Keep proposal, design, specs, tasks, verification, and archive facts in official OpenSpec artifacts.
- Do not ask workers to create other workers.
- Treat workers as process-isolated, not security-isolated; they share the user's filesystem, environment, credentials, and network.
