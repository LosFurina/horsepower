import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { catalogs, localizeResult, message, resolveOutputLocale, setOutputLocale } from "../../src/localization/index.js";

test("catalogs are exhaustive and render English and Chinese conclusions", () => {
  expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs["zh-CN"]).sort());
  expect(message("en", "dispatch.completed", { action: "review" })).toBe("review completed.");
  expect(message("zh-CN", "dispatch.completed", { action: "review" })).toBe("review 已完成。");
});

test("project locale overrides global and missing configuration defaults to English", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-locale-"));
  const globalPath = join(root, "global.json"); const projectPath = join(root, "project.json");
  expect(await resolveOutputLocale(globalPath, projectPath)).toBe("en");
  await writeFile(globalPath, JSON.stringify({ outputLocale: "zh-CN" }));
  expect(await resolveOutputLocale(globalPath, projectPath)).toBe("zh-CN");
  await writeFile(projectPath, JSON.stringify({ outputLocale: "en" }));
  expect(await resolveOutputLocale(globalPath, projectPath)).toBe("en");
});

test("invalid locale is rejected before transactional settings change", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-locale-write-")); await mkdir(root, { recursive: true });
  const path = join(root, "settings.json"); await writeFile(path, JSON.stringify({ retained: true, outputLocale: "en" }));
  await expect(setOutputLocale(path, "fr" as never)).rejects.toThrow("OUTPUT_LOCALE_INVALID");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ retained: true, outputLocale: "en" });
  await setOutputLocale(path, "zh-CN");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ retained: true, outputLocale: "zh-CN" });
});

test("localized result preserves stable machine fields and English internal evidence", () => {
  const raw = { status: "completed", runId: "run-1", digest: "abc", artifactRef: "handoff:1", rawEvidence: "English worker report", summary: "internal" };
  expect(localizeResult("zh-CN", raw, "dispatch.completed", { action: "review" })).toEqual({
    ...raw, outputLocale: "zh-CN", summary: "review 已完成。",
  });
});
