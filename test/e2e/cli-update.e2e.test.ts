import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createDefaultTransport, defaultFilesystem, runUpdate, createFileLock, createProcessSeam, type UpdateTransport, type ReleaseIdentity, type UpdateResult } from "../../src/release/updater.js";
import { createReleaseBuilder } from "../../src/release/index.js";
import { fixtureReleaseEntryPoints, writeFixtureRelease } from "../fixtures/managed-installation.js";
import { createCli, type CliOptions } from "../../src/cli/app.js";

const temporaryDirectories: string[] = [];
async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "horsepower-update-e2e-"));
  temporaryDirectories.push(path);
  return path;
}
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function buildFixtureArchive(version: string, fixtureRoot: string): Promise<{ archive: Buffer; checksum: Buffer; checksumHex: string }> {
  // The fixture root has files in release layout (bin/horsepower, pi/extensions/..., pi/skills/...).
  // The release builder expects a repository layout (dist/cli/horsepower.js, dist/extension/index.js, etc.).
  // Create the required repository-side files.
  const distCliDir = join(fixtureRoot, "dist", "cli");
  const distExtDir = join(fixtureRoot, "dist", "extension");
  const skillsDir = join(fixtureRoot, "resources", "skills", "horsepower");
  await mkdir(distCliDir, { recursive: true });
  await mkdir(distExtDir, { recursive: true });
  await mkdir(skillsDir, { recursive: true });

  // Copy entry-point content into dist/ (release builder copies dist/ -> entry points)
  await writeFile(join(distCliDir, "horsepower.js"), `owned:bin/horsepower\n`);
  await writeFile(join(distExtDir, "index.js"), `owned:extension\n`);
  await writeFile(join(fixtureRoot, "LICENSE"), "MIT\n");
  // The release builder's stageRelease also reads package.json
  await writeFile(join(fixtureRoot, "package.json"), JSON.stringify({ name: "horsepower", version, private: true, type: "module" }));
  // Also need SKILL.md in resources/skills/horsepower/ for the builder
  await writeFile(join(skillsDir, "SKILL.md"), "---\nname: horsepower\n---\n");

  const releasePath = await mkdtemp(join(tmpdir(), `horsepower-release-${version}-`));
  temporaryDirectories.push(releasePath);
  const builder = createReleaseBuilder({
    listTrackedFiles: async () => [],
    scan: () => {},
  });
  const result = await builder.build({
    repositoryRoot: fixtureRoot,
    outputDir: releasePath,
    version,
    runBuild: async () => {},
  });
  const archiveBuffer = await readFile(result.archivePath);
  const checksumHex = sha256(archiveBuffer);
  const checksumBuffer = Buffer.from(`${checksumHex}  horsepower-v${version}.tar.gz\n`);
  return { archive: archiveBuffer, checksum: checksumBuffer, checksumHex };
}

async function installFixture(homeDir: string, version: string): Promise<void> {
  const hp = join(homeDir, ".pi/agent/horsepower");
  const release = join(hp, `versions/v${version}`);
  await writeFixtureRelease(release, version);
  await symlink(`versions/v${version}`, join(hp, "current"));
  const cli = join(homeDir, ".local/bin/horsepower");
  await mkdir(dirname(cli), { recursive: true });
  await symlink(join(hp, "current/bin/horsepower"), cli);
}

// ---------------------------------------------------------------------------
// E2E: packaged local fixture covering the full spec
// ---------------------------------------------------------------------------

test("local fixture E2E: successful update, no-op, help without side effect, retained prior version", async () => {
  const root = await temp();
  const homeDir = join(root, "home");
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });

  // Install v0.1.0
  await installFixture(homeDir, "0.1.0");
  // Write user state
  const hp = join(homeDir, ".pi/agent/horsepower");
  await mkdir(join(hp, "state"), { recursive: true });
  await mkdir(join(hp, "memory"), { recursive: true });
  await writeFile(join(hp, "state/keep"), "user state");
  await writeFile(join(hp, "memory/keep"), "user memory");

  // Build v0.2.0 fixture assets
  const fixtureRoot = await temp();
  await writeFixtureRelease(fixtureRoot, "0.2.0");
  const { archive: v020Archive, checksum: v020Checksum, checksumHex } = await buildFixtureArchive("0.2.0", fixtureRoot);

  const assets = new Map<string, { archive: Buffer; checksum: Buffer }>();
  assets.set("0.2.0", { archive: v020Archive, checksum: v020Checksum });

  const transport: UpdateTransport = {
    resolveLatestRelease: async () => ({ owner: "LosFurina", repo: "horsepower", version: "0.2.0" }),
    downloadAssets: async (identity: ReleaseIdentity) => {
      const entry = assets.get(identity.version);
      if (!entry) throw new Error(`no asset for ${identity.version}`);
      return {
        archiveUrl: `https://github.com/LosFurina/horsepower/releases/download/v${identity.version}/horsepower-v${identity.version}.tar.gz`,
        checksumUrl: `https://github.com/LosFurina/horsepower/releases/download/v${identity.version}/horsepower-v${identity.version}.tar.gz.sha256`,
        archiveBuffer: entry.archive,
        checksumBuffer: entry.checksum,
      };
    },
  };

  const lock = createFileLock(join(hp, ".update.lock"), defaultFilesystem);
  const result: UpdateResult = await runUpdate({
    homeDir,
    transport,
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: '{"ok":true}', stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock,
  });

  // Assert: successful update
  expect(result.status).toBe("updated");
  expect(result.installedVersion).toBe("0.2.0");
  expect(result.activeVersion).toBe("0.2.0");
  expect(result.currentVersion).toBe("0.1.0");

  // Assert: current points to new version
  const currentTarget = await readlink(join(hp, "current"));
  expect(currentTarget).toBe("versions/v0.2.0");

  // Assert: old version still exists
  const oldManifest = await readFile(join(hp, "versions/v0.1.0/release-manifest.json"), "utf8");
  expect(JSON.parse(oldManifest).version).toBe("0.1.0");

  // Assert: user state unchanged
  expect(await readFile(join(hp, "state/keep"), "utf8")).toBe("user state");
  expect(await readFile(join(hp, "memory/keep"), "utf8")).toBe("user memory");

  // Assert: already-current no-op
  const transportNoop: UpdateTransport = {
    resolveLatestRelease: async () => ({ owner: "LosFurina", repo: "horsepower", version: "0.2.0" }),
    downloadAssets: async () => { throw new Error("should not be called"); },
  };
  const noopResult = await runUpdate({
    homeDir,
    transport: transportNoop,
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: '{"ok":true}', stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(hp, ".update.lock"), defaultFilesystem),
  });
  expect(noopResult.status).toBe("already_current");
});

test("local fixture E2E: parameterized failure variants", async () => {
  const root = await temp();
  const homeDir = join(root, "home");
  await installFixture(homeDir, "0.1.0");
  const hp = join(homeDir, ".pi/agent/horsepower");

  // Build valid 0.2.0 fixture
  const fixtureRoot = await temp();
  await writeFixtureRelease(fixtureRoot, "0.2.0");

  // Bad checksum variant
  const validBuild = await buildFixtureArchive("0.2.0", fixtureRoot);
  const badChecksum = Buffer.from(`${"0".repeat(64)}  horsepower-v0.2.0.tar.gz\n`);

  const validAssets = new Map<string, { archive: Buffer; checksum: Buffer }>();
  validAssets.set("0.2.0", { archive: validBuild.archive, checksum: validBuild.checksum });

  const badAssets = new Map<string, { archive: Buffer; checksum: Buffer }>();
  badAssets.set("0.2.0", { archive: validBuild.archive, checksum: badChecksum });

  // Test: invalid checksum
  const badChecksumResult = await runUpdate({
    homeDir,
    transport: {
      resolveLatestRelease: async () => ({ owner: "LosFurina", repo: "horsepower", version: "0.2.0" }),
      downloadAssets: async () => {
        const entry = badAssets.get("0.2.0")!;
        return {
          archiveUrl: "",
          checksumUrl: "",
          archiveBuffer: entry.archive,
          checksumBuffer: entry.checksum,
        };
      },
    },
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: '{"ok":true}', stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(hp, ".update.lock"), defaultFilesystem),
  });
  expect(badChecksumResult.status).toBe("failed");
  expect(badChecksumResult.reason).toContain("checksum");
  // Current unchanged
  const currentTarget = await readlink(join(hp, "current"));
  expect(currentTarget).toBe("versions/v0.1.0");

  // Test: an unsafe/non-archive candidate with a matching checksum fails before placement.
  const unsafeArchive = Buffer.from("not-a-release-archive");
  const unsafeChecksum = Buffer.from(`${sha256(unsafeArchive)}  horsepower-v0.2.0.tar.gz\n`);
  const unsafeResult = await runUpdate({
    homeDir,
    transport: {
      resolveLatestRelease: async () => ({ owner: "LosFurina", repo: "horsepower", version: "0.2.0" }),
      downloadAssets: async () => ({ archiveUrl: "", checksumUrl: "", archiveBuffer: unsafeArchive, checksumBuffer: unsafeChecksum }),
    },
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(hp, ".update.lock"), defaultFilesystem),
  });
  expect(unsafeResult.status).toBe("failed");
  expect(await readlink(join(hp, "current"))).toBe("versions/v0.1.0");

  // Test: an incompatible existing immutable destination is never activated or overwritten.
  const incompatibleDestination = join(hp, "versions/v0.2.0");
  await writeFixtureRelease(incompatibleDestination, "0.2.0");
  const incompatibleManifestPath = join(incompatibleDestination, "release-manifest.json");
  const incompatibleManifest = JSON.parse(await readFile(incompatibleManifestPath, "utf8"));
  incompatibleManifest.compatibility.node = ">=999.0.0";
  await writeFile(incompatibleManifestPath, JSON.stringify(incompatibleManifest));
  const incompatibleResult = await runUpdate({
    homeDir,
    transport: {
      resolveLatestRelease: async () => ({ owner: "LosFurina", repo: "horsepower", version: "0.2.0" }),
      downloadAssets: async () => ({ archiveUrl: "", checksumUrl: "", archiveBuffer: validBuild.archive, checksumBuffer: validBuild.checksum }),
    },
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(hp, ".update.lock"), defaultFilesystem),
  });
  expect(incompatibleResult.status).toBe("failed");
  expect(incompatibleResult.reason).toContain("existing version invalid");
  expect(await readlink(join(hp, "current"))).toBe("versions/v0.1.0");
  await rm(incompatibleDestination, { recursive: true, force: true });

  // Test: post-doctor failure => rollback
  const doctorFailResult = await runUpdate({
    homeDir,
    transport: {
      resolveLatestRelease: async () => ({ owner: "LosFurina", repo: "horsepower", version: "0.2.0" }),
      downloadAssets: async () => {
        const entry = validAssets.get("0.2.0")!;
        return {
          archiveUrl: "",
          checksumUrl: "",
          archiveBuffer: entry.archive,
          checksumBuffer: entry.checksum,
        };
      },
    },
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "doctor failure", exitCode: 1 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(hp, ".update.lock"), defaultFilesystem),
  });
  expect(doctorFailResult.status).toBe("rolled_back");
  const currentTargetAfter = await readlink(join(hp, "current"));
  expect(currentTargetAfter).toBe("versions/v0.1.0");
});

test("help does not trigger network or installation mutation", async () => {
  // Create a CLI with a transport that would fail if called
  const root = await temp();
  const homeDir = join(root, "home");
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });
  await installFixture(homeDir, "0.1.0");

  // If anything calls fetch, fail
  const fetch = vi.fn(async () => { throw new Error("help must not trigger network"); });

  const cli = createCli({
    homeDir,
    cwd,
    platform: "linux",
    models: {},
    runOpenSpec: async () => ({ code: 0, stdout: "", stderr: "" }),
    fetch: fetch as unknown as typeof fetch,
    updateTransport: {
      resolveLatestRelease: async () => { throw new Error("help must not resolve"); },
      downloadAssets: async () => { throw new Error("help must not download"); },
    },
  });

  // Help should succeed without calling transport or fetch
  const helpResult = await cli.run(["--help"]);
  expect(helpResult.exitCode).toBe(0);
  expect(helpResult.stdout).toContain("update");
  expect(fetch).not.toHaveBeenCalled();

  const updateHelp = await cli.run(["update", "--help"]);
  expect(updateHelp.exitCode).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
