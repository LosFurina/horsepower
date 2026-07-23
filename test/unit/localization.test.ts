import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { catalogs, localizeResult, message, resolveOutputLocale, setOutputLocale } from "../../src/localization/index.js";

test("catalogs are exhaustive and render English and Chinese conclusions", () => {
  expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs["zh-CN"]).sort());
  expect(message("en", "dispatch.completed", { action: "review" })).toBe("review completed.");
  expect(message("zh-CN", "dispatch.completed", { action: "review" })).toBe("review 已完成。");
  expect(message("en", "campaign.continuationQueued", {
    campaignId: "campaign-1", changeId: "change-a", taskIds: "1.1,2.2", mode: "multi_agent",
  })).toContain("campaign-1");
  expect(message("zh-CN", "campaign.continuationQueued", {
    campaignId: "campaign-1", changeId: "change-a", taskIds: "1.1,2.2", mode: "multi_agent",
  })).toMatch(/campaign-1.*change-a.*1\.1,2\.2.*multi_agent/u);
  expect(message("zh-CN", "campaign.continuationStopped", { campaignId: "campaign-1" })).toContain("campaign-1");
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

test("verification and review diagnostics localize Captain conclusions while preserving stable codes", () => {
  expect(message("en", "error.verificationMigration", { code: "VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED" })).toContain("verification manifest");
  expect(message("zh-CN", "error.verificationMigration", { code: "VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED" })).toMatch(/旧完成证据.*VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED/u);
  expect(message("zh-CN", "error.verification", { code: "VERIFICATION_EVIDENCE_STALE" })).toMatch(/验证被拒绝.*VERIFICATION_EVIDENCE_STALE/u);
  expect(message("zh-CN", "error.reviewCampaign", { code: "REVIEW_CAMPAIGN_ACCEPTANCE_BLOCKED" })).toMatch(/操作被拒绝.*REVIEW_CAMPAIGN_ACCEPTANCE_BLOCKED/u);
});
