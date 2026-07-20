import { expect, test } from "vitest";

test("permits completion with Captain-selected successful E2E evidence", async () => {
  const module = await import("../../src/lifecycle/verification-gate.js").catch(() => undefined);

  expect(module?.verifyCompletion({
    e2e: [{ command: "npm run e2e", exitCode: 0, durationMs: 1200, summary: "3 scenarios passed" }],
  })).toEqual({
    kind: "e2e",
    evidence: [{ command: "npm run e2e", exitCode: 0, durationMs: 1200, summary: "3 scenarios passed" }],
  });
});

test("rejects unit-only completion without E2E or an explicit waiver", async () => {
  const { verifyCompletion } = await import("../../src/lifecycle/verification-gate.js");

  expect(() => verifyCompletion({
    unit: [{ command: "npm test", exitCode: 0, summary: "84 tests passed" }],
  })).toThrow("Completion requires Captain-selected successful E2E evidence or an explicit e2eWaiver");
});

test("rejects empty or unbounded E2E command evidence", async () => {
  const { verifyCompletion } = await import("../../src/lifecycle/verification-gate.js");

  expect(() => verifyCompletion({ e2e: [{ command: "", exitCode: 0, summary: "" }] }))
    .toThrow("E2E command evidence requires command and summary");
  expect(() => verifyCompletion({
    e2e: Array.from({ length: 9 }, (_, index) => ({ command: `e2e-${index}`, exitCode: 0, summary: "passed" })),
  })).toThrow("At most 8 E2E commands may be declared");
});

test("permits a reasoned E2E waiver with alternative evidence", async () => {
  const { verifyCompletion } = await import("../../src/lifecycle/verification-gate.js");

  expect(verifyCompletion({
    e2eWaiver: {
      reason: "Documentation-only change with no runtime behavior",
      alternativeEvidence: ["strict OpenSpec validation passed", "link checker passed"],
    },
  })).toEqual({
    kind: "waiver",
    reason: "Documentation-only change with no runtime behavior",
    alternativeEvidence: ["strict OpenSpec validation passed", "link checker passed"],
  });
});
