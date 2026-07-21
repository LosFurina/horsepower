import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parse } from "yaml";

const packageJsonUrl = new URL("../../package.json", import.meta.url);

test("the Node project is private and requires the supported runtime", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  expect(packageJson.private).toBe(true);
  expect(packageJson.type).toBe("module");
  expect(packageJson.engines.node).toBe(">=22.19.0");
  expect(packageJson.publishConfig).toBeUndefined();
});

test("English and Chinese documentation cover the public execution and safety contracts", async () => {
  const english = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  const chinese = await readFile(new URL("../../docs/README.zh-CN.md", import.meta.url), "utf8");
  for (const [name, text] of [["English", english], ["Chinese", chinese]] as const) {
    for (const required of ["horsepower_subagent", "judgment", "craft", "utility", "speed", "context", "managed", "inline", "e2eWaiver", "outputLocale", "OpenSpec", "horsepower disable", "horsepower uninstall", "horsepower purge", "/reload"]) {
      expect(text, `${name}: ${required}`).toContain(required);
    }
    expect(text, name).toMatch(/retry|重试/u);
    expect(text, name).toMatch(/process|进程/u);
    expect(text, name).toMatch(/resume|恢复/u);
    expect(text, name).not.toMatch(/pi install|pi update|npm (?:install|publish).*horsepower|private-provider|private-model|\/Users\//iu);
  }
});

test("CI, alpha, and tag-only release workflows enforce cross-platform bilingual E2E gates", async () => {
  const ci = await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
  const alpha = await readFile(new URL("../../.github/workflows/alpha.yml", import.meta.url), "utf8");
  const release = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
  for (const workflow of [ci, alpha, release]) {
    expect(() => parse(workflow)).not.toThrow();
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("macos-14");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain("en");
    expect(workflow).toContain("zh-CN");
    expect(workflow).not.toMatch(/npm publish|git push|pi install|pi update/u);
  }
  expect(alpha).toContain("workflow_dispatch");
  expect(release).toContain("tags:");
  expect(release).toContain("v*");
  expect(release).toContain("scripts/release.mjs");
  expect(release).toContain("horsepower-v${VERSION}.tar.gz");
  expect(release).toContain("horsepower-v${VERSION}.tar.gz.sha256");
  expect(release).not.toMatch(/branches:|pull_request:/u);
});

test("the repository exposes a mandatory real-Pi E2E command", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  expect(packageJson.scripts["test:e2e"]).toBe("vitest run --config vitest.e2e.config.ts");
  expect(packageJson.scripts.check).toContain("npm run test:e2e");
});

test("the repository exposes one complete verification command", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, "utf8"));

  expect(packageJson.scripts.check).toBe("npm run typecheck && npm test && npm run build && npm run test:e2e");
});
