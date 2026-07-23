import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { message } from "../../src/localization/index.js";
import {
  authoringDialogueFixtures, authoringOutcome, expandedPlanFixture, TEST_PLAN_MACHINE_TOKENS,
} from "../fixtures/test-gate-authoring.js";

const root = resolve(import.meta.dirname, "../..");

test("recommended, alternative, and custom dialogue requires non-default explicit selection", () => {
  expect(authoringDialogueFixtures.recommended.recommendation).toEqual({ testIntensity: "standard", gateStrictness: "strict" });
  expect(authoringDialogueFixtures.recommended.alternatives).toHaveLength(2);
  expect(authoringDialogueFixtures.alternative.explicitSelectionRequired).toBe(true);
  expect(authoringDialogueFixtures.custom).toMatchObject({ entriesRequired: true, mandatoryFloorsMayBeWeakened: false });
  expect(authoringOutcome(authoringDialogueFixtures.recommended.recommendation, true)).toMatchObject({ status: "confirmed" });
  expect(authoringOutcome(undefined, true)).toEqual({ status: "unconfirmed", reason: "canceled" });
  expect(authoringOutcome({ testIntensity: "quick", gateStrictness: "strict" }, true)).toEqual({ status: "unconfirmed", reason: "unsupported" });
  expect(authoringOutcome(authoringDialogueFixtures.recommended.recommendation, false)).toEqual({ status: "unconfirmed", reason: "not-affirmed" });
  expect(authoringOutcome(authoringDialogueFixtures.recommended.recommendation, undefined)).toEqual({ status: "unconfirmed", reason: "not-affirmed" });
});

test("expanded cases and gates explain observable behavior with stable references", () => {
  expect(expandedPlanFixture.cases.map(({ id }) => id)).toEqual(TEST_PLAN_MACHINE_TOKENS.cases);
  expect(expandedPlanFixture.gates.map(({ id }) => id)).toEqual(TEST_PLAN_MACHINE_TOKENS.gates);
  for (const entry of expandedPlanFixture.cases) {
    expect(entry).toMatchObject({ acceptanceRefs: expect.any(Array), level: expect.any(String), purpose: expect.any(String), setup: expect.any(String), action: expect.any(String), expectation: expect.any(String), failureMeaning: expect.any(String), disposition: expect.any(String) });
  }
  for (const gate of expandedPlanFixture.gates) expect(gate).toMatchObject({ intent: expect.any(String), pass: expect.any(String), phase: expect.any(String), waiver: expect.any(String) });
});

test("bundled Skill owns official design/tasks authoring without touching generated OpenSpec resources", async () => {
  const skill = await readFile(resolve(root, "resources/skills/horsepower/SKILL.md"), "utf8");
  for (const token of ["targeted", "standard", "exhaustive", "custom", "required", "strict", "release", "## Test and Gate Plan", "TC-*", "G-*", "design.md", "tasks.md", ".pi/skills/openspec-*", ".pi/prompts/opsx-*"]) expect(skill).toContain(token);
  expect(skill).toMatch(/no default|There is \*\*no default\*\*/iu);
  expect(skill).toMatch(/reconcile the exact command before completion/iu);
});

test("test-plan explanations and migration diagnostics are bilingual while machine tokens stay stable", () => {
  const ids = ["testPlan.intensity", "testPlan.strictness", "testPlan.level", "testPlan.setup", "testPlan.action", "testPlan.expectation", "testPlan.failureMeaning", "testPlan.gatePhase", "testPlan.gatePass", "testPlan.gateWaiver"] as const;
  for (const id of ids) {
    expect(message("en", id, { value: "TC-1 standard npm test" })).toContain("TC-1 standard npm test");
    expect(message("zh-CN", id, { value: "TC-1 standard npm test" })).toContain("TC-1 standard npm test");
  }
  for (const id of ["testPlan.invalid", "testPlan.drift", "testPlan.migration"] as const) {
    expect(message("en", id, { code: "TEST_PLAN_MISSING" })).toContain("TEST_PLAN_MISSING");
    expect(message("zh-CN", id, { code: "TEST_PLAN_MISSING" })).toContain("TEST_PLAN_MISSING");
  }
  expect(message("en", "testPlan.confirm")).toContain("No option is selected by default");
  expect(message("zh-CN", "testPlan.canceled")).toMatch(/取消.*未创建 campaign/u);
});
