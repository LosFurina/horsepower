import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { scanPublicContent } from "../../src/release/index.js";

const guidance = [
  ["README.md", ["horsepower configure --interactive", "horsepower setup --interactive", "--no-setup", "Superpowers", "never sends an upstream probe", "without silently", "user is responsible", "thinkingLevelMap", "does not modify", "models.json", "slot bindings"]],
  ["docs/README.zh-CN.md", ["horsepower configure --interactive", "horsepower setup --interactive", "--no-setup", "Superpowers", "不会探测上游", "不会静默", "用户负责", "thinkingLevelMap", "不会修改", "models.json", "slot binding"]],
  ["resources/skills/horsepower/SKILL.md", ["horsepower setup --interactive", "does not probe upstream", "user is responsible", "never silently"]],
] as const;

test.each(guidance)("%s documents user-owned model configuration without upstream probes", async (path, required) => {
  const content = await readFile(path, "utf8");
  for (const phrase of required) expect(content.toLowerCase(), phrase).toContain(phrase.toLowerCase());
});

test("deterministic local capability fixtures pass the unchanged release privacy policy", async () => {
  const paths = ["test/fixtures/pi-local-capability.mjs", "test/e2e/live-model-capability.e2e.test.ts"];
  const contents = await Promise.all(paths.map(async (path) => ({ path, content: await readFile(path) })));
  expect(() => scanPublicContent(contents)).not.toThrow();
});
