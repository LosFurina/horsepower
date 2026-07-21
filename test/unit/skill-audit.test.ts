import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { auditSkillExposure, HOME_CANDIDATE_SCAN, type StaticSkillResolver } from "../../src/skills/audit.js";

const temporary: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "horsepower-audit-")); temporary.push(root);
  const homeDir = join(root, "home"), cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });
  return { root, homeDir, cwd };
}
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));
async function skill(path: string, name: string, extra = "") { await mkdir(join(path, ".."), { recursive: true }); await writeFile(path, `---\nname: ${name}\ndescription: fixture\n${extra}---\nPRIVATE BODY MUST NOT PRINT\n`); }

const resolved = (skills: Array<{ path: string; enabled: boolean; metadata: { source: string; scope: "user" | "project"; origin: "package" | "top-level"; baseDir?: string } }>, missing: string[] = []): StaticSkillResolver => async (onMissing) => {
  for (const source of missing) expect(await onMissing(source)).toBe("skip");
  return { skills };
};

test("static audit filters disabled resources, skips missing packages, bounds metadata, and has no side effects", async () => {
  const { homeDir, cwd } = await fixture();
  const visible = join(cwd, ".pi/skills/external/SKILL.md"), disabled = join(cwd, ".pi/skills/off/SKILL.md");
  await skill(visible, "external"); await skill(disabled, "disabled");
  let writes = 0;
  const result = await auditSkillExposure({ homeDir, cwd, resolveStatic: resolved([
    { path: visible, enabled: true, metadata: { source: "npm:@private/secret-skill", scope: "project", origin: "package" } },
    { path: disabled, enabled: false, metadata: { source: "settings", scope: "project", origin: "top-level" } },
  ], ["npm:missing-private-package"]), onPersist: () => { writes += 1; } });
  expect(result).toMatchObject({ status: "partial", externalCount: 1, excludedCount: 0, dynamicExtensionsEnumerated: false, cwd });
  expect(result.skills).toEqual([{ name: "external", scope: "project", source: "npm-package", path: "$PROJECT/.pi/skills/external/SKILL.md", evidence: "resolved" }]);
  expect(JSON.stringify(result)).not.toContain("@private");
  expect(result.limitations.join(" ")).toContain("extension");
  expect(result.limitations.join(" ")).not.toContain("missing-private-package");
  expect(JSON.stringify(result)).not.toContain("PRIVATE BODY");
  expect(writes).toBe(0);
});

test("provenance excludes only digest-owned Horsepower and structurally verified OpenSpec skills", async () => {
  const { homeDir, cwd } = await fixture();
  const release = join(homeDir, ".pi/agent/horsepower/versions/v0.1.0"), ownedTarget = join(release, "pi/skills/horsepower/SKILL.md");
  const owned = join(homeDir, ".pi/agent/skills/horsepower/SKILL.md");
  const lookalike = join(cwd, ".pi/skills/horsepower/SKILL.md");
  const official = join(cwd, ".pi/skills/openspec-apply-change/SKILL.md");
  await skill(ownedTarget, "horsepower"); await mkdir(join(homeDir, ".pi/agent/skills"), { recursive: true }); await symlink(join(release, "pi/skills/horsepower"), join(homeDir, ".pi/agent/skills/horsepower")); await skill(lookalike, "horsepower");
  await skill(official, "openspec-apply-change", 'allowed-tools: Bash(openspec:*)\nmetadata:\n  author: openspec\n  generatedBy: "1.6.0"\n');
  const digest = createHash("sha256").update(await readFile(ownedTarget)).digest("hex");
  await mkdir(release, { recursive: true });
  await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "0.1.0", entryPoints: { skill: "pi/skills/horsepower/SKILL.md" }, digests: { "pi/skills/horsepower/SKILL.md": digest } }));
  const result = await auditSkillExposure({ homeDir, cwd, openSpecVersion: "1.6.0", resolveStatic: resolved([owned, lookalike, official].map((path) => ({ path, enabled: true, metadata: { source: "local", scope: path === owned ? "user" : "project", origin: "top-level" as const } }))) });
  expect(result).toMatchObject({ status: "complete", externalCount: 1, excludedCount: 2 });
  expect(result.skills.map(({ path }) => path)).toEqual(["$PROJECT/.pi/skills/horsepower/SKILL.md"]);
});

test("resolver failure uses bounded candidate fallback and never claims a clean result", async () => {
  const { homeDir, cwd } = await fixture();
  const candidate = join(homeDir, ".agents/skills/fallback/SKILL.md"); await skill(candidate, "fallback");
  const result = await auditSkillExposure({ homeDir, cwd, resolveStatic: async () => { throw new Error("secret resolver details"); } });
  expect(result).toMatchObject({ status: "partial", externalCount: 1 });
  expect(result.skills[0]).toEqual({ name: "fallback", scope: "user", source: "standard-location", path: "$HOME/.agents/skills/fallback/SKILL.md", evidence: "candidate" });
  expect(JSON.stringify(result)).not.toContain("secret resolver details");
  expect(HOME_CANDIDATE_SCAN).toContain('find "$HOME"');
});

test("fallback failure reports failed without asserting absence", async () => {
  const { homeDir, cwd } = await fixture();
  await writeFile(homeDir, "not a directory");
  const result = await auditSkillExposure({ homeDir, cwd, resolveStatic: async () => { throw new Error("resolver failed"); } });
  expect(result.status).toBe("failed");
  expect(result.limitations.join(" ").toLowerCase()).not.toContain("no external skills");
});
