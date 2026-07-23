export const TEST_PLAN_MACHINE_TOKENS = {
  intensities: ["targeted", "standard", "exhaustive", "custom"],
  strictnesses: ["required", "strict", "release", "custom"],
  cases: ["TC-1", "TC-2"],
  gates: ["G-1", "G-2"],
} as const;

export type AuthoringChoice = {
  testIntensity: typeof TEST_PLAN_MACHINE_TOKENS.intensities[number];
  gateStrictness: typeof TEST_PLAN_MACHINE_TOKENS.strictnesses[number];
};

export const authoringDialogueFixtures = {
  recommended: {
    recommendation: { testIntensity: "standard", gateStrictness: "strict" },
    explanation: "standard covers unit, integration, failure-path, and selected real Pi E2E; strict adds the full applicable suite and permits no unresolved required failure.",
    alternatives: [
      "targeted + required costs less but covers only directly changed acceptance and baseline gates.",
      "exhaustive + release adds boundary, compatibility, packaged-install, rollback, and real-environment coverage.",
    ],
  },
  alternative: {
    selection: { testIntensity: "exhaustive", gateStrictness: "release" },
    explicitSelectionRequired: true,
  },
  custom: {
    selection: { testIntensity: "custom", gateStrictness: "custom" },
    entriesRequired: true,
    mandatoryFloorsMayBeWeakened: false,
  },
} as const;

export const expandedPlanFixture = {
  cases: [
    {
      id: "TC-1", acceptanceRefs: ["explicit-dispatch/User confirms campaign and test plan"], level: "real Pi E2E",
      purpose: "prove explicit combined confirmation grants exactly one campaign authority",
      setup: "apply-ready official OpenSpec fixture with no active campaign",
      action: "select standard, strict, current tasks, and multi_agent; affirm once",
      expectation: "one campaign and one kickoff are observable",
      failureMeaning: "implicit or duplicated implementation authority",
      disposition: "required",
    },
    {
      id: "TC-2", acceptanceRefs: ["explicit-dispatch/User rejects plan during campaign creation"], level: "real Pi E2E",
      purpose: "prove cancellation is side-effect-free",
      setup: "apply-ready fixture and an existing campaign snapshot",
      action: "cancel the combined confirmation",
      expectation: "no new campaign/kickoff and the existing snapshot is unchanged",
      failureMeaning: "cancellation mutated campaign authority",
      disposition: "required",
    },
  ],
  gates: [
    {
      id: "G-1",
      maps: ["explicit-dispatch/User confirms campaign and test plan", "task:4.1"],
      intent: "run focused authoring and localization tests",
      scope: "authoring and localization",
      pass: "exit 0",
      disposition: "required",
      phase: "implementation",
      waiver: "none",
    },
    {
      id: "G-2",
      maps: ["explicit-dispatch/User rejects plan during campaign creation", "task:4.3"],
      intent: "run real Pi campaign/drift/completion acceptance",
      scope: "campaign confirmation and completion",
      pass: "all claim mappings pass",
      disposition: "required",
      phase: "completion",
      waiver: "Pi unavailable with concrete mapped alternative evidence only",
    },
  ],
} as const;

export type AuthoringOutcome =
  | { status: "confirmed"; choice: AuthoringChoice }
  | { status: "unconfirmed"; reason: "canceled" | "unsupported" | "not-affirmed" };

export function authoringOutcome(choice: unknown, affirmed: boolean | undefined): AuthoringOutcome {
  if (choice === undefined || choice === null) return { status: "unconfirmed", reason: "canceled" };
  if (typeof choice !== "object") return { status: "unconfirmed", reason: "unsupported" };
  const value = choice as Partial<AuthoringChoice>;
  if (!(TEST_PLAN_MACHINE_TOKENS.intensities as readonly unknown[]).includes(value.testIntensity)
    || !(TEST_PLAN_MACHINE_TOKENS.strictnesses as readonly unknown[]).includes(value.gateStrictness)) {
    return { status: "unconfirmed", reason: "unsupported" };
  }
  if (affirmed !== true) return { status: "unconfirmed", reason: "not-affirmed" };
  return { status: "confirmed", choice: value as AuthoringChoice };
}

export const realPiAcceptanceScenarios = [
  "authoring recommended/alternative/custom choice and concrete case explanation",
  "authoring cancellation and non-affirmation",
  "successful combined campaign confirmation",
  "relevant semantic drift blocks dispatch",
  "prose-only drift preserves authority",
  "claim-matched required TC-* and G-* completion evidence",
] as const;
