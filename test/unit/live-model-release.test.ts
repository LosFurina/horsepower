import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { scanPublicContent } from "../../src/release/index.js";

const guidance = [
  ["README.md", ["horsepower setup --interactive", "ten minutes", "no silent", "unsupported", "inconclusive", "user is responsible", "thinkingLevelMap", "does not modify", "models.json", "slot bindings"]],
  ["docs/README.zh-CN.md", ["horsepower setup --interactive", "十分钟", "不会静默", "不支持", "无法确认", "用户负责", "thinkingLevelMap", "不会修改", "models.json", "slot binding"]],
  ["resources/skills/horsepower/SKILL.md", ["horsepower setup --interactive", "ten minutes", "unsupported", "inconclusive", "never silently"]],
] as const;

test.each(guidance)("%s documents live selected-combination validation and remediation", async (path, required) => {
  const content = await readFile(path, "utf8");
  for (const phrase of required) expect(content.toLowerCase(), phrase).toContain(phrase.toLowerCase());
});

test("deterministic local capability fixtures pass the unchanged release privacy policy", async () => {
  const paths = ["test/fixtures/pi-local-capability.mjs", "test/e2e/live-model-capability.e2e.test.ts"];
  const contents = await Promise.all(paths.map(async (path) => ({ path, content: await readFile(path) })));
  expect(() => scanPublicContent(contents)).not.toThrow();
});
