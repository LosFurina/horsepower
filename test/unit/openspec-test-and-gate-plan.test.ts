import { createHash } from "node:crypto";
import { expect, test } from "vitest";

const VALID_PLAN = `## Context

Unrelated design prose that must not affect the digest.

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

#### TC-3: Covers remaining boundary scenarios
- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User selects custom profiles, scenario:User-confirmed OpenSpec test-and-gate plan/User cancels or does not confirm, scenario:User-confirmed OpenSpec test-and-gate plan/A prior change had a confirmed plan, scenario:Concrete test-case explanation/Test case is presented for confirmation, scenario:Concrete test-case explanation/One case covers multiple scenarios, scenario:Concrete test-case explanation/Planned command is not yet final, scenario:Explicit gate explanation and mandatory floors/Gate profile is explained, scenario:Explicit gate explanation and mandatory floors/Release-affecting change selects release gates, scenario:Explicit gate explanation and mandatory floors/Custom gate weakens a mandatory floor, scenario:Explicit gate explanation and mandatory floors/Waiver is permitted, scenario:Official-artifact ownership and bounded plan parsing/Valid plan is loaded, scenario:Official-artifact ownership and bounded plan parsing/Plan is malformed, scenario:Official-artifact ownership and bounded plan parsing/Agent or reviewer supplies a separate plan, scenario:Official-artifact ownership and bounded plan parsing/Plan is observed repeatedly, scenario:Relevant plan drift requires renewed confirmation/Test case or gate changes after confirmation, scenario:Relevant plan drift requires renewed confirmation/Only unrelated prose changes, scenario:Relevant plan drift requires renewed confirmation/Drift occurs during implementation
- level: failure-path
- purpose: Exercise remaining in-scope scenarios through focused parser and boundary checks
- preconditions: Fixtures covering each mapped scenario
- action: Run focused unit tests for each mapped scenario path
- expected: Every mapped scenario has concrete expected behavior and failure meaning
- failure: Scenario accepted without a concrete case or justified non-applicability
- disposition: required

#### TC-4: Exercises selected behavior end to end
- maps: task:1.1
- level: e2e
- purpose: Prove the standard profile includes a selected end-to-end behavior path
- preconditions: Official Pi fixture with the production extension loaded
- action: Invoke the production campaign confirmation path
- expected: One confirmed campaign and kickoff preserve the selected plan facts
- failure: Unit-only evidence misses an integration or UI authority defect
- disposition: required

### Non-Applicability

#### NA-1: Release packaging deferred
- covers: task:6.5
- reason: Immutable alpha packaging is out of scope for the parser boundary slice

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

## Goals / Non-Goals

More unrelated prose after the plan section.
`;

const ACCEPTANCE = {
  requirements: [
    {
      title: "User-confirmed OpenSpec test-and-gate plan",
      scenarios: [
        "User confirms recommended profiles",
        "User selects custom profiles",
        "User cancels or does not confirm",
        "A prior change had a confirmed plan",
      ],
    },
    {
      title: "Concrete test-case explanation",
      scenarios: [
        "Test case is presented for confirmation",
        "Acceptance scenario has no case",
        "One case covers multiple scenarios",
        "Planned command is not yet final",
      ],
    },
    {
      title: "Explicit gate explanation and mandatory floors",
      scenarios: [
        "Gate profile is explained",
        "Release-affecting change selects release gates",
        "Custom gate weakens a mandatory floor",
        "Waiver is permitted",
      ],
    },
    {
      title: "Official-artifact ownership and bounded plan parsing",
      scenarios: [
        "Valid plan is loaded",
        "Plan is malformed",
        "Agent or reviewer supplies a separate plan",
        "Plan is observed repeatedly",
      ],
    },
    {
      title: "Relevant plan drift requires renewed confirmation",
      scenarios: [
        "Test case or gate changes after confirmation",
        "Only unrelated prose changes",
        "Drift occurs during implementation",
      ],
    },
  ],
  taskIds: ["1.1", "1.2", "6.5"],
};

function stripSection(source: string, heading: string): string {
  return source.replace(new RegExp(`^#### ${heading}[\\s\\S]*?(?=^#### |^### |^## |$(?![\\s\\S]))`, "mu"), "");
}

test("parses documented Test and Gate Plan grammar with stable profiles, ordered IDs, mappings, and deterministic digests", async () => {
  const { parseTestAndGatePlan, normalizeTestAndGatePlanDigest } = await import("../../src/openspec/test-and-gate-plan.js");
  const first = parseTestAndGatePlan(VALID_PLAN, { changeId: "confirm-openspec-test-and-gate-plan", acceptance: ACCEPTANCE });
  const second = parseTestAndGatePlan(VALID_PLAN.replaceAll("  ", " "), { changeId: "confirm-openspec-test-and-gate-plan", acceptance: ACCEPTANCE });

  expect(first).toMatchObject({
    changeId: "confirm-openspec-test-and-gate-plan",
    testIntensity: "standard",
    gateStrictness: "required",
    cases: [
      {
        id: "TC-1",
        title: "Confirms recommended profiles",
        maps: [
          "scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles",
          "task:1.1",
        ],
        level: "unit",
        disposition: "required",
      },
      { id: "TC-2", level: "integration", disposition: "required" },
      { id: "TC-3", level: "failure-path", disposition: "required" },
      { id: "TC-4", level: "e2e", disposition: "required" },
    ],
    nonApplicability: [{ id: "NA-1", covers: ["task:6.5"] }],
  });
  expect(first.gates).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "G-1",
      maps: [
        "scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles",
        "task:1.1",
      ],
      floor: "openspec",
      disposition: "required",
      phase: "campaign",
    }),
    expect.objectContaining({ id: "G-6", floor: "e2e", phase: "completion" }),
  ]));
  expect(first.gates.every((gate) => Array.isArray(gate.maps) && gate.maps.length > 0)).toBe(true);
  expect(first.gates.map((item) => item.id)).toEqual(["G-1", "G-2", "G-3", "G-4", "G-5", "G-6"]);
  expect(first.digest).toMatch(/^[a-f0-9]{64}$/u);
  expect(second.digest).toBe(first.digest);
  expect(normalizeTestAndGatePlanDigest(first)).toBe(first.digest);
  expect(JSON.stringify(first)).not.toContain("Unrelated design prose");
});

test("accepts all stable profile values and ordered TC/G IDs", async () => {
  const { parseTestAndGatePlan } = await import("../../src/openspec/test-and-gate-plan.js");
  for (const testIntensity of ["targeted", "standard", "exhaustive", "custom"] as const) {
    for (const gateStrictness of ["required", "strict", "release", "custom"] as const) {
      const regressionGate = `#### G-7: Full regression
- maps: task:1.1
- intent: run the complete repository regression suites
- scope: full current repository
- pass: every applicable regression suite exits successfully
- disposition: required
- phase: completion
- waiver: none
- floor: regression

`;
      const releaseGate = `#### G-8: Release packaging
- maps: task:1.1
- intent: deterministic release archive and install checks
- scope: packaged artifacts
- pass: archive privacy and immutable install pass
- disposition: required
- phase: release
- waiver: none
- floor: release

`;
      let source = VALID_PLAN
        .replace("testIntensity: standard", `testIntensity: ${testIntensity}`)
        .replace("gateStrictness: required", `gateStrictness: ${gateStrictness}`);
      if (gateStrictness === "strict" || gateStrictness === "release") source = source.replace("## Goals / Non-Goals", `${regressionGate}## Goals / Non-Goals`);
      if (gateStrictness === "release") source = source.replace("## Goals / Non-Goals", `${releaseGate}## Goals / Non-Goals`);
      if (gateStrictness === "custom") source = source.replace("## Goals / Non-Goals", `${regressionGate}${releaseGate}## Goals / Non-Goals`);
      if (testIntensity === "exhaustive") {
        const extraLevels = ["boundary", "adversarial", "concurrency", "platform", "compatibility", "regression"];
        source = source.replace("### Non-Applicability", `${extraLevels.map((level, index) => `#### TC-${index + 5}: Exhaustive ${level}
- maps: task:1.1
- level: ${level}
- purpose: Prove exhaustive profile includes ${level} coverage
- preconditions: concrete ${level} fixture available
- action: exercise the ${level} path
- expected: observable ${level} result succeeds
- failure: missing exhaustive ${level} coverage
- disposition: required`).join("\n\n")}\n\n### Non-Applicability`);
      }
      const plan = parseTestAndGatePlan(source, { changeId: "c", acceptance: ACCEPTANCE });
      expect(plan.testIntensity).toBe(testIntensity);
      expect(plan.gateStrictness).toBe(gateStrictness);
      expect(plan.cases.map((item) => item.id).slice(0, 3)).toEqual(["TC-1", "TC-2", "TC-3"]);
      expect(plan.gates[0]?.id).toBe("G-1");
      if (testIntensity === "exhaustive") expect(plan.cases.map((item) => item.id)).toContain("TC-10");
      if (gateStrictness === "strict" || gateStrictness === "release" || gateStrictness === "custom") expect(plan.gates.map((item) => item.floor)).toContain("regression");
      if (gateStrictness === "release" || gateStrictness === "custom") expect(plan.gates.map((item) => item.floor)).toContain("release");
    }
  }
});

test.each([
  ["missing section", "## Design\n\nNo plan here.\n", /PLAN_MISSING_SECTION/u],
  ["duplicate TC", VALID_PLAN.replace("#### TC-2:", "#### TC-1:"), /PLAN_DUPLICATE_ID: TC-1/u],
  ["duplicate G", VALID_PLAN.replace("#### G-2:", "#### G-1:"), /PLAN_DUPLICATE_ID: G-1/u],
  ["unknown intensity", VALID_PLAN.replace("testIntensity: standard", "testIntensity: heavy"), /PLAN_UNKNOWN_ENUM: testIntensity/u],
  ["unknown strictness", VALID_PLAN.replace("gateStrictness: required", "gateStrictness: soft"), /PLAN_UNKNOWN_ENUM: gateStrictness/u],
  ["unknown level", VALID_PLAN.replace("level: unit", "level: smoke"), /PLAN_UNKNOWN_ENUM: level/u],
  ["unknown disposition", VALID_PLAN.replace("disposition: required", "disposition: optional"), /PLAN_UNKNOWN_ENUM: disposition/u],
  ["unknown phase", VALID_PLAN.replace("phase: campaign", "phase: forever"), /PLAN_UNKNOWN_ENUM: phase/u],
  ["unknown floor", VALID_PLAN.replace("floor: openspec", "floor: maybe"), /PLAN_UNKNOWN_ENUM: floor/u],
  ["generic purpose", VALID_PLAN.replace("purpose: Prove profile values are recorded only after affirmative user selection", "purpose: test it"), /PLAN_GENERIC_EXPLANATION: TC-1/u],
  ["incomplete case", VALID_PLAN.replace("- expected: Snapshot contains exact machine profile values and ordered cases\n", ""), /PLAN_MISSING_FIELD: TC-1\.expected/u],
  ["unresolved mapping", VALID_PLAN.replace("task:1.1", "task:9.9"), /PLAN_UNRESOLVED_MAPPING: task:9.9/u],
  ["conflicting sections", `${VALID_PLAN}\n## Test and Gate Plan\n\n### Profiles\n- testIntensity: targeted\n- gateStrictness: required\n`, /PLAN_CONFLICTING_SECTIONS/u],
  ["unknown case id shape", VALID_PLAN.replace("#### TC-1:", "#### TEST-1:"), /PLAN_MALFORMED_ID/u],
  ["empty maps", VALID_PLAN.replace(
    "- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1",
    "- maps:",
  ), /PLAN_MISSING_FIELD: TC-1\.maps/u],
  ["missing gate maps", VALID_PLAN.replace(
    "#### G-1: Strict OpenSpec validation\n- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1\n- intent:",
    "#### G-1: Strict OpenSpec validation\n- intent:",
  ), /PLAN_MISSING_FIELD: G-1\.maps/u],
  ["unresolved gate maps", VALID_PLAN.replace(
    "#### G-1: Strict OpenSpec validation\n- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1\n",
    "#### G-1: Strict OpenSpec validation\n- maps: task:9.9\n",
  ), /PLAN_UNRESOLVED_MAPPING: task:9.9/u],
  ["unsafe path intent", VALID_PLAN.replace("intent: openspec validate --strict", "intent: cat /etc/passwd"), /PLAN_UNSAFE_FIELD: G-1\.intent/u],
  ["markdown link", VALID_PLAN.replace("purpose: Prove profile values are recorded only after affirmative user selection", "purpose: See [docs](https://example.com)"), /PLAN_UNSAFE_FIELD: TC-1\.purpose/u],
] as const)("rejects %s with actionable diagnostics", async (_name, source, message) => {
  const { parseTestAndGatePlan } = await import("../../src/openspec/test-and-gate-plan.js");
  expect(() => parseTestAndGatePlan(source, { changeId: "c", acceptance: ACCEPTANCE })).toThrow(message);
});

test("enforces count, field, and file bounds without guessing", async () => {
  const { parseTestAndGatePlan, TEST_AND_GATE_PLAN_BOUNDS } = await import("../../src/openspec/test-and-gate-plan.js");
  expect(TEST_AND_GATE_PLAN_BOUNDS).toMatchObject({
    maxBytes: 1_048_576,
    maxCases: 100,
    maxGates: 100,
    maxNonApplicability: 100,
    maxMappingsPerEntry: 20,
    maxFieldBytes: 500,
  });

  expect(() => parseTestAndGatePlan("x".repeat(1_048_577), { changeId: "c", acceptance: ACCEPTANCE }))
    .toThrow(/PLAN_OVERSIZED|exceeds 1 MiB/u);

  const tooManyMappings = Array.from({ length: 21 }, (_, index) => `task:${index + 1}`).join(", ");
  expect(() => parseTestAndGatePlan(
    VALID_PLAN.replace(
      "- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1",
      `- maps: ${tooManyMappings}`,
    ),
    { changeId: "c", acceptance: { ...ACCEPTANCE, taskIds: Array.from({ length: 21 }, (_, index) => String(index + 1)) } },
  )).toThrow(/PLAN_BOUNDS: TC-1\.maps/u);

  const longField = "🙂".repeat(126);
  expect(() => parseTestAndGatePlan(
    VALID_PLAN.replace("purpose: Prove profile values are recorded only after affirmative user selection", `purpose: ${longField}`),
    { changeId: "c", acceptance: ACCEPTANCE },
  )).toThrow(/PLAN_BOUNDS: TC-1\.purpose/u);

  const manyCases = Array.from({ length: 101 }, (_, index) => `#### TC-${index + 1}: Case ${index + 1}
- maps: task:1.1
- level: unit
- purpose: Prove bounded case ${index + 1} remains concrete and mapped
- preconditions: fixture ${index + 1}
- action: exercise case ${index + 1}
- expected: observable result ${index + 1}
- failure: missing coverage ${index + 1}
- disposition: required`).join("\n\n");
  const oversizedCases = VALID_PLAN.replace(
    /### Test Cases[\s\S]*?### Non-Applicability/u,
    `### Test Cases\n\n${manyCases}\n\n### Non-Applicability`,
  );
  expect(() => parseTestAndGatePlan(oversizedCases, { changeId: "c", acceptance: ACCEPTANCE }))
    .toThrow(/PLAN_BOUNDS: cases/u);
});

test("profile floors expand concretely and cannot weaken mandatory floors", async () => {
  const { parseTestAndGatePlan, expandProfileFloors } = await import("../../src/openspec/test-and-gate-plan.js");

  expect(expandProfileFloors({ testIntensity: "targeted", gateStrictness: "required" })).toEqual({
    requiredGateFloors: ["openspec", "privacy", "security", "compatibility", "terminal-truth", "e2e"],
    requiredCaseLevels: [],
  });
  expect(expandProfileFloors({ testIntensity: "standard", gateStrictness: "strict" })).toMatchObject({
    requiredGateFloors: expect.arrayContaining(["regression"]),
    requiredCaseLevels: ["unit", "integration", "failure-path", "e2e"],
  });
  expect(expandProfileFloors({ testIntensity: "exhaustive", gateStrictness: "release" })).toMatchObject({
    requiredGateFloors: expect.arrayContaining(["regression", "release", "e2e", "openspec"]),
    requiredCaseLevels: expect.arrayContaining(["unit", "integration", "failure-path", "e2e", "boundary", "adversarial", "concurrency", "platform", "compatibility", "regression"]),
  });

  const weakCustom = VALID_PLAN
    .replace("gateStrictness: required", "gateStrictness: custom")
    .replace("- floor: e2e", "- floor: none")
    .replace("- disposition: required\n- phase: completion\n- waiver: concrete reason plus mapped alternative evidence under verification contract\n- floor: none", "- disposition: advisory\n- phase: completion\n- waiver: none\n- floor: none");
  expect(() => parseTestAndGatePlan(weakCustom, { changeId: "c", acceptance: ACCEPTANCE }))
    .toThrow(/PLAN_FLOOR_WEAKENED: e2e/u);

  const missingRelease = VALID_PLAN.replace("gateStrictness: required", "gateStrictness: release");
  expect(() => parseTestAndGatePlan(missingRelease, { changeId: "c", acceptance: ACCEPTANCE }))
    .toThrow(/PLAN_FLOOR_WEAKENED: regression/u);

  const targetedOnly = VALID_PLAN
    .replace("testIntensity: standard", "testIntensity: targeted")
    .replace("level: integration", "level: unit")
    .replace("level: failure-path", "level: unit");
  expect(() => parseTestAndGatePlan(targetedOnly, { changeId: "c", acceptance: ACCEPTANCE })).not.toThrow();

  const standardWithoutUnit = VALID_PLAN.replace("level: unit", "level: integration");
  expect(() => parseTestAndGatePlan(standardWithoutUnit, { changeId: "c", acceptance: ACCEPTANCE }))
    .toThrow(/PLAN_PROFILE_INCOMPLETE: unit/u);
});

test("semantic drift invalidates digest while unrelated prose and formatting do not", async () => {
  const { parseTestAndGatePlan } = await import("../../src/openspec/test-and-gate-plan.js");
  const base = parseTestAndGatePlan(VALID_PLAN, { changeId: "c", acceptance: ACCEPTANCE });

  const proseOnly = parseTestAndGatePlan(
    VALID_PLAN.replace("Unrelated design prose that must not affect the digest.", "Different prose outside the plan."),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(proseOnly.digest).toBe(base.digest);

  const spacingOnly = parseTestAndGatePlan(
    VALID_PLAN.replace("- purpose: Prove profile values are recorded only after affirmative user selection", "-   purpose:   Prove   profile values are recorded only after affirmative user selection  "),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(spacingOnly.digest).toBe(base.digest);

  const profileDrift = parseTestAndGatePlan(
    VALID_PLAN.replace("testIntensity: standard", "testIntensity: targeted"),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(profileDrift.digest).not.toBe(base.digest);

  const caseDrift = parseTestAndGatePlan(
    VALID_PLAN.replace("action: Parse and present expanded plan then accept confirmed profiles", "action: Different command intent for confirmation"),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(caseDrift.digest).not.toBe(base.digest);

  const mappingDrift = parseTestAndGatePlan(
    VALID_PLAN.replace("task:1.1", "task:1.2").replace(
      "scenario:Concrete test-case explanation/Acceptance scenario has no case, task:1.2",
      "scenario:Concrete test-case explanation/Acceptance scenario has no case, task:1.1",
    ),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(mappingDrift.digest).not.toBe(base.digest);

  const fixtureDrift = parseTestAndGatePlan(
    VALID_PLAN.replace("preconditions: OpenSpec change with draft plan section present", "preconditions: Different fixture assumptions"),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(fixtureDrift.digest).not.toBe(base.digest);

  const expectedDrift = parseTestAndGatePlan(
    VALID_PLAN.replace("expected: Snapshot contains exact machine profile values and ordered cases", "expected: Different observable result"),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(expectedDrift.digest).not.toBe(base.digest);

  const waiverDrift = parseTestAndGatePlan(
    VALID_PLAN.replace(
      "waiver: concrete reason plus mapped alternative evidence under verification contract",
      "waiver: only when environment lacks Pi binary",
    ),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(waiverDrift.digest).not.toBe(base.digest);

  const gateIntentSwap = parseTestAndGatePlan(
    VALID_PLAN
      .replace("intent: openspec validate --strict", "intent: TEMP_INTENT")
      .replace("intent: npm run release privacy checks", "intent: openspec validate --strict")
      .replace("intent: TEMP_INTENT", "intent: npm run release privacy checks"),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(gateIntentSwap.digest).not.toBe(base.digest);

  const gateMapsDrift = parseTestAndGatePlan(
    VALID_PLAN.replace(
      "#### G-1: Strict OpenSpec validation\n- maps: scenario:User-confirmed OpenSpec test-and-gate plan/User confirms recommended profiles, task:1.1\n",
      "#### G-1: Strict OpenSpec validation\n- maps: task:1.2\n",
    ),
    { changeId: "c", acceptance: ACCEPTANCE },
  );
  expect(gateMapsDrift.digest).not.toBe(base.digest);
  expect(createHash("sha256").update(VALID_PLAN).digest("hex")).not.toBe(base.digest);
});

test("projects explicit gate acceptance maps into selected-task campaign authority", async () => {
  const { campaignPlanFromTestAndGatePlan, parseTestAndGatePlan } = await import("../../src/openspec/test-and-gate-plan.js");
  const plan = parseTestAndGatePlan(VALID_PLAN, { changeId: "c", acceptance: ACCEPTANCE });
  const snapshot = campaignPlanFromTestAndGatePlan(plan, ["1.1"]);

  expect(snapshot.caseRefs).toEqual(["TC-1", "TC-4"]);
  expect(snapshot.gateRefs).toEqual(["G-1", "G-2", "G-3", "G-4", "G-5", "G-6"]);
  expect(snapshot.selectedTaskMappings).toEqual([{
    taskId: "1.1",
    caseRefs: ["TC-1", "TC-4"],
    gateRefs: ["G-1", "G-2", "G-3", "G-4", "G-5", "G-6"],
    nonApplicabilityRefs: [],
  }]);
});

test("requires complete in-scope coverage or concrete non-applicability diagnostics", async () => {
  const { parseTestAndGatePlan } = await import("../../src/openspec/test-and-gate-plan.js");
  const incomplete = stripSection(VALID_PLAN, "TC-2: Rejects incomplete acceptance coverage");
  expect(() => parseTestAndGatePlan(incomplete, { changeId: "c", acceptance: ACCEPTANCE }))
    .toThrow(/PLAN_COVERAGE_INCOMPLETE: scenario:Concrete test-case explanation\/Acceptance scenario has no case/u);

  const missingNa = VALID_PLAN.replace(
    /### Non-Applicability[\s\S]*?### Gates/u,
    "### Non-Applicability\n\n### Gates",
  );
  expect(() => parseTestAndGatePlan(missingNa, { changeId: "c", acceptance: ACCEPTANCE }))
    .toThrow(/PLAN_COVERAGE_INCOMPLETE: task:6.5/u);
});
