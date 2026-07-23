import { createHash } from "node:crypto";

export const TEST_AND_GATE_PLAN_BOUNDS = {
  maxBytes: 1024 * 1024,
  maxCases: 100,
  maxGates: 100,
  maxNonApplicability: 100,
  maxMappingsPerEntry: 20,
  maxFieldBytes: 500,
} as const;

export const TEST_INTENSITY_VALUES = ["targeted", "standard", "exhaustive", "custom"] as const;
export const GATE_STRICTNESS_VALUES = ["required", "strict", "release", "custom"] as const;
export const TEST_LEVEL_VALUES = [
  "unit",
  "integration",
  "failure-path",
  "e2e",
  "boundary",
  "adversarial",
  "concurrency",
  "platform",
  "compatibility",
  "regression",
] as const;
export const DISPOSITION_VALUES = ["required", "advisory"] as const;
export const GATE_PHASE_VALUES = ["authoring", "campaign", "dispatch", "completion", "release"] as const;
export const GATE_FLOOR_VALUES = [
  "openspec",
  "privacy",
  "security",
  "compatibility",
  "terminal-truth",
  "e2e",
  "regression",
  "release",
  "none",
] as const;

export type TestIntensity = (typeof TEST_INTENSITY_VALUES)[number];
export type GateStrictness = (typeof GATE_STRICTNESS_VALUES)[number];
export type TestLevel = (typeof TEST_LEVEL_VALUES)[number];
export type PlanDisposition = (typeof DISPOSITION_VALUES)[number];
export type GatePhase = (typeof GATE_PHASE_VALUES)[number];
export type GateFloor = (typeof GATE_FLOOR_VALUES)[number];

export interface AcceptanceInventory {
  requirements: readonly {
    title: string;
    scenarios: readonly string[];
  }[];
  taskIds: readonly string[];
}

export interface TestCasePlanEntry {
  id: string;
  title: string;
  maps: readonly string[];
  level: TestLevel;
  purpose: string;
  preconditions: string;
  action: string;
  expected: string;
  failure: string;
  disposition: PlanDisposition;
}

export interface GatePlanEntry {
  id: string;
  title: string;
  /** Explicit acceptance refs only; never inferred from scope prose. */
  maps: readonly string[];
  intent: string;
  scope: string;
  pass: string;
  disposition: PlanDisposition;
  phase: GatePhase;
  waiver: string;
  floor: GateFloor;
}

export interface NonApplicabilityEntry {
  id: string;
  title: string;
  covers: readonly string[];
  reason: string;
}

export interface TestAndGatePlan {
  changeId: string;
  testIntensity: TestIntensity;
  gateStrictness: GateStrictness;
  cases: readonly TestCasePlanEntry[];
  gates: readonly GatePlanEntry[];
  nonApplicability: readonly NonApplicabilityEntry[];
  coverageRefs: readonly string[];
  digest: string;
}

export interface ParseTestAndGatePlanContext {
  changeId: string;
  acceptance: AcceptanceInventory;
}

export interface ProfileFloorExpansion {
  requiredGateFloors: readonly Exclude<GateFloor, "none">[];
  requiredCaseLevels: readonly TestLevel[];
}

const SECTION_HEADING = "## Test and Gate Plan";
const GENERIC_PHRASES = [
  /^test it$/iu,
  /^add tests?$/iu,
  /^run tests?$/iu,
  /^cover it$/iu,
  /^verify it$/iu,
  /^check it$/iu,
  /^tests?$/iu,
];
const UNSAFE_FIELD = /https?:\/\/|\[[^\]]+\]\([^)]+\)|\/etc\/|\/proc\/|\.\.\/|~\/|\0/iu;
const CASE_HEADING = /^####\s+(TC-\d+):\s+(.+?)\s*$/u;
const GATE_HEADING = /^####\s+(G-\d+):\s+(.+?)\s*$/u;
const NA_HEADING = /^####\s+(NA-\d+):\s+(.+?)\s*$/u;
const FIELD_LINE = /^-\s+([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*?)\s*$/u;
const PROFILE_LINE = /^-\s+(testIntensity|gateStrictness):\s*(\S+)\s*$/u;

function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

function boundedField(value: string, label: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) fail("PLAN_MISSING_FIELD", label);
  if (Buffer.byteLength(normalized, "utf8") > TEST_AND_GATE_PLAN_BOUNDS.maxFieldBytes) {
    fail("PLAN_BOUNDS", label);
  }
  if (UNSAFE_FIELD.test(normalized)) fail("PLAN_UNSAFE_FIELD", label);
  return normalized;
}

function parseList(value: string, label: string): string[] {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) fail("PLAN_MISSING_FIELD", label);
  const items = normalized.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) fail("PLAN_MISSING_FIELD", label);
  if (items.length > TEST_AND_GATE_PLAN_BOUNDS.maxMappingsPerEntry) fail("PLAN_BOUNDS", label);
  if (new Set(items).size !== items.length) fail("PLAN_DUPLICATE_MAPPING", label);
  for (const item of items) {
    if (Buffer.byteLength(item, "utf8") > TEST_AND_GATE_PLAN_BOUNDS.maxFieldBytes) fail("PLAN_BOUNDS", label);
    if (UNSAFE_FIELD.test(item)) fail("PLAN_UNSAFE_FIELD", label);
  }
  return items;
}

function asEnum<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!(allowed as readonly string[]).includes(value)) fail("PLAN_UNKNOWN_ENUM", label);
  return value as T;
}

function rejectGeneric(value: string, label: string): string {
  const normalized = boundedField(value, label);
  if (GENERIC_PHRASES.some((pattern) => pattern.test(normalized))) fail("PLAN_GENERIC_EXPLANATION", label.split(".")[0]!);
  return normalized;
}

function extractPlanSection(source: string): string {
  if (Buffer.byteLength(source, "utf8") > TEST_AND_GATE_PLAN_BOUNDS.maxBytes) {
    fail("PLAN_OVERSIZED", "exceeds 1 MiB");
  }
  const lines = source.split(/\r?\n/u);
  const starts: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.trim() === SECTION_HEADING) starts.push(index);
  }
  if (starts.length === 0) fail("PLAN_MISSING_SECTION");
  if (starts.length > 1) fail("PLAN_CONFLICTING_SECTIONS");
  const start = starts[0]!;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(lines[index]!) && lines[index]!.trim() !== SECTION_HEADING) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function splitBlocks(section: string): { profiles: string[]; cases: string[]; gates: string[]; nonApplicability: string[] } {
  const lines = section.split(/\r?\n/u);
  const profiles: string[] = [];
  const cases: string[] = [];
  const gates: string[] = [];
  const nonApplicability: string[] = [];
  let mode: "none" | "profiles" | "cases" | "gates" | "na" = "none";
  let current: string[] | undefined;

  const flush = () => {
    if (!current || current.length === 0) return;
    const block = current.join("\n");
    if (mode === "cases") cases.push(block);
    else if (mode === "gates") gates.push(block);
    else if (mode === "na") nonApplicability.push(block);
    current = undefined;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "### Profiles") {
      flush();
      mode = "profiles";
      current = undefined;
      continue;
    }
    if (trimmed === "### Test Cases") {
      flush();
      mode = "cases";
      current = undefined;
      continue;
    }
    if (trimmed === "### Gates") {
      flush();
      mode = "gates";
      current = undefined;
      continue;
    }
    if (trimmed === "### Non-Applicability") {
      flush();
      mode = "na";
      current = undefined;
      continue;
    }
    if (mode === "profiles") {
      if (trimmed.startsWith("- ")) profiles.push(trimmed);
      continue;
    }
    if (mode === "cases" || mode === "gates" || mode === "na") {
      if (trimmed.startsWith("#### ")) {
        flush();
        current = [line];
        continue;
      }
      if (current) current.push(line);
    }
  }
  flush();
  return { profiles, cases, gates, nonApplicability };
}

function parseProfiles(lines: string[]): { testIntensity: TestIntensity; gateStrictness: GateStrictness } {
  let testIntensity: TestIntensity | undefined;
  let gateStrictness: GateStrictness | undefined;
  for (const line of lines) {
    const match = PROFILE_LINE.exec(line);
    if (!match) fail("PLAN_MALFORMED_FIELD", "profiles");
    const key = match[1]!;
    const value = match[2]!;
    if (key === "testIntensity") {
      if (testIntensity) fail("PLAN_DUPLICATE_FIELD", "testIntensity");
      testIntensity = asEnum(value, TEST_INTENSITY_VALUES, "testIntensity");
    } else {
      if (gateStrictness) fail("PLAN_DUPLICATE_FIELD", "gateStrictness");
      gateStrictness = asEnum(value, GATE_STRICTNESS_VALUES, "gateStrictness");
    }
  }
  if (!testIntensity) fail("PLAN_MISSING_FIELD", "testIntensity");
  if (!gateStrictness) fail("PLAN_MISSING_FIELD", "gateStrictness");
  return { testIntensity, gateStrictness };
}

function parseFields(block: string, id: string): { title: string; fields: Record<string, string> } {
  const lines = block.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  const heading = lines[0] ?? "";
  let title = "";
  let idMatch: RegExpExecArray | null = null;
  if (id.startsWith("TC-")) idMatch = CASE_HEADING.exec(heading);
  else if (id.startsWith("G-")) idMatch = GATE_HEADING.exec(heading);
  else idMatch = NA_HEADING.exec(heading);
  if (!idMatch) fail("PLAN_MALFORMED_ID", heading.trim() || id);
  if (idMatch[1] !== id) fail("PLAN_MALFORMED_ID", idMatch[1]!);
  title = boundedField(idMatch[2]!, `${id}.title`);
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const match = FIELD_LINE.exec(line.trim());
    if (!match) fail("PLAN_MALFORMED_FIELD", `${id}`);
    const key = match[1]!;
    if (key in fields) fail("PLAN_DUPLICATE_FIELD", `${id}.${key}`);
    fields[key] = match[2] ?? "";
  }
  return { title, fields };
}

function requireField(fields: Record<string, string>, key: string, id: string): string {
  if (!(key in fields)) fail("PLAN_MISSING_FIELD", `${id}.${key}`);
  return fields[key]!;
}

function parseCase(block: string): TestCasePlanEntry {
  const heading = block.split(/\r?\n/u).find((line) => line.trim().startsWith("#### "))?.trim() ?? "";
  const id = CASE_HEADING.exec(heading)?.[1];
  if (!id) fail("PLAN_MALFORMED_ID", heading || "case");
  const { title, fields } = parseFields(block, id);
  return {
    id,
    title,
    maps: parseList(requireField(fields, "maps", id), `${id}.maps`),
    level: asEnum(boundedField(requireField(fields, "level", id), `${id}.level`), TEST_LEVEL_VALUES, "level"),
    purpose: rejectGeneric(requireField(fields, "purpose", id), `${id}.purpose`),
    preconditions: boundedField(requireField(fields, "preconditions", id), `${id}.preconditions`),
    action: rejectGeneric(requireField(fields, "action", id), `${id}.action`),
    expected: rejectGeneric(requireField(fields, "expected", id), `${id}.expected`),
    failure: rejectGeneric(requireField(fields, "failure", id), `${id}.failure`),
    disposition: asEnum(boundedField(requireField(fields, "disposition", id), `${id}.disposition`), DISPOSITION_VALUES, "disposition"),
  };
}

function parseGate(block: string): GatePlanEntry {
  const heading = block.split(/\r?\n/u).find((line) => line.trim().startsWith("#### "))?.trim() ?? "";
  const id = GATE_HEADING.exec(heading)?.[1];
  if (!id) fail("PLAN_MALFORMED_ID", heading || "gate");
  const { title, fields } = parseFields(block, id);
  return {
    id,
    title,
    maps: parseList(requireField(fields, "maps", id), `${id}.maps`),
    intent: boundedField(requireField(fields, "intent", id), `${id}.intent`),
    scope: boundedField(requireField(fields, "scope", id), `${id}.scope`),
    pass: boundedField(requireField(fields, "pass", id), `${id}.pass`),
    disposition: asEnum(boundedField(requireField(fields, "disposition", id), `${id}.disposition`), DISPOSITION_VALUES, "disposition"),
    phase: asEnum(boundedField(requireField(fields, "phase", id), `${id}.phase`), GATE_PHASE_VALUES, "phase"),
    waiver: boundedField(requireField(fields, "waiver", id), `${id}.waiver`),
    floor: asEnum(boundedField(requireField(fields, "floor", id), `${id}.floor`), GATE_FLOOR_VALUES, "floor"),
  };
}

function parseNonApplicability(block: string): NonApplicabilityEntry {
  const heading = block.split(/\r?\n/u).find((line) => line.trim().startsWith("#### "))?.trim() ?? "";
  const id = NA_HEADING.exec(heading)?.[1];
  if (!id) fail("PLAN_MALFORMED_ID", heading || "non-applicability");
  const { title, fields } = parseFields(block, id);
  return {
    id,
    title,
    covers: parseList(requireField(fields, "covers", id), `${id}.covers`),
    reason: boundedField(requireField(fields, "reason", id), `${id}.reason`),
  };
}

function acceptanceRefs(acceptance: AcceptanceInventory): string[] {
  const refs: string[] = [];
  for (const requirement of acceptance.requirements) {
    for (const scenario of requirement.scenarios) {
      refs.push(`scenario:${requirement.title}/${scenario}`);
    }
  }
  for (const taskId of acceptance.taskIds) refs.push(`task:${taskId}`);
  return refs;
}

function assertResolvedMappings(
  entries: readonly { id: string; maps?: readonly string[]; covers?: readonly string[] }[],
  allowed: ReadonlySet<string>,
): void {
  for (const entry of entries) {
    const refs = entry.maps ?? entry.covers ?? [];
    for (const ref of refs) {
      if (!allowed.has(ref)) fail("PLAN_UNRESOLVED_MAPPING", ref);
    }
  }
}

function assertCoverage(
  cases: readonly TestCasePlanEntry[],
  nonApplicability: readonly NonApplicabilityEntry[],
  acceptance: AcceptanceInventory,
): string[] {
  const required = acceptanceRefs(acceptance);
  const covered = new Set<string>();
  for (const item of cases) for (const ref of item.maps) covered.add(ref);
  for (const item of nonApplicability) for (const ref of item.covers) covered.add(ref);
  for (const ref of required) {
    if (!covered.has(ref)) fail("PLAN_COVERAGE_INCOMPLETE", ref);
  }
  return required;
}

export function expandProfileFloors(input: {
  testIntensity: TestIntensity;
  gateStrictness: GateStrictness;
}): ProfileFloorExpansion {
  const requiredGateFloors: Exclude<GateFloor, "none">[] = [
    "openspec",
    "privacy",
    "security",
    "compatibility",
    "terminal-truth",
    "e2e",
  ];
  if (input.gateStrictness === "strict" || input.gateStrictness === "release") requiredGateFloors.push("regression");
  if (input.gateStrictness === "release") requiredGateFloors.push("release");

  const requiredCaseLevels: TestLevel[] = [];
  if (input.testIntensity === "standard" || input.testIntensity === "exhaustive") {
    requiredCaseLevels.push("unit", "integration", "failure-path", "e2e");
  }
  if (input.testIntensity === "exhaustive") {
    requiredCaseLevels.push("boundary", "adversarial", "concurrency", "platform", "compatibility", "regression");
  }
  if (input.testIntensity === "custom") requiredCaseLevels.push("unit");
  return { requiredGateFloors, requiredCaseLevels };
}

function assertProfileFloors(
  testIntensity: TestIntensity,
  gateStrictness: GateStrictness,
  cases: readonly TestCasePlanEntry[],
  gates: readonly GatePlanEntry[],
  nonApplicability: readonly NonApplicabilityEntry[],
): void {
  const floors = expandProfileFloors({ testIntensity, gateStrictness });
  const presentFloors = new Set(
    gates
      .filter((gate) => gate.disposition === "required" && gate.floor !== "none")
      .map((gate) => gate.floor),
  );
  for (const floor of floors.requiredGateFloors) {
    if (!presentFloors.has(floor)) fail("PLAN_FLOOR_WEAKENED", floor);
  }
  if (gateStrictness === "custom") {
    for (const floor of floors.requiredGateFloors) {
      const gate = gates.find((item) => item.floor === floor);
      if (!gate || gate.disposition !== "required") fail("PLAN_FLOOR_WEAKENED", floor);
    }
  }
  const levels = new Set(cases.map((item) => item.level));
  const nonApplicableLevels = new Set(nonApplicability.flatMap((item) => item.covers)
    .filter((ref): ref is `level:${TestLevel}` => ref.startsWith("level:"))
    .map((ref) => ref.slice("level:".length) as TestLevel));
  for (const level of floors.requiredCaseLevels) {
    if (!levels.has(level) && !nonApplicableLevels.has(level)) fail("PLAN_PROFILE_INCOMPLETE", level);
  }
}

function normalizePlan(input: {
  changeId: string;
  testIntensity: TestIntensity;
  gateStrictness: GateStrictness;
  cases: readonly TestCasePlanEntry[];
  gates: readonly GatePlanEntry[];
  nonApplicability: readonly NonApplicabilityEntry[];
  coverageRefs: readonly string[];
}): Omit<TestAndGatePlan, "digest"> & { digest?: string } {
  return {
    changeId: input.changeId,
    testIntensity: input.testIntensity,
    gateStrictness: input.gateStrictness,
    cases: input.cases.map((item) => ({
      id: item.id,
      title: item.title,
      maps: [...item.maps],
      level: item.level,
      purpose: item.purpose,
      preconditions: item.preconditions,
      action: item.action,
      expected: item.expected,
      failure: item.failure,
      disposition: item.disposition,
    })),
    gates: input.gates.map((item) => ({
      id: item.id,
      title: item.title,
      maps: [...item.maps],
      intent: item.intent,
      scope: item.scope,
      pass: item.pass,
      disposition: item.disposition,
      phase: item.phase,
      waiver: item.waiver,
      floor: item.floor,
    })),
    nonApplicability: input.nonApplicability.map((item) => ({
      id: item.id,
      title: item.title,
      covers: [...item.covers],
      reason: item.reason,
    })),
    coverageRefs: [...input.coverageRefs],
  };
}

export function normalizeTestAndGatePlanDigest(plan: Omit<TestAndGatePlan, "digest"> | TestAndGatePlan): string {
  const normalized = normalizePlan({
    changeId: plan.changeId,
    testIntensity: plan.testIntensity,
    gateStrictness: plan.gateStrictness,
    cases: plan.cases,
    gates: plan.gates,
    nonApplicability: plan.nonApplicability,
    coverageRefs: plan.coverageRefs,
  });
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/** Project official plan facts into campaign authorization snapshot fields. */
export function campaignPlanFromTestAndGatePlan(
  plan: TestAndGatePlan,
  selectedTaskIds: readonly string[],
): {
  digest: string;
  testIntensity: TestIntensity;
  gateStrictness: GateStrictness;
  caseRefs: string[];
  gateRefs: string[];
  selectedTaskMappings: Array<{ taskId: string; caseRefs: string[]; gateRefs: string[]; nonApplicabilityRefs: string[] }>;
} {
  if (selectedTaskIds.length === 0) fail("PLAN_SCOPE", "selectedTaskIds");
  const selected = new Set(selectedTaskIds.map((taskId) => `task:${taskId}`));
  const selectedTaskMappings = selectedTaskIds.map((taskId) => {
    const ref = `task:${taskId}`;
    const caseRefs = plan.cases.filter((item) => item.maps.includes(ref)).map((item) => item.id);
    const gateRefs = plan.gates.filter((item) => item.maps.includes(ref)).map((item) => item.id);
    const nonApplicabilityRefs = plan.nonApplicability.filter((item) => item.covers.includes(ref)).map((item) => item.id);
    if (!caseRefs.length && !nonApplicabilityRefs.length) fail("PLAN_SCOPE", `selected task lacks plan coverage: ${taskId}`);
    return { taskId, caseRefs, gateRefs, nonApplicabilityRefs };
  });
  return {
    digest: plan.digest,
    testIntensity: plan.testIntensity,
    gateStrictness: plan.gateStrictness,
    caseRefs: plan.cases.filter((item) => item.maps.some((ref) => selected.has(ref))).map((item) => item.id),
    gateRefs: plan.gates.filter((item) => item.maps.some((ref) => selected.has(ref))).map((item) => item.id),
    selectedTaskMappings,
  };
}

/** Narrow lifecycle projection for claim-matched completion evidence. */
export function plannedAcceptanceChecksFromPlan(
  plan: TestAndGatePlan,
  selectedTaskIds: readonly string[],
): Array<{
  ref: `TC-${number}` | `G-${number}`;
  kind: "test-case" | "gate";
  acceptanceRefs: readonly string[];
  disposition: PlanDisposition;
  applicable: boolean;
  permittedWaiverCondition?: string;
}> {
  const selected = new Set(selectedTaskIds.map((id) => `task:${id}`));
  const checks: Array<{
    ref: `TC-${number}` | `G-${number}`;
    kind: "test-case" | "gate";
    acceptanceRefs: readonly string[];
    disposition: PlanDisposition;
    applicable: boolean;
    permittedWaiverCondition?: string;
  }> = [];

  for (const item of plan.cases) {
    const acceptanceRefs = item.maps.filter((ref) => selected.has(ref));
    if (!acceptanceRefs.length) continue;
    checks.push({
      ref: item.id as `TC-${number}`,
      kind: "test-case",
      acceptanceRefs,
      disposition: item.disposition,
      applicable: true,
    });
  }
  for (const item of plan.gates) {
    const acceptanceRefs = item.maps.filter((ref) => selected.has(ref));
    if (!acceptanceRefs.length) continue;
    const waiver = item.waiver.trim();
    checks.push({
      ref: item.id as `G-${number}`,
      kind: "gate",
      acceptanceRefs,
      disposition: item.disposition,
      applicable: true,
      ...(waiver && waiver.toLowerCase() !== "none" ? { permittedWaiverCondition: waiver } : {}),
    });
  }
  return checks;
}

export function parseTestAndGatePlan(source: string, context: ParseTestAndGatePlanContext): TestAndGatePlan {
  const section = extractPlanSection(source);
  const blocks = splitBlocks(section);
  const { testIntensity, gateStrictness } = parseProfiles(blocks.profiles);

  if (blocks.cases.length === 0) fail("PLAN_MISSING_FIELD", "cases");
  if (blocks.gates.length === 0) fail("PLAN_MISSING_FIELD", "gates");
  if (blocks.cases.length > TEST_AND_GATE_PLAN_BOUNDS.maxCases) fail("PLAN_BOUNDS", "cases");
  if (blocks.gates.length > TEST_AND_GATE_PLAN_BOUNDS.maxGates) fail("PLAN_BOUNDS", "gates");
  if (blocks.nonApplicability.length > TEST_AND_GATE_PLAN_BOUNDS.maxNonApplicability) fail("PLAN_BOUNDS", "nonApplicability");

  const cases = blocks.cases.map(parseCase);
  const gates = blocks.gates.map(parseGate);
  const nonApplicability = blocks.nonApplicability.map(parseNonApplicability);

  const seen = new Set<string>();
  for (const item of [...cases, ...gates, ...nonApplicability]) {
    if (seen.has(item.id)) fail("PLAN_DUPLICATE_ID", item.id);
    seen.add(item.id);
  }

  const caseOrder = cases.map((item) => item.id);
  const expectedCaseOrder = [...caseOrder].sort((left, right) => Number(left.slice(3)) - Number(right.slice(3)));
  if (caseOrder.join("\0") !== expectedCaseOrder.join("\0")) fail("PLAN_ORDER", "cases");
  const gateOrder = gates.map((item) => item.id);
  const expectedGateOrder = [...gateOrder].sort((left, right) => Number(left.slice(2)) - Number(right.slice(2)));
  if (gateOrder.join("\0") !== expectedGateOrder.join("\0")) fail("PLAN_ORDER", "gates");

  const acceptanceAllowed = new Set(acceptanceRefs(context.acceptance));
  const nonApplicabilityAllowed = new Set([
    ...acceptanceAllowed,
    ...TEST_LEVEL_VALUES.map((level) => `level:${level}`),
  ]);
  assertResolvedMappings(cases, acceptanceAllowed);
  assertResolvedMappings(gates, acceptanceAllowed);
  assertResolvedMappings(nonApplicability, nonApplicabilityAllowed);
  const coverageRefs = assertCoverage(cases, nonApplicability, context.acceptance);
  assertProfileFloors(testIntensity, gateStrictness, cases, gates, nonApplicability);

  const normalized = normalizePlan({
    changeId: context.changeId,
    testIntensity,
    gateStrictness,
    cases,
    gates,
    nonApplicability,
    coverageRefs,
  });
  return {
    ...normalized,
    digest: normalizeTestAndGatePlanDigest(normalized),
  };
}
