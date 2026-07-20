import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

const packageJsonUrl = new URL("../../package.json", import.meta.url);

test("the Node project is private and requires the supported runtime", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  expect(packageJson.private).toBe(true);
  expect(packageJson.type).toBe("module");
  expect(packageJson.engines.node).toBe(">=22.19.0");
  expect(packageJson.publishConfig).toBeUndefined();
});

test("the repository exposes one complete verification command", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  expect(packageJson.scripts.check).toBe("npm run typecheck && npm test && npm run build");
});
