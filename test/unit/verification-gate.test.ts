import { expect, test } from "vitest";
import { verifyCompletion, verifyCompletionManifest } from "../../src/lifecycle/verification-gate.js";

const context = {
  runStartedAt: "2026-07-21T11:59:00.000Z",
  now: "2026-07-21T12:01:00.000Z",
  currentAcceptanceSnapshot: { digest: "scope-digest", refs: ["task:1.1"] },
};

const commandManifest = {
  observedAt: "2026-07-21T12:00:00.000Z",
  commands: [{ id: "e2e-1", kind: "e2e" as const, command: "npm run e2e", exitCode: 0, durationMs: 1_200, summary: "3 scenarios passed", acceptanceRefs: ["task:1.1"] }],
  acceptance: [{ ref: "task:1.1", evidenceIds: ["e2e-1"] }],
};

test("permits completion with fresh Captain-selected claim-matched E2E evidence", () => {
  expect(verifyCompletionManifest(commandManifest, context)).toEqual({
    kind: "e2e",
    scopeDigest: "scope-digest",
    observedAt: commandManifest.observedAt,
    evidence: commandManifest.commands,
  });
});

test("legacy bare E2E and waiver payloads fail closed", () => {
  expect(() => verifyCompletion({ e2e: [{ command: "npm run e2e", exitCode: 0, summary: "passed" }] }))
    .toThrow(/Legacy completion evidence is unsupported/);
  expect(() => verifyCompletion({ e2eWaiver: { reason: "docs", alternativeEvidence: ["validation"] } }))
    .toThrow(/Legacy completion evidence is unsupported/);
});

test("rejects empty or unbounded manifest command evidence", () => {
  expect(() => verifyCompletionManifest({ ...commandManifest, commands: [{ ...commandManifest.commands[0]!, command: "", summary: "" }] }, context))
    .toThrow(/Evidence summary is required|Evidence command is required/);
  expect(() => verifyCompletionManifest({
    ...commandManifest,
    commands: Array.from({ length: 9 }, (_, index) => ({ ...commandManifest.commands[0]!, id: `e2e-${index}` })),
  }, context)).toThrow(/at most 8 evidence items/i);
});

test("permits a reasoned mapped E2E waiver with alternative evidence", () => {
  const manifest = {
    observedAt: "2026-07-21T12:00:00.000Z",
    commands: [],
    e2eWaiver: {
      reason: "Documentation-only change with no runtime behavior",
      alternativeEvidence: [{ id: "alternative-1", summary: "strict OpenSpec validation passed", acceptanceRefs: ["task:1.1"] }],
    },
    acceptance: [{ ref: "task:1.1", evidenceIds: ["alternative-1"] }],
  };
  expect(verifyCompletionManifest(manifest, context)).toMatchObject({
    kind: "waiver",
    reason: "Documentation-only change with no runtime behavior",
    scopeDigest: "scope-digest",
  });
});

test("targeted or unit-only command evidence cannot replace required E2E completion evidence", () => {
  expect(() => verifyCompletionManifest({ ...commandManifest, commands: [{ ...commandManifest.commands[0]!, kind: "targeted", command: "npm test" }] }, context))
    .toThrow("VERIFICATION_E2E_REQUIRED");
});
