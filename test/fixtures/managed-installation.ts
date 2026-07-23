import { createHash } from "node:crypto";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const fixtureReleaseEntryPoints = {
  cli: "bin/horsepower",
  extension: "pi/extensions/horsepower/index.js",
  skill: "pi/skills/horsepower/SKILL.md",
} as const;

export async function writeFixtureRelease(root: string, version: string): Promise<void> {
  for (const path of Object.values(fixtureReleaseEntryPoints)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), `owned:${path}\n`);
  }
  await mkdir(join(root, "resources", "agents"), { recursive: true });
  await writeFile(join(root, "resources", "agents", "coder.md"), [
    "---", "name: coder", "role: Implement scoped changes",
    "tools: [read, edit]", "standards: [correctness]", "---", "Implement directly.", "",
  ].join("\n"));
  const digests = Object.fromEntries(await Promise.all(Object.values(fixtureReleaseEntryPoints).map(async (path) => [
    path,
    createHash("sha256").update(await readFile(join(root, path))).digest("hex"),
  ])));
  await writeFile(join(root, "release-manifest.json"), JSON.stringify({
    version,
    compatibility: { node: ">=22.19.0", pi: ">=0.80.10 <0.82.0", openspec: ">=1.6.0 <2.0.0" },
    entryPoints: fixtureReleaseEntryPoints,
    digests,
  }));
}

// Synthetic pre-existing topology for CLI lifecycle tests. Installer E2E must invoke install.sh instead.
export async function installManagedFixture(homeDir: string, integration: "enabled" | "disabled" = "disabled") {
  const managed = join(homeDir, ".pi/agent/horsepower");
  await writeFixtureRelease(join(managed, "versions/v0.1.0"), "0.1.0");
  await symlink("versions/v0.1.0", join(managed, "current"));
  const extension = join(homeDir, ".pi/agent/extensions/horsepower");
  const skill = join(homeDir, ".pi/agent/skills/horsepower");
  const cli = join(homeDir, ".local/bin/horsepower");
  await mkdir(dirname(cli), { recursive: true });
  await symlink(join(managed, "current/bin/horsepower"), cli);
  if (integration === "enabled") {
    for (const [path, target] of [
      [extension, join(managed, "current/pi/extensions/horsepower")],
      [skill, join(managed, "current/pi/skills/horsepower")],
    ] as const) {
      await mkdir(dirname(path), { recursive: true });
      await symlink(target, path);
    }
  }
  return { managed, extension, skill, cli };
}
