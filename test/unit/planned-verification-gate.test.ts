import { expect, test } from "vitest";
import { verifyCompletionManifest, type AcceptanceSnapshot, type VerificationManifest } from "../../src/lifecycle/verification-gate.js";

const snapshot: AcceptanceSnapshot = {
  digest: "sha256:acceptance-and-plan",
  refs: ["task:5.1"],
  plannedChecks: [
    { ref: "TC-1", kind: "test-case", acceptanceRefs: ["task:5.1"], disposition: "required", applicable: true },
    { ref: "G-1", kind: "gate", acceptanceRefs: ["task:5.1"], disposition: "required", applicable: true, permittedWaiverCondition: "No packaged artifact is produced" },
    { ref: "G-2", kind: "gate", acceptanceRefs: ["task:5.1"], disposition: "advisory", applicable: true },
  ],
};
const context = {
  runStartedAt: "2026-07-23T11:59:00.000Z",
  now: "2026-07-23T12:01:00.000Z",
  currentAcceptanceSnapshot: snapshot,
};
const command = {
  id: "captain-e2e",
  kind: "e2e" as const,
  command: "npm run test:e2e",
  exitCode: 0,
  summary: "Captain observed acceptance and required gates pass",
  acceptanceRefs: ["task:5.1"],
};
const valid: VerificationManifest = {
  observedAt: "2026-07-23T12:00:00.000Z",
  commands: [command],
  acceptance: [{ ref: "task:5.1", evidenceIds: [command.id] }],
  plannedChecks: [
    { ref: "TC-1", evidenceIds: [command.id] },
    { ref: "G-1", evidenceIds: [command.id] },
  ],
};

const verify = (manifest: VerificationManifest, currentAcceptanceSnapshot = snapshot) =>
  verifyCompletionManifest(manifest, { ...context, currentAcceptanceSnapshot });

test("accepts fresh successful Captain-observed evidence mapped to every required plan case and gate", () => {
  expect(verify(valid)).toMatchObject({ kind: "e2e", scopeDigest: snapshot.digest });
});

test("rejects missing required plan evidence and identifies its stable ID", () => {
  expect(() => verify({ ...valid, plannedChecks: [{ ref: "TC-1", evidenceIds: [command.id] }] }))
    .toThrow("VERIFICATION_PLAN_EVIDENCE_REQUIRED: G-1");
});

test.each([
  ["stale", { observedAt: "2026-07-23T11:58:00.000Z" }, /VERIFICATION_EVIDENCE_STALE/],
  ["failed", { commands: [{ ...command, exitCode: 1 }] }, /VERIFICATION_COMMAND_FAILED/],
  ["worker-only", { workerReport: { summary: "passed" } }, /VERIFICATION_WORKER_REPORT_ONLY/],
] as const)("rejects %s planned evidence", (_name, replacement, diagnostic) => {
  expect(() => verify({ ...valid, ...replacement } as VerificationManifest)).toThrow(diagnostic);
});

test("advisory evidence cannot substitute for a required plan mapping", () => {
  expect(() => verify({ ...valid, plannedChecks: [{ ref: "G-2", evidenceIds: [command.id] }] }))
    .toThrow("VERIFICATION_PLAN_EVIDENCE_REQUIRED: TC-1");
});

test("rejects unmapped plan evidence IDs", () => {
  expect(() => verify({ ...valid, plannedChecks: [
    { ref: "TC-1", evidenceIds: ["missing"] },
    { ref: "G-1", evidenceIds: [command.id] },
  ] })).toThrow("VERIFICATION_PLAN_CAPTAIN_EVIDENCE_REQUIRED: TC-1");
});

test("rejects plan mappings and official plan checks that drift from current scope", () => {
  expect(() => verify({ ...valid, plannedChecks: [...valid.plannedChecks!, { ref: "G-9", evidenceIds: [command.id] }] }))
    .toThrow("VERIFICATION_PLAN_SCOPE_DRIFT: unknown planned check G-9");
  expect(() => verify(valid, { ...snapshot, plannedChecks: [{ ...snapshot.plannedChecks![0]!, acceptanceRefs: ["task:other"] }] }))
    .toThrow("VERIFICATION_PLAN_SCOPE_DRIFT: TC-1");
});

test("rejects a waiver unless the official plan permits the exact condition", () => {
  expect(() => verify({ ...valid, plannedChecks: [
    { ref: "TC-1", waiver: { reason: "not runnable", condition: "not runnable", alternativeEvidenceIds: [command.id] } },
    { ref: "G-1", evidenceIds: [command.id] },
  ] })).toThrow("VERIFICATION_PLAN_WAIVER_NOT_PERMITTED: TC-1");
  expect(() => verify({ ...valid, plannedChecks: [
    { ref: "TC-1", evidenceIds: [command.id] },
    { ref: "G-1", waiver: { reason: "not applicable", condition: "Different condition", alternativeEvidenceIds: [command.id] } },
  ] })).toThrow("VERIFICATION_PLAN_WAIVER_CONDITION_MISMATCH: G-1");
});

test("accepts a plan-permitted waiver only with concrete mapped alternative evidence while preserving E2E", () => {
  const manifest: VerificationManifest = {
    ...valid,
    plannedChecks: [
      { ref: "TC-1", evidenceIds: [command.id] },
      { ref: "G-1", waiver: { reason: "This change produces no package to inspect", condition: "No packaged artifact is produced", alternativeEvidenceIds: [command.id] } },
    ],
  };
  expect(verify(manifest)).toMatchObject({ kind: "e2e" });
});

test("preserves the existing valid E2E waiver while enforcing plan-permitted waivers", () => {
  const alternative = { id: "captain-alternative", summary: "Captain inspected the non-packaging build path", acceptanceRefs: ["task:5.1"] };
  const manifest: VerificationManifest = {
    observedAt: "2026-07-23T12:00:00.000Z",
    commands: [],
    e2eWaiver: { reason: "No executable E2E surface exists", alternativeEvidence: [alternative] },
    acceptance: [{ ref: "task:5.1", evidenceIds: [alternative.id] }],
    plannedChecks: [
      { ref: "TC-1", waiver: { reason: "No executable E2E surface exists", condition: "No executable E2E surface exists", alternativeEvidenceIds: [alternative.id] } },
      { ref: "G-1", waiver: { reason: "No package is produced", condition: "No packaged artifact is produced", alternativeEvidenceIds: [alternative.id] } },
    ],
  };
  const waiverSnapshot: AcceptanceSnapshot = {
    ...snapshot,
    plannedChecks: snapshot.plannedChecks!.map((check) => check.ref === "TC-1"
      ? { ...check, permittedWaiverCondition: "No executable E2E surface exists" }
      : check),
  };
  expect(verify(manifest, waiverSnapshot)).toMatchObject({ kind: "waiver" });
});

test("plan profiles cannot remove the existing E2E-or-valid-waiver floor", () => {
  const targeted = { ...command, kind: "targeted" as const, command: "npm test" };
  expect(() => verify({ ...valid, commands: [targeted] })).toThrow("VERIFICATION_E2E_REQUIRED");
});
