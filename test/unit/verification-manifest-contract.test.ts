import { Check, Errors } from "typebox/value";
import { expect, test } from "vitest";
import { horsepowerActionSchemas } from "../../src/orchestration/schema.js";

const command = (id = "evidence-1") => ({
  id,
  kind: "e2e" as const,
  command: "npm run e2e",
  exitCode: 0,
  durationMs: 1_200,
  summary: "3 scenarios passed",
  acceptanceRefs: ["task:1.1"],
});

const verification = {
  observedAt: "2026-07-21T12:00:00.000Z",
  commands: [command()],
  acceptance: [{ ref: "task:1.1", evidenceIds: ["evidence-1"] }],
};

const report = (nextVerification: unknown = verification) => ({
  action: "report_terminal",
  cwd: "/project",
  changeId: "change-a",
  runId: "run-1",
  status: "completed",
  summary: "Verified",
  verification: nextVerification,
});

const expectInvalidAt = (value: unknown, path: string) => {
  const errors = Errors(horsepowerActionSchemas.report_terminal, value);
  expect(errors.map((error) => error.instancePath), JSON.stringify(errors)).toContain(path);
};

test("review campaign creation requires implementation and exact task-scope correlation in the public schema", () => {
  const base = { action: "begin_review_campaign", cwd: "/project", changeId: "change-a", acceptanceScope: "tasks 5.3,5.4", budget: 2 };
  expect(Check(horsepowerActionSchemas.begin_review_campaign, base)).toBe(false);
  expect(Errors(horsepowerActionSchemas.begin_review_campaign, base)).not.toHaveLength(0);
  expect(Check(horsepowerActionSchemas.begin_review_campaign, { ...base, implementationCampaignId: "implementation-1", taskScope: "5.3,5.4" })).toBe(true);
});

test("accepts a bounded manifest with an exact-shaped acceptance mapping", () => {
  expect(Check(horsepowerActionSchemas.report_terminal, report())).toBe(true);
});

test("accepts the maximum of eight commands", () => {
  expect(Check(horsepowerActionSchemas.report_terminal, report({
    ...verification,
    commands: Array.from({ length: 8 }, (_, index) => command(`evidence-${index + 1}`)),
  }))).toBe(true);
});

test("rejects zero commands at the command-list boundary", () => {
  expectInvalidAt(report({ ...verification, commands: [] }), "/verification/commands");
});

test("rejects nine commands at the command-list boundary", () => {
  expectInvalidAt(report({
    ...verification,
    commands: Array.from({ length: 9 }, (_, index) => command(`evidence-${index + 1}`)),
  }), "/verification/commands");
});

test("rejects an empty command ID at the evidence-ID boundary", () => {
  expectInvalidAt(report({ ...verification, commands: [command("")] }), "/verification/commands/0/id");
});

test("rejects an overlong command ID at the evidence-ID boundary", () => {
  expectInvalidAt(report({ ...verification, commands: [command("x".repeat(129))] }), "/verification/commands/0/id");
});

test("rejects an empty command string at the command boundary", () => {
  expectInvalidAt(report({ ...verification, commands: [{ ...command(), command: "" }] }), "/verification/commands/0/command");
});

test("rejects an overlong command string at the command boundary", () => {
  expectInvalidAt(report({ ...verification, commands: [{ ...command(), command: "x".repeat(501) }] }), "/verification/commands/0/command");
});

test("rejects an empty command summary at the summary boundary", () => {
  expectInvalidAt(report({ ...verification, commands: [{ ...command(), summary: "" }] }), "/verification/commands/0/summary");
});

test("rejects an overlong command summary at the summary boundary", () => {
  expectInvalidAt(report({ ...verification, commands: [{ ...command(), summary: "x".repeat(501) }] }), "/verification/commands/0/summary");
});

test("requires an exact UTC observedAt timestamp at the timestamp boundary", () => {
  expectInvalidAt(report({ ...verification, observedAt: "2026-07-21T12:00:00+00:00" }), "/verification/observedAt");
});

test("rejects an acceptance mapping with no evidence IDs at the mapping boundary", () => {
  expectInvalidAt(report({ ...verification, acceptance: [{ ref: "task:1.1", evidenceIds: [] }] }), "/verification/acceptance/0/evidenceIds");
});

test("rejects an empty acceptance reference at the reference boundary", () => {
  expectInvalidAt(report({ ...verification, acceptance: [{ ref: "", evidenceIds: ["evidence-1"] }] }), "/verification/acceptance/0/ref");
});

test("does not make a caller-supplied scope snapshot part of the manifest", () => {
  expectInvalidAt(report({ ...verification, scopeSnapshot: { digest: "sha256:caller-supplied" } }), "/verification/scopeSnapshot");
});

test("legacy bare completion fields are excluded from the replacement public schema", () => {
  expect(Check(horsepowerActionSchemas.report_terminal, {
    action: "report_terminal", cwd: "/project", changeId: "change-a", runId: "run-1", status: "completed", summary: "legacy",
    e2e: [{ command: "npm run test:e2e", exitCode: 0, summary: "passed" }],
  })).toBe(false);
  expect(Check(horsepowerActionSchemas.report_terminal, {
    action: "report_terminal", cwd: "/project", changeId: "change-a", runId: "run-1", status: "completed", summary: "legacy",
    e2eWaiver: { reason: "docs", alternativeEvidence: ["validation"] },
  })).toBe(false);
});

test.each(["failed", "canceled", "blocked_needs_human"] as const)("%s remains schema-compatible without verification", (status) => {
  expect(Check(horsepowerActionSchemas.report_terminal, {
    action: "report_terminal", cwd: "/project", changeId: "change-a", runId: "run-1", status, summary: "truthful non-complete outcome",
  })).toBe(true);
});
