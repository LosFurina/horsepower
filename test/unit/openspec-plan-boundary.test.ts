import { expect, test } from "vitest";

const designPath = "/project/openspec/changes/plan-change/design.md";
const tasksPath = "/project/openspec/changes/plan-change/tasks.md";
const specsPath = "/project/openspec/changes/plan-change/specs/openspec-execution-boundary/spec.md";

const tasksMarkdown = `## 1. Parser

- [ ] 1.1 Parse the plan
- [ ] 1.2 Reject invalid plans
`;

const specsMarkdown = `## ADDED Requirements

### Requirement: User-confirmed OpenSpec test-and-gate plan
Body.

#### Scenario: User confirms recommended profiles
- **WHEN** a
- **THEN** b

#### Scenario: User selects custom profiles
- **WHEN** a
- **THEN** b

#### Scenario: User cancels or does not confirm
- **WHEN** a
- **THEN** b

#### Scenario: A prior change had a confirmed plan
- **WHEN** a
- **THEN** b

### Requirement: Concrete test-case explanation
Body.

#### Scenario: Test case is presented for confirmation
- **WHEN** a
- **THEN** b

#### Scenario: Acceptance scenario has no case
- **WHEN** a
- **THEN** b

#### Scenario: One case covers multiple scenarios
- **WHEN** a
- **THEN** b

#### Scenario: Planned command is not yet final
- **WHEN** a
- **THEN** b

### Requirement: Explicit gate explanation and mandatory floors
Body.

#### Scenario: Gate profile is explained
- **WHEN** a
- **THEN** b

#### Scenario: Release-affecting change selects release gates
- **WHEN** a
- **THEN** b

#### Scenario: Custom gate weakens a mandatory floor
- **WHEN** a
- **THEN** b

#### Scenario: Waiver is permitted
- **WHEN** a
- **THEN** b

### Requirement: Official-artifact ownership and bounded plan parsing
Body.

#### Scenario: Valid plan is loaded
- **WHEN** a
- **THEN** b

#### Scenario: Plan is malformed
- **WHEN** a
- **THEN** b

#### Scenario: Agent or reviewer supplies a separate plan
- **WHEN** a
- **THEN** b

#### Scenario: Plan is observed repeatedly
- **WHEN** a
- **THEN** b

### Requirement: Relevant plan drift requires renewed confirmation
Body.

#### Scenario: Test case or gate changes after confirmation
- **WHEN** a
- **THEN** b

#### Scenario: Only unrelated prose changes
- **WHEN** a
- **THEN** b

#### Scenario: Drift occurs during implementation
- **WHEN** a
- **THEN** b
`;

const designMarkdown = `## Context

Prose.

## Test and Gate Plan

### Profiles
- testIntensity: standard
- gateStrictness: required

### Test Cases

#### TC-1: Confirms recommended profiles
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1
- level: unit
- purpose: Prove profile values are recorded only after affirmative user selection
- preconditions: OpenSpec change with draft plan section present
- action: Parse and present expanded plan then accept confirmed profiles
- expected: Snapshot contains exact machine profile values and ordered cases
- failure: Silent default profile selection or missing expanded cases
- disposition: required

#### TC-2: Rejects incomplete acceptance coverage
- maps: scenario:Concrete test-case explanation/Acceptance scenario has no case, task:1.2
- level: integration
- purpose: Ensure every in-scope scenario is covered or marked non-applicable
- preconditions: Specs with an uncovered scenario
- action: Load plan and reconcile acceptance coverage
- expected: Plan rejected with uncovered scenario diagnostic
- failure: Implementation eligibility without acceptance coverage
- disposition: required

#### TC-3: Remaining scenarios
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User selects custom profiles, scenario:User-confirmed OpenSpec test-and-gate plan/User cancels or does not confirm, scenario:User-confirmed OpenSpec test-and-gate plan/A prior change had a confirmed plan, scenario:Concrete test-case explanation/Test case is presented for confirmation, scenario:Concrete test-case explanation/One case covers multiple scenarios, scenario:Concrete test-case explanation/Planned command is not yet final, scenario:Explicit gate explanation and mandatory floors/Gate profile is explained, scenario:Explicit gate explanation and mandatory floors/Release-affecting change selects release gates, scenario:Explicit gate explanation and mandatory floors/Custom gate weakens a mandatory floor, scenario:Explicit gate explanation and mandatory floors/Waiver is permitted, scenario:Official-artifact ownership and bounded plan parsing/Valid plan is loaded, scenario:Official-artifact ownership and bounded plan parsing/Plan is malformed, scenario:Official-artifact ownership and bounded plan parsing/Agent or reviewer supplies a separate plan, scenario:Official-artifact ownership and bounded plan parsing/Plan is observed repeatedly, scenario:Relevant plan drift requires renewed confirmation/Test case or gate changes after confirmation, scenario:Relevant plan drift requires renewed confirmation/Only unrelated prose changes, scenario:Relevant plan drift requires renewed confirmation/Drift occurs during implementation
- level: failure-path
- purpose: Exercise remaining in-scope scenarios through focused parser and boundary checks
- preconditions: Fixtures covering each mapped scenario
- action: Run focused unit tests for each mapped scenario path
- expected: Every mapped scenario has concrete expected behavior and failure meaning
- failure: Scenario accepted without a concrete case or justified non-applicability
- disposition: required

#### TC-4: Production end-to-end path
- maps: task:1.1
- level: e2e
- purpose: Prove standard coverage includes one selected end-to-end path
- preconditions: Official Pi fixture with the production extension loaded
- action: Invoke production campaign confirmation
- expected: Combined confirmation creates exactly one campaign
- failure: Unit-only coverage misses authority defects
- disposition: required

### Non-Applicability

### Gates

#### G-1: Strict OpenSpec validation
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1
- intent: openspec validate --strict
- scope: selected change
- pass: exit 0 and zero failed totals
- disposition: required
- phase: campaign
- waiver: none
- floor: openspec

#### G-2: Privacy scan
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1
- intent: npm run release privacy checks
- scope: packaged artifacts
- pass: no prohibited secrets or path leaks
- disposition: required
- phase: release
- waiver: none
- floor: privacy

#### G-3: Security boundary
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1
- intent: inspect no-follow regular-file ownership protections
- scope: OpenSpec artifact reads
- pass: symlink and escape paths rejected
- disposition: required
- phase: dispatch
- waiver: none
- floor: security

#### G-4: Compatibility range
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1
- intent: enforce OpenSpec >=1.6.0 <2.0.0
- scope: runtime boundary
- pass: unsupported versions blocked
- disposition: required
- phase: campaign
- waiver: none
- floor: compatibility

#### G-5: Terminal truth
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1
- intent: first-terminal-wins completion contract
- scope: campaign terminal state
- pass: terminal outcome matches observed evidence
- disposition: required
- phase: completion
- waiver: none
- floor: terminal-truth

#### G-6: E2E or valid waiver
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1
- intent: real Pi E2E for plan confirmation paths
- scope: authoring and campaign confirmation
- pass: exit 0 with claim-matched evidence or permitted waiver
- disposition: required
- phase: completion
- waiver: concrete reason plus mapped alternative evidence under verification contract
- floor: e2e

## Goals

Done.
`;

const healthy = {
  "--version": { code: 0, stdout: "1.6.0\n", stderr: "" },
  "doctor --json": {
    code: 0,
    stdout: JSON.stringify({ root: { path: "/project", healthy: true }, status: [] }),
    stderr: "",
  },
  "status --change plan-change --json": {
    code: 0,
    stdout: JSON.stringify({
      changeName: "plan-change",
      isComplete: true,
      artifactPaths: {
        design: { resolvedOutputPath: designPath },
        tasks: { resolvedOutputPath: tasksPath },
        specs: {
          resolvedOutputPath: "/project/openspec/changes/plan-change/specs/**/*.md",
          existingOutputPaths: [specsPath],
        },
      },
    }),
    stderr: "",
  },
  "validate plan-change --strict --json": {
    code: 0,
    stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }),
    stderr: "",
  },
};

function skillText(path: string): string {
  if (path.endsWith("SKILL.md")) {
    return 'name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: "1.6.0"';
  }
  if (path.endsWith("opsx-apply.md")) return "Implement tasks from an OpenSpec change.";
  if (path === designPath) return designMarkdown;
  if (path === tasksPath) return tasksMarkdown;
  if (path === specsPath) return specsMarkdown;
  throw Object.assign(new Error(`unexpected read: ${path}`), { code: "ENOENT" });
}

test("loads plan snapshot from official status artifacts with no writes", async () => {
  const writes: string[] = [];
  const reads: string[] = [];
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => healthy[args.join(" ") as keyof typeof healthy] ?? { code: 1, stdout: "", stderr: "unexpected" },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 1000, nlink: 1 }),
    readText: async (path) => {
      reads.push(path);
      return skillText(path);
    },
  });

  const snapshot = await boundary.loadTestAndGatePlan({ cwd: "/project/src", changeId: "plan-change" });
  expect(snapshot).toMatchObject({
    changeId: "plan-change",
    testIntensity: "standard",
    gateStrictness: "required",
    cases: [{ id: "TC-1" }, { id: "TC-2" }, { id: "TC-3" }, { id: "TC-4" }],
    gates: expect.arrayContaining([expect.objectContaining({ id: "G-1", floor: "openspec" })]),
  });
  expect(snapshot.digest).toMatch(/^[a-f0-9]{64}$/u);
  expect(reads).toEqual(expect.arrayContaining([designPath, tasksPath, specsPath]));
  expect(writes).toEqual([]);
});

test("revalidates current-scope plan digest without creating a parallel store", async () => {
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => healthy[args.join(" ") as keyof typeof healthy] ?? { code: 1, stdout: "", stderr: "unexpected" },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 1000, nlink: 1 }),
    readText: async (path) => skillText(path),
  });

  const snapshot = await boundary.loadTestAndGatePlan({ cwd: "/project", changeId: "plan-change" });
  await expect(boundary.revalidateTestAndGatePlan({
    cwd: "/project",
    changeId: "plan-change",
    planDigest: snapshot.digest,
    selectedTaskIds: ["1.1", "1.2"],
  })).resolves.toMatchObject({ digest: snapshot.digest, changeId: "plan-change" });

  await expect(boundary.revalidateTestAndGatePlan({
    cwd: "/project",
    changeId: "plan-change",
    planDigest: "0".repeat(64),
    selectedTaskIds: ["1.1", "1.2"],
  })).rejects.toThrow(/PLAN_DRIFT|plan changed/iu);

  await expect(boundary.revalidateTestAndGatePlan({
    cwd: "/project",
    changeId: "plan-change",
    planDigest: snapshot.digest,
    selectedTaskIds: ["1.1", "9.9"],
  })).rejects.toThrow(/PLAN_SCOPE|selected task/iu);
});

test.each([
  ["symlink design", { path: designPath, info: { isFile: (): boolean => true, isSymbolicLink: (): boolean => true, size: 10, nlink: 1 } }, /regular non-symbolic-link/u],
  ["escape design", { path: designPath, info: { isFile: (): boolean => true, isSymbolicLink: (): boolean => false, size: 10, nlink: 1 }, overridePath: "/outside/design.md" }, /escapes project root/u],
  ["missing design path", { path: designPath, info: { isFile: (): boolean => true, isSymbolicLink: (): boolean => false, size: 10, nlink: 1 }, dropDesign: true }, /no resolved design artifact/u],
  ["oversized design", { path: designPath, info: { isFile: (): boolean => true, isSymbolicLink: (): boolean => false, size: 2_000_000, nlink: 1 } }, /exceeds 1 MiB/u],
] as const)("rejects unsafe plan artifact %s", async (_name, config, message) => {
  const status = {
    ...healthy,
    "status --change plan-change --json": {
      code: 0,
      stderr: "",
      stdout: JSON.stringify({
        changeName: "plan-change",
        isComplete: true,
        artifactPaths: {
          design: "dropDesign" in config && config.dropDesign
            ? {}
            : { resolvedOutputPath: "overridePath" in config && config.overridePath ? config.overridePath : designPath },
          tasks: { resolvedOutputPath: tasksPath },
          specs: {
            resolvedOutputPath: "/project/openspec/changes/plan-change/specs/**/*.md",
            existingOutputPaths: [specsPath],
          },
        },
      }),
    },
  };
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => status[args.join(" ") as keyof typeof status] ?? { code: 1, stdout: "", stderr: "" },
    inspectPath: async (path) => {
      if (path === designPath || ("overridePath" in config && path === config.overridePath)) return config.info;
      return { isFile: () => true, isSymbolicLink: () => false, size: 1000, nlink: 1 };
    },
    readText: async (path) => skillText(path),
  });
  await expect(boundary.loadTestAndGatePlan({ cwd: "/project", changeId: "plan-change" })).rejects.toThrow(message);
});

test("returns actionable diagnostics for malformed official plan content", async () => {
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => healthy[args.join(" ") as keyof typeof healthy] ?? { code: 1, stdout: "", stderr: "" },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 1000, nlink: 1 }),
    readText: async (path) => {
      if (path === designPath) return "## Design\n\nNo plan section.\n";
      return skillText(path);
    },
  });
  await expect(boundary.loadTestAndGatePlan({ cwd: "/project", changeId: "plan-change" }))
    .rejects.toThrow(/PLAN_MISSING_SECTION/u);
});

test("maps selected-task acceptance and rejects incomplete current-scope coverage", async () => {
  const partialDesign = designMarkdown.replace(
    /#### TC-2: Rejects incomplete acceptance coverage[\s\S]*?(?=#### TC-3:)/u,
    "",
  );
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => healthy[args.join(" ") as keyof typeof healthy] ?? { code: 1, stdout: "", stderr: "" },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 1000, nlink: 1 }),
    readText: async (path) => (path === designPath ? partialDesign : skillText(path)),
  });
  await expect(boundary.loadTestAndGatePlan({ cwd: "/project", changeId: "plan-change" }))
    .rejects.toThrow(/PLAN_COVERAGE_INCOMPLETE: task:1.2|PLAN_COVERAGE_INCOMPLETE: scenario:Concrete test-case explanation\/Acceptance scenario has no case/u);
});
