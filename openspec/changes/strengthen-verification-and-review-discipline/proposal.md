## Why

Horsepower already requires Captain-selected E2E evidence and bounded review campaigns, but its contracts do not yet prove that completion evidence is fresh, complete, and matched to each claim, nor that review feedback has been technically evaluated before it authorizes corrective work. Tightening these gates will prevent stale or partial verification, blind acceptance of reviewer suggestions, and review/fix loops that consume budget without an explicit Captain judgment.

## What Changes

- Require every `completed` change report to carry fresh, Captain-observed verification evidence that identifies the acceptance claim it proves, the exact command executed, its terminal result, and its execution time; stale, failed, partial, or claim-mismatched evidence must not authorize completion.
- Require completion reporting to reconcile the current OpenSpec acceptance scope, not merely present a successful test command, while retaining the existing explicit E2E-waiver path when E2E is genuinely inapplicable.
- Treat worker and reviewer success statements as untrusted inputs until the Captain inspects repository state and independently verifies the relevant result.
- Add an explicit Captain disposition for each in-scope review finding before corrective dispatch or campaign acceptance: accepted, rejected with technical rationale, needs clarification, or blocked for human judgment.
- Prevent unclear, rejected, out-of-scope, or undispositioned findings from authorizing corrective work, and ensure a reviewer verdict or recommendation never implicitly advances a review/fix loop.
- Require corrective work to remain correlated to an accepted root cause and require fresh targeted verification before that finding can be resolved.
- Preserve finite review budgets, root-cause deduplication, explicit human-authorized extensions, Captain authority, OpenSpec ownership, and worker `--no-skills` isolation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-execution-boundary`: Strengthen terminal completion from “successful E2E or waiver exists” to fresh, claim-matched verification plus explicit reconciliation of the current OpenSpec acceptance scope.
- `explicit-dispatch`: Require technical disposition of review findings, accepted-root-cause correlation for corrective work, and fresh targeted evidence before resolution or campaign acceptance.

## Impact

Affected areas include terminal-report and review-campaign schemas, lifecycle validation and process-local state, orchestration tool behavior, Captain-facing Horsepower Skill guidance, localized errors and conclusions, README contracts, unit/integration/E2E coverage, and release metadata or fixtures sensitive to the public tool schema. No Superpowers Skill is installed or loaded by workers, no second planning or verification store is introduced, and existing non-complete terminal states remain available without successful completion evidence.
