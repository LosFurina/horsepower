import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";
import { createDefaultTransport, createFileLock, defaultFilesystem, isNewerVersion, runUpdate, type UpdateTransport, type UpdateResult, type ReleaseIdentity } from "../../src/release/updater.js";
import { writeFixtureRelease } from "../fixtures/managed-installation.js";

const temporaryDirectories: string[] = [];
async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "horsepower-updater-"));
  temporaryDirectories.push(path);
  return path;
}
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

const entryPoints = {
  cli: "bin/horsepower",
  extension: "pi/extensions/horsepower/index.js",
  skill: "pi/skills/horsepower/SKILL.md",
} as const;

/**
 * Build a minimal gzipped tar archive from a fixture directory, returning
 * the same format that the release builder produces (canonical gzip header,
 * tar entries, etc.) so that inspectReleaseArchive can parse it.
 */
async function buildFixtureArchive(version: string): Promise<{ archive: Buffer; checksum: Buffer; checksumHex: string }> {
  const root = await temp();

  // Write fixture files matching the release layout
  for (const filePath of Object.values(entryPoints)) {
    const abs = join(root, filePath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, `owned:${filePath}\n`);
  }
  await mkdir(join(root, "resources", "agents"), { recursive: true });
  await writeFile(join(root, "resources", "agents", "coder.md"), "---\nname: coder\n---\n");

  // Compute digests
  const digests: Record<string, string> = {};
  for (const path of Object.values(entryPoints)) {
    digests[path] = sha256(await readFile(join(root, path)));
  }

  // Write manifest
  const manifest = {
    version,
    compatibility: { node: ">=22.19.0", pi: ">=0.80.10", openspec: ">=1.6.0" },
    entryPoints,
    digests,
  };
  await writeFile(join(root, "release-manifest.json"), JSON.stringify(manifest, null, 2));

  // Build tar.gz archive using the release module's archive creation
  const { buildRelease, createReleaseBuilder } = await import("../../src/release/index.js");

  // We need to build with a proper repository root; use a simple dir
  const releaseOutDir = await temp();

  // Create a minimal working tree that the release builder expects
  const repoRoot = await temp();
  await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "horsepower", version, private: true, type: "module" }));
  await mkdir(join(repoRoot, "dist", "cli"), { recursive: true });
  await writeFile(join(repoRoot, "dist", "cli", "horsepower.js"), `owned:bin/horsepower\n`);
  await mkdir(join(repoRoot, "dist", "extension"), { recursive: true });
  await writeFile(join(repoRoot, "dist", "extension", "index.js"), `owned:extension\n`);
  await writeFile(join(repoRoot, "LICENSE"), "MIT\n");
  await mkdir(join(repoRoot, "resources", "agents"), { recursive: true });
  await writeFile(join(repoRoot, "resources", "agents", "coder.md"), "---\nname: coder\n---\n");
  await mkdir(join(repoRoot, "resources", "skills", "horsepower"), { recursive: true });
  await writeFile(join(repoRoot, "resources", "skills", "horsepower", "SKILL.md"), "---\nname: horsepower\n---\n");

  const result = await createReleaseBuilder({
    listTrackedFiles: async () => [],
    scan: () => {},
  }).build({
    repositoryRoot: repoRoot,
    outputDir: releaseOutDir,
    version,
    runBuild: async () => {},
  });
  const archiveBuffer = await readFile(result.archivePath);
  const checksumHex = sha256(archiveBuffer);
  const checksum = Buffer.from(`${checksumHex}  horsepower-v${version}.tar.gz\n`);
  return { archive: archiveBuffer, checksum, checksumHex };
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

function stubTransport(assets: Map<string, { archive: Buffer; checksum: Buffer }>): UpdateTransport {
  return {
    async resolveLatestRelease(): Promise<ReleaseIdentity> {
      return { owner: "LosFurina", repo: "horsepower", version: "0.2.0" };
    },
    async downloadAssets(identity: ReleaseIdentity): Promise<{ archiveUrl: string; checksumUrl: string; archiveBuffer: Buffer; checksumBuffer: Buffer }> {
      const key = identity.version;
      const entry = assets.get(key);
      if (!entry) throw new Error(`UPDATE_DOWNLOAD_FAILED: no asset for ${key}`);
      return {
        archiveUrl: `https://github.com/LosFurina/horsepower/releases/download/v${key}/horsepower-v${key}.tar.gz`,
        checksumUrl: `https://github.com/LosFurina/horsepower/releases/download/v${key}/horsepower-v${key}.tar.gz.sha256`,
        archiveBuffer: entry.archive,
        checksumBuffer: entry.checksum,
      };
    },
  };
}

// ============================================================
// Tests
// ============================================================

test("isNewerVersion compares strict SemVer including alpha prereleases", () => {
  expect(isNewerVersion("0.2.0", "0.1.0")).toBe(true);
  expect(isNewerVersion("0.1.0", "0.2.0")).toBe(false);
  expect(isNewerVersion("0.1.0", "0.1.0")).toBe(false);
  expect(isNewerVersion("0.1.1", "0.1.0")).toBe(true);
  expect(isNewerVersion("1.0.0", "0.9.9")).toBe(true);
  // Prerelease
  expect(isNewerVersion("0.2.0-alpha.1", "0.1.0")).toBe(true);
  expect(isNewerVersion("0.1.0", "0.1.0-alpha.1")).toBe(true); // release > prerelease
  expect(isNewerVersion("0.1.0-alpha.2", "0.1.0-alpha.1")).toBe(true);
  expect(isNewerVersion("0.1.0-alpha.1", "0.1.0-alpha.2")).toBe(false);
  // Equal prerelease
  expect(isNewerVersion("0.1.0-alpha.1", "0.1.0-alpha.1")).toBe(false);
});

test("createFileLock acquires and releases exclusive lock", async () => {
  const root = await temp();
  const lockPath = join(root, "lock");
  const lock = createFileLock(lockPath, defaultFilesystem);
  await lock.acquire();
  const lock2 = createFileLock(lockPath, defaultFilesystem);
  await expect(lock2.acquire()).rejects.toThrow();
  await lock.release();
  await lock2.acquire();
  await lock2.release();
});

test("update reports already_current when version matches", async () => {
  const homeDir = await temp();
  await installFixture(homeDir, "0.1.0");

  const transport: UpdateTransport = {
    resolveLatestRelease: async () => ({ owner: "LosFurina", repo: "horsepower", version: "0.1.0" }),
    downloadAssets: async () => { throw new Error("should not be called"); },
  };

  const result = await runUpdate({
    homeDir,
    transport,
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(homeDir, ".pi/agent/horsepower/.update.lock"), defaultFilesystem),
  });

  expect(result.status).toBe("already_current");
  expect(result.resolvedVersion).toBe("0.1.0");
});

test("update rejects an untrusted latest identity and an exact downgrade before download", async () => {
  const homeDir = await temp();
  await installFixture(homeDir, "0.2.0");
  const downloadAssets = vi.fn(async () => { throw new Error("should not be called"); });
  const base = {
    homeDir, fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
  };
  const untrusted = await runUpdate({
    ...base,
    transport: { resolveLatestRelease: async () => ({ owner: "other", repo: "horsepower", version: "0.3.0" }), downloadAssets },
    lock: createFileLock(join(homeDir, ".pi/agent/horsepower/.update.lock"), defaultFilesystem),
  });
  expect(untrusted.status).toBe("failed");
  expect(untrusted.reason).toContain("official Horsepower repository");
  const exactDowngrade = await runUpdate({
    ...base,
    versionOverride: "0.1.0",
    transport: { resolveLatestRelease: async () => { throw new Error("should not resolve"); }, downloadAssets },
    lock: createFileLock(join(homeDir, ".pi/agent/horsepower/.update.lock"), defaultFilesystem),
  });
  expect(exactDowngrade.status).toBe("failed");
  expect(exactDowngrade.reason).toContain("downgrade");
  expect(downloadAssets).not.toHaveBeenCalled();
});

test("update rejects implicit downgrade", async () => {
  const homeDir = await temp();
  await installFixture(homeDir, "0.2.0");

  const transport: UpdateTransport = {
    resolveLatestRelease: async () => ({ owner: "LosFurina", repo: "horsepower", version: "0.1.0" }),
    downloadAssets: async () => { throw new Error("should not be called"); },
  };

  const result = await runUpdate({
    homeDir,
    transport,
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(homeDir, ".pi/agent/horsepower/.update.lock"), defaultFilesystem),
  });

  expect(result.status).toBe("failed");
  expect(result.reason).toContain("downgrade");
});

test("update rejects lock contention", async () => {
  const homeDir = await temp();
  await installFixture(homeDir, "0.1.0");

  const assets = new Map<string, { archive: Buffer; checksum: Buffer }>();
  const { archive, checksum } = await buildFixtureArchive("0.2.0");
  assets.set("0.2.0", { archive, checksum });

  const lockPath = join(homeDir, ".pi/agent/horsepower/.update.lock");
  await writeFile(lockPath, "contention-marker");

  const result = await runUpdate({
    homeDir,
    transport: stubTransport(assets),
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: '{"ok":true}', stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(lockPath, defaultFilesystem),
  });

  expect(result.status).toBe("failed");
  expect(result.reason).toContain("lock contention");
  await rm(lockPath);
});

test("update rolls back when post-update doctor fails", async () => {
  const homeDir = await temp();
  await installFixture(homeDir, "0.1.0");

  const { archive, checksum } = await buildFixtureArchive("0.2.0");
  const assets = new Map<string, { archive: Buffer; checksum: Buffer }>();
  assets.set("0.2.0", { archive, checksum });

  const result = await runUpdate({
    homeDir,
    transport: stubTransport(assets),
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "doctor failed", exitCode: 1 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(homeDir, ".pi/agent/horsepower/.update.lock"), defaultFilesystem),
  });

  expect(result.status).toBe("rolled_back");
  expect(result.reason).toContain("Doctor exited");

  const hp = join(homeDir, ".pi/agent/horsepower");
  const currentTarget = await readlink(join(hp, "current"));
  expect(currentTarget).toBe("versions/v0.1.0");
});

test("update succeeds from 0.1.0 to 0.2.0", async () => {
  const homeDir = await temp();
  await installFixture(homeDir, "0.1.0");

  const { archive, checksum } = await buildFixtureArchive("0.2.0");
  const assets = new Map<string, { archive: Buffer; checksum: Buffer }>();
  assets.set("0.2.0", { archive, checksum });

  const result = await runUpdate({
    homeDir,
    transport: stubTransport(assets),
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: '{"ok":true}', stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(homeDir, ".pi/agent/horsepower/.update.lock"), defaultFilesystem),
  });

  expect(result.status).toBe("updated");
  expect(result.installedVersion).toBe("0.2.0");

  const hp = join(homeDir, ".pi/agent/horsepower");
  const currentTarget = await readlink(join(hp, "current"));
  expect(currentTarget).toBe("versions/v0.2.0");
  expect(await readFile(join(hp, "current/bin/horsepower"), "utf8")).toBeTruthy();

  // Old version preserved
  const oldManifest = await readFile(join(hp, "versions/v0.1.0/release-manifest.json"), "utf8");
  expect(JSON.parse(oldManifest).version).toBe("0.1.0");
});

test("update rejects partial Pi integration without changing current", async () => {
  const homeDir = await temp();
  await installFixture(homeDir, "0.1.0");
  const hp = join(homeDir, ".pi/agent/horsepower");
  const extension = join(homeDir, ".pi/agent/extensions/horsepower");
  await mkdir(dirname(extension), { recursive: true });
  await symlink(join(hp, "current/pi/extensions/horsepower"), extension);
  const { archive, checksum } = await buildFixtureArchive("0.2.0");
  const result = await runUpdate({
    homeDir,
    transport: stubTransport(new Map([["0.2.0", { archive, checksum }]])),
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "", exitCode: 0 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(hp, ".update.lock"), defaultFilesystem),
  });
  expect(result.status).toBe("failed");
  expect(result.reason).toContain("partial or conflicting");
  expect(await readlink(join(hp, "current"))).toBe("versions/v0.1.0");
});

test("createDefaultTransport resolves latest release tag from GitHub redirect", async () => {
  const mockFetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("releases/latest")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://github.com/LosFurina/horsepower/releases/tag/v0.2.0" },
      });
    }
    return new Response(null, { status: 404 });
  });

  const transport = createDefaultTransport(mockFetch as unknown as typeof fetch);
  const identity = await transport.resolveLatestRelease();
  expect(identity).toEqual({ owner: "LosFurina", repo: "horsepower", version: "0.2.0" });
});

test("update rollback leaves no residual temp files or dangling current- links", async () => {
  const homeDir = await temp();
  await installFixture(homeDir, "0.1.0");

  const { archive, checksum } = await buildFixtureArchive("0.2.0");
  const assets = new Map<string, { archive: Buffer; checksum: Buffer }>();
  assets.set("0.2.0", { archive, checksum });

  const hp = join(homeDir, ".pi/agent/horsepower");
  // The current link already exists (created by installFixture), verify it
  expect(await readlink(join(hp, "current"))).toBe("versions/v0.1.0");

  // Run an update where doctor fails — triggers rollback
  const result = await runUpdate({
    homeDir,
    transport: stubTransport(assets),
    fs: defaultFilesystem,
    process: { execFile: async () => ({ stdout: "", stderr: "doctor failed", exitCode: 1 }) },
    clock: { now: () => new Date() },
    lock: createFileLock(join(hp, ".update.lock"), defaultFilesystem),
  });

  expect(result.status).toBe("rolled_back");

  // Check no residual state
  const entries = [];
  for (const name of await readdir(hp)) {
    if (name.startsWith(".current-") || name.startsWith(".current-prior-") || name.startsWith(".archive-") || name.endsWith(".tmp")) {
      entries.push(name);
    }
  }
  expect(entries).toEqual([]);

  // Current points back to original
  expect(await readlink(join(hp, "current"))).toBe("versions/v0.1.0");

  // The new version directory does exist (it was extracted before doctor ran)
  let versionExists = false;
  try {
    const manifest = JSON.parse(await readFile(join(hp, "versions/v0.2.0/release-manifest.json"), "utf8"));
    versionExists = manifest.version === "0.2.0";
  } catch { /* absent — acceptable */ }
  // The new version may or may not exist depending on when rollback happens
  // (extraction vs post-doctor). Both are valid.
  if (!versionExists) {
    // If version dir doesn't exist, confirm no partial v0.2.0 residue
    await expect(readdir(join(hp, "versions"))).resolves.toEqual(["v0.1.0"]);
  } else {
    // If it does exist, the current symlink still points to v0.1.0
    expect(await readlink(join(hp, "current"))).toBe("versions/v0.1.0");
  }
});

// Note: "test("update rejects partial Pi integration without changing current", ...)" is above.
// That test validates PI link conflict detection. Rollback residual state is above.
