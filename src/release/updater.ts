import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import type { JsonObject } from "../config/json-store.js";
import { validateReleaseCompatibility } from "../release-manifest.js";
import { inspectReleaseArchive, scanPublicContent, type ArchiveEntry } from "./index.js";
import { projectFailure } from "../failures/captain-failure.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateStatus = "already_current" | "updated" | "failed" | "rolled_back";

export interface UpdateResult {
  status: UpdateStatus;
  currentVersion: string;
  resolvedVersion?: string;
  installedVersion?: string;
  activeVersion?: string;
  integrationStatus?: "enabled" | "disabled";
  reloadRequired?: boolean;
  reason?: string;
}

export interface ReleaseIdentity {
  owner: string;
  repo: string;
  version: string;
}

export interface ReleaseAsset {
  archiveUrl: string;
  checksumUrl: string;
  archiveBuffer: Buffer;
  checksumBuffer: Buffer;
}

export interface UpdateTransport {
  resolveLatestRelease(): Promise<ReleaseIdentity>;
  downloadAssets(identity: ReleaseIdentity): Promise<ReleaseAsset>;
}

export interface FilesystemSeam {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: Buffer): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  lstat(path: string): Promise<Awaited<ReturnType<typeof lstat>>>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  chmod(path: string, mode: number): Promise<void>;
}

export interface ProcessSeam {
  execFile(file: string, args: readonly string[], options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface ClockSeam {
  now(): Date;
}

export interface LockSeam {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const OFFICIAL_RELEASE_HOST = "github.com";
export const OFFICIAL_RELEASE_OWNER = "LosFurina";
export const OFFICIAL_RELEASE_REPO = "horsepower";
export const OFFICIAL_RELEASE_IDENTITY = `https://${OFFICIAL_RELEASE_HOST}/${OFFICIAL_RELEASE_OWNER}/${OFFICIAL_RELEASE_REPO}`;

const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 50 * 1024 * 1024; // 50 MB
const DOWNLOAD_TIMEOUT_MS = 30_000;
const DOCTOR_TIMEOUT_MS = 15_000;

const releaseVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

const entryPoints = {
  cli: "bin/horsepower",
  extension: "pi/extensions/horsepower/index.js",
  skill: "pi/skills/horsepower/SKILL.md",
} as const;

const criticalFiles = Object.values(entryPoints);

// ---------------------------------------------------------------------------
// SemVer helpers
// ---------------------------------------------------------------------------

function parseSemVer(value: string): { major: number; minor: number; patch: number; prerelease: string[] } | undefined {
  const match = releaseVersionPattern.exec(value);
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const prerelease: string[] = [];
  if (match[4] !== undefined) {
    const dashIndex = match[0].indexOf("-");
    const plusIndex = match[0].indexOf("+", dashIndex + 1);
    const prereleaseStr = plusIndex >= 0 ? match[0].slice(dashIndex + 1, plusIndex) : match[0].slice(dashIndex + 1);
    prerelease.push(...prereleaseStr.split("."));
  }
  return { major, minor, patch, prerelease };
}

function compareSemVer(left: string, right: string): number {
  const l = parseSemVer(left);
  const r = parseSemVer(right);
  if (!l || !r) return 0;
  if (l.major !== r.major) return l.major - r.major;
  if (l.minor !== r.minor) return l.minor - r.minor;
  if (l.patch !== r.patch) return l.patch - r.patch;
  const lHasPrerelease = l.prerelease.length > 0;
  const rHasPrerelease = r.prerelease.length > 0;
  if (lHasPrerelease !== rHasPrerelease) return lHasPrerelease ? -1 : 1;
  const minLen = Math.min(l.prerelease.length, r.prerelease.length);
  for (let i = 0; i < minLen; i++) {
    const lp = l.prerelease[i]!;
    const rp = r.prerelease[i]!;
    if (lp !== rp) {
      const lNum = /^\d+$/u.test(lp) ? Number(lp) : undefined;
      const rNum = /^\d+$/u.test(rp) ? Number(rp) : undefined;
      if (lNum !== undefined && rNum !== undefined) return lNum - rNum;
      if (lNum !== undefined) return -1;
      if (rNum !== undefined) return 1;
      return lp < rp ? -1 : 1;
    }
  }
  return l.prerelease.length - r.prerelease.length;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareSemVer(candidate, current) > 0;
}

// ---------------------------------------------------------------------------
// Default transport using the real fetch
// ---------------------------------------------------------------------------

export function createDefaultTransport(fetchFn: typeof fetch): UpdateTransport {
  return {
    async resolveLatestRelease(): Promise<ReleaseIdentity> {
      const url = `https://${OFFICIAL_RELEASE_HOST}/${OFFICIAL_RELEASE_OWNER}/${OFFICIAL_RELEASE_REPO}/releases/latest`;
      const response = await fetchFn(url, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      if (response.status < 300 || response.status >= 400) {
        throw new Error(`UPDATE_RESOLVE_FAILED: expected redirect to latest release, got ${response.status}`);
      }
      const location = response.headers.get("location");
      if (!location) throw new Error("UPDATE_RESOLVE_FAILED: no location header");
      const parsed = parseReleaseTagFromUrl(location);
      if (!parsed || parsed.owner !== OFFICIAL_RELEASE_OWNER || parsed.repo !== OFFICIAL_RELEASE_REPO) {
        throw new Error("UPDATE_RESOLVE_FAILED: invalid release identity");
      }
      return parsed;
    },

    async downloadAssets(identity: ReleaseIdentity): Promise<ReleaseAsset> {
      const archiveUrl = `https://${OFFICIAL_RELEASE_HOST}/${identity.owner}/${identity.repo}/releases/download/v${identity.version}/horsepower-v${identity.version}.tar.gz`;
      const checksumUrl = `${archiveUrl}.sha256`;
      const [archiveResponse, checksumResponse] = await Promise.all([
        boundedFetch(fetchFn, archiveUrl, MAX_RESPONSE_BYTES),
        boundedFetch(fetchFn, checksumUrl, 1024),
      ]);
      const archiveBuffer = Buffer.from(await archiveResponse.arrayBuffer());
      const checksumBuffer = Buffer.from(await checksumResponse.arrayBuffer());
      return { archiveUrl, checksumUrl, archiveBuffer, checksumBuffer };
    },
  };
}

async function boundedFetch(fetchFn: typeof fetch, url: string, maxBytes: number): Promise<Response> {
  let currentUrl: string | undefined = url;
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    const response: Response = await fetchFn(currentUrl!, {
      redirect: "manual",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("UPDATE_DOWNLOAD_FAILED: redirect without location");
      const parsed: URL = new URL(location, currentUrl);
      if (parsed.protocol !== "https:") throw new Error("UPDATE_DOWNLOAD_FAILED: non-HTTPS redirect");
      currentUrl = parsed.href;
      continue;
    }
    if (!response.ok) throw new Error(`UPDATE_DOWNLOAD_FAILED: HTTP ${response.status}`);
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      throw new Error("UPDATE_DOWNLOAD_FAILED: response exceeds size limit");
    }
    return response;
  }
  throw new Error("UPDATE_DOWNLOAD_FAILED: too many redirects");
}

function parseReleaseTagFromUrl(url: string): ReleaseIdentity | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== OFFICIAL_RELEASE_HOST) return undefined;
    const parts = parsed.pathname.split("/").filter(Boolean);
    // Expected: /LosFurina/horsepower/releases/tag/v1.2.3
    if (parts.length < 5) return undefined;
    if (parts[2] !== "releases" || parts[3] !== "tag") return undefined;
    const owner = parts[0]!;
    const repo = parts[1]!;
    const tag = parts[4]!;
    if (!tag || !tag.startsWith("v")) return undefined;
    const version = tag.slice(1);
    if (!releaseVersionPattern.test(version)) return undefined;
    return { owner, repo, version };
  } catch { return undefined; }
}

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// Managed topology helpers (reuse patterns from app.ts)
// ---------------------------------------------------------------------------

function installTopology(home: string) {
  const root = join(home, ".pi", "agent", "horsepower");
  return {
    root,
    current: join(root, "current"),
    versions: join(root, "versions"),
    extension: { path: join(home, ".pi", "agent", "extensions", "horsepower"), target: join(root, "current", "pi", "extensions", "horsepower") },
    skill: { path: join(home, ".pi", "agent", "skills", "horsepower"), target: join(root, "current", "pi", "skills", "horsepower") },
    cli: { path: join(home, ".local", "bin", "horsepower"), target: join(root, "current", "bin", "horsepower") },
    links: [] as Array<{ path: string; target: string }>,
  };
}

class ManagedTopologyError extends Error {
  constructor(message: string) { super(message); this.name = "ManagedTopologyError"; }
}

async function verifyNoSymlinkPath(root: string, candidate: string, finalType: "directory" | "file"): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate);
  if (pathFromRoot === "" || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || isAbsolute(pathFromRoot)) {
    throw new ManagedTopologyError(`Unsafe managed path: ${resolvedCandidate}`);
  }
  let current = resolvedRoot;
  const components = pathFromRoot.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new ManagedTopologyError(`Refusing symbolic link in managed path: ${current}`);
    const final = index === components.length - 1;
    if ((!final || finalType === "directory") && !info.isDirectory()) throw new ManagedTopologyError(`Expected managed directory: ${current}`);
    if (final && finalType === "file" && !info.isFile()) throw new ManagedTopologyError(`Expected managed regular file: ${current}`);
  }
}

async function verifyTrustedPath(trustedRoot: string, candidate: string, allowFinalSymlink = false): Promise<void> {
  const root = resolve(trustedRoot);
  const target = resolve(candidate);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`Unsafe destructive path: ${target}`);
  }
  try {
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink()) throw new Error(`Refusing symbolic link trust root: ${root}`);
    if (!rootInfo.isDirectory()) throw new Error(`Refusing non-directory trust root: ${root}`);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
    throw cause;
  }
  let current = root;
  const components = pathFromRoot.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    let info;
    try { info = await lstat(current); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return; throw cause; }
    if (info.isSymbolicLink() && !(allowFinalSymlink && index === components.length - 1)) throw new Error(`Refusing symbolic link in destructive path: ${current}`);
  }
}

async function readManagedManifest(release: string, fs: FilesystemSeam): Promise<JsonObject> {
  const manifestPath = join(release, "release-manifest.json");
  await verifyNoSymlinkPath(dirname(release), release, "directory");
  await verifyNoSymlinkPath(release, manifestPath, "file");
  const manifestBytes = await fs.readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as JsonObject;
  const keys = Object.keys(manifest).sort().join(",");
  if (keys !== "compatibility,digests,entryPoints,version") throw new ManagedTopologyError("Invalid release manifest fields");
  if (typeof manifest.version !== "string" || !releaseVersionPattern.test(manifest.version)) throw new ManagedTopologyError("Invalid release manifest version");
  try { validateReleaseCompatibility(manifest.compatibility); }
  catch (cause) { throw new ManagedTopologyError((cause as Error).message); }
  return manifest;
}

async function managedRootState(root: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try {
    const info = await lstat(root);
    return info.isDirectory() && !info.isSymbolicLink() ? { status: "owned" } : { status: "conflict", message: `Refusing unowned Horsepower root: ${root}` };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    throw cause;
  }
}

async function currentState(root: string, current: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try {
    const info = await lstat(current);
    if (!info.isSymbolicLink()) return { status: "conflict", message: `Refusing non-symlink: ${current}` };
    const target = await readlink(current);
    const versions = join(resolve(root), "versions");
    const resolved = resolve(dirname(current), target);
    const name = resolved.startsWith(`${versions}/`) && dirname(resolved) === versions ? resolved.slice(versions.length + 1) : "";
    if (!name.startsWith("v") || !releaseVersionPattern.test(name.slice(1))) {
      return { status: "conflict", message: `Refusing unmanaged current target: ${current}` };
    }
    return { status: "owned" };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    if (cause instanceof ManagedTopologyError) return { status: "conflict", message: cause.message };
    throw cause;
  }
}

async function linkState(path: string, expected: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try {
    const info = await lstat(path);
    if (!info.isSymbolicLink()) return { status: "conflict", message: `Refusing non-symlink: ${path}` };
    const target = await readlink(path);
    const actual = resolve(dirname(path), target);
    return actual === resolve(expected) ? { status: "owned" } : { status: "conflict", message: `Refusing unrelated symlink: ${path}` };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { status: "absent" };
    throw cause;
  }
}

// ---------------------------------------------------------------------------
// Lock implementation
// ---------------------------------------------------------------------------

export function createFileLock(lockPath: string, fs: FilesystemSeam): LockSeam {
  let acquired = false;
  return {
    async acquire(): Promise<void> {
      const uuid = randomUUID();
      const tmpPath = `${lockPath}.${uuid}.tmp`;
      try {
        await fs.mkdir(lockPath, { mode: 0o700 });
        acquired = true;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
          throw new Error("UPDATE_LOCK_CONTENTION: another update is in progress");
        }
        throw cause;
      } finally {
        await fs.rm(tmpPath, { force: true });
      }
    },
    async release(): Promise<void> {
      if (acquired) {
        await fs.rm(lockPath, { recursive: true, force: true });
        acquired = false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Default filesystem seam
// ---------------------------------------------------------------------------

export const defaultFilesystem: FilesystemSeam = {
  readFile: (path) => readFile(path),
  writeFile: (path, content) => writeFile(path, content),
  mkdir: async (path, opts) => { await mkdir(path, opts); },
  lstat: (path) => lstat(path),
  readlink: (path) => readlink(path),
  symlink: (target, path) => symlink(target, path),
  rename: (oldPath, newPath) => rename(oldPath, newPath),
  rm: (path, opts) => rm(path, opts),
  mkdtemp: (prefix) => mkdtemp(prefix),
  chmod: (path, mode) => chmod(path, mode),
};

// ---------------------------------------------------------------------------
// Core updater
// ---------------------------------------------------------------------------

export interface UpdaterOptions {
  homeDir: string;
  transport: UpdateTransport;
  fs: FilesystemSeam;
  process: ProcessSeam;
  clock: ClockSeam;
  lock: LockSeam;
  versionOverride?: string; // for --version VERSION
}

export async function runUpdate(options: UpdaterOptions): Promise<UpdateResult> {
  const { homeDir, transport, fs, process: proc, clock, lock } = options;
  const topology = installTopology(homeDir);

  // Snapshot current state
  const managedRoot = await managedRootState(topology.root);
  if (managedRoot.status === "conflict") {
    return failResult("installation ownership conflict", managedRoot.message ?? "ownership conflict");
  }
  if (managedRoot.status === "absent") {
    return failResult("no installation", "Horsepower is not installed");
  }

  // Read current version
  let currentVersion: string;
  try {
    const currentTarget = await fs.readlink(topology.current);
    const resolvedCurrent = resolve(dirname(topology.current), currentTarget);
    const manifest = await readManagedManifest(resolvedCurrent, fs);
    currentVersion = String(manifest.version);
  } catch (cause) {
    return failResult("invalid current", (cause as Error).message);
  }

  // Resolve target version
  let resolvedVersion: string;
  if (options.versionOverride) {
    resolvedVersion = options.versionOverride;
    if (!releaseVersionPattern.test(resolvedVersion)) {
      return failResult("invalid version", `Invalid version: ${resolvedVersion}`);
    }
  } else {
    try {
      const identity = await transport.resolveLatestRelease();
      if (identity.owner !== OFFICIAL_RELEASE_OWNER || identity.repo !== OFFICIAL_RELEASE_REPO || !releaseVersionPattern.test(identity.version)) {
        return failResult("resolve failed", "Resolved release identity is not the official Horsepower repository");
      }
      resolvedVersion = identity.version;
    } catch (cause) {
      return failResult("resolve failed", (cause as Error).message);
    }
  }

  // Equal-version no-op
  if (resolvedVersion === currentVersion) {
    return {
      status: "already_current",
      currentVersion,
      resolvedVersion,
    };
  }

  // This change does not authorize downgrade, including exact-version selection.
  if (!isNewerVersion(resolvedVersion, currentVersion)) {
    return failResult("downgrade prevented", `Resolved version ${resolvedVersion} is older than current ${currentVersion}`);
  }

  // Acquire lock
  const lockPath = join(topology.root, ".update.lock");
  try {
    await lock.acquire();
  } catch (cause) {
    return failResult("lock contention", (cause as Error).message);
  }

  try {
    return await performUpdate({
      topology,
      currentVersion,
      resolvedVersion,
      transport,
      fs,
      proc,
      clock,
      homeDir,
    });
  } finally {
    await lock.release();
  }
}

// ---------------------------------------------------------------------------
// Internal update logic
// ---------------------------------------------------------------------------

interface PerformUpdateOptions {
  topology: ReturnType<typeof installTopology>;
  currentVersion: string;
  resolvedVersion: string;
  transport: UpdateTransport;
  fs: FilesystemSeam;
  proc: ProcessSeam;
  clock: ClockSeam;
  homeDir: string;
}

async function performUpdate(options: PerformUpdateOptions): Promise<UpdateResult> {
  const { topology, currentVersion, resolvedVersion, transport, fs, proc, clock, homeDir } = options;

  // Snapshot integration state before any mutation
  let integrationStatus: "enabled" | "disabled" = "disabled";
  try {
    const extState = await linkState(topology.extension.path, topology.extension.target);
    const skillState = await linkState(topology.skill.path, topology.skill.target);
    if (extState.status === "conflict" || skillState.status === "conflict"
      || (extState.status === "owned") !== (skillState.status === "owned")) {
      return failResult("integration conflict", "Pi integration links are partial or conflicting; repair before updating");
    }
    if (extState.status === "owned" && skillState.status === "owned") integrationStatus = "enabled";
  } catch (cause) {
    return failResult("preflight failed", (cause as Error).message);
  }

  // Verify CLI link ownership
  try {
    await verifyTrustedPath(homeDir, topology.cli.path, true);
    const cliState = await linkState(topology.cli.path, topology.cli.target);
    if (cliState.status !== "owned") {
      return failResult("cli link unowned", "CLI link is not owned by Horsepower");
    }
  } catch (cause) {
    return failResult("cli link issue", (cause as Error).message);
  }

  // Verify existing versions tree ownership
  try {
    const versionsInfo = await fs.lstat(topology.versions);
    if (!versionsInfo.isDirectory() || versionsInfo.isSymbolicLink()) {
      return failResult("versions unowned", "Versions directory is not owned by Horsepower");
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
      return failResult("versions issue", (cause as Error).message);
    }
  }

  // Download assets
  let asset: ReleaseAsset;
  try {
    const identity: ReleaseIdentity = { owner: OFFICIAL_RELEASE_OWNER, repo: OFFICIAL_RELEASE_REPO, version: resolvedVersion };
    asset = await transport.downloadAssets(identity);
  } catch (cause) {
    return failResult("download failed", (cause as Error).message);
  }

  // Verify checksum
  const archiveName = `horsepower-v${resolvedVersion}.tar.gz`;
  const checksumContent = asset.checksumBuffer.toString("utf8").trim();
  const checksumParts = checksumContent.split(/\s+/u);
  const expectedChecksum = checksumParts[0];
  if (!expectedChecksum || !/^[a-f0-9]{64}$/u.test(expectedChecksum)
    || checksumParts.length !== 2 || checksumParts[1] !== archiveName) {
    return failResult("invalid checksum", "Checksum file has invalid format or asset name");
  }
  const actualChecksum = sha256(asset.archiveBuffer);
  if (actualChecksum !== expectedChecksum) {
    return failResult("checksum mismatch", `Expected ${expectedChecksum}, got ${actualChecksum}`);
  }

  // Stage in temporary directory
  const workDir = await fs.mkdtemp(join(tmpdir(), `horsepower-update-${process.pid}-`));
  try {
    // Extract archive into staging
    const stageRoot = join(workDir, "horsepower");
    await fs.mkdir(stageRoot, { recursive: true, mode: 0o755 });
    try {
      await extractArchive(asset.archiveBuffer, stageRoot, fs);
    } catch (cause) {
      return failResult("invalid archive", (cause as Error).message);
    }

    // Read and validate manifest
    const manifestPath = join(stageRoot, "release-manifest.json");
    let manifest: JsonObject;
    try {
      const manifestBytes = await fs.readFile(manifestPath);
      manifest = JSON.parse(manifestBytes.toString("utf8")) as JsonObject;
    } catch (cause) {
      return failResult("invalid manifest", (cause as Error).message);
    }
    if (manifest.version !== resolvedVersion) {
      return failResult("manifest version mismatch", `Expected ${resolvedVersion}, got ${manifest.version}`);
    }
    try { validateReleaseCompatibility(manifest.compatibility); }
    catch (cause) { return failResult("compatibility mismatch", (cause as Error).message); }

    // Validate critical file digests
    const digests = manifest.digests as Record<string, string> | undefined;
    if (!digests) return failResult("invalid manifest", "Missing digests");
    for (const path of criticalFiles) {
      const expectedDigest = digests[path];
      if (!expectedDigest || !/^[a-f0-9]{64}$/u.test(expectedDigest)) {
        return failResult("invalid digest", `Invalid digest for ${path}`);
      }
      const filePath = join(stageRoot, path);
      const fileBytes = await fs.readFile(filePath);
      if (sha256(fileBytes) !== expectedDigest) {
        return failResult("digest mismatch", `Digest mismatch for ${path}`);
      }
    }

    // Verify entry point structure
    const entries = manifest.entryPoints as Record<string, string> | undefined;
    if (!entries || entries.cli !== entryPoints.cli || entries.extension !== entryPoints.extension || entries.skill !== entryPoints.skill) {
      return failResult("invalid entry points", "Entry points do not match expected structure");
    }

    // Check for existing version directory
    const destination = join(topology.versions, `v${resolvedVersion}`);
    let destinationExists = false;
    try {
      await fs.lstat(destination);
      destinationExists = true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        return failResult("destination check failed", (cause as Error).message);
      }
    }

    if (destinationExists) {
      // Verify the existing installation is valid
      try {
        const existingManifest = await readManagedManifest(destination, fs);
        if (existingManifest.version !== resolvedVersion) {
          return failResult("existing version invalid", `Destination exists with version ${existingManifest.version}`);
        }
      } catch (cause) {
        return failResult("existing version invalid", (cause as Error).message);
      }
      // Already exists and valid — activate it
    } else {
      // Place into immutable version directory
      await fs.mkdir(topology.versions, { recursive: true });
      try {
        await fs.rename(stageRoot, destination);
      } catch (cause) {
        return failResult("placement failed", (cause as Error).message);
      }
    }

    // Snapshot prior current for rollback
    let priorCurrentTarget: string | undefined;
    try {
      priorCurrentTarget = await fs.readlink(topology.current);
    } catch { /* absent means first install — not our case */ }

    // Atomically switch current
    const newCurrentTarget = `versions/v${resolvedVersion}`;
    const newCurrentLink = join(topology.root, `.current-${randomUUID().slice(0, 8)}`);
    await fs.symlink(newCurrentTarget, newCurrentLink);

    try {
      await fs.rename(newCurrentLink, topology.current);
    } catch (cause) {
      await fs.rm(newCurrentLink, { force: true });
      return failResult("activation failed", (cause as Error).message);
    }

    // Run post-update doctor on new CLI
    const newCliPath = resolve(dirname(topology.current), newCurrentTarget, "bin/horsepower");
    let doctorResult: { stdout: string; stderr: string; exitCode: number };
    try {
      doctorResult = await proc.execFile(newCliPath, ["doctor", "--installation-only", "--json"], { timeout: DOCTOR_TIMEOUT_MS });
    } catch (cause) {
      // Doctor failed — rollback
      return await rollback(topology, priorCurrentTarget, resolvedVersion, fs, "post-update doctor failed", (cause as Error).message);
    }

    if (doctorResult.exitCode !== 0) {
      return await rollback(topology, priorCurrentTarget, resolvedVersion, fs, "post-update doctor failed", `Doctor exited with code ${doctorResult.exitCode}`);
    }

    return {
      status: "updated",
      currentVersion,
      resolvedVersion,
      installedVersion: resolvedVersion,
      activeVersion: resolvedVersion,
      integrationStatus,
      reloadRequired: integrationStatus === "enabled",
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

async function rollback(
  topology: ReturnType<typeof installTopology>,
  priorCurrentTarget: string | undefined,
  version: string,
  fs: FilesystemSeam,
  reason: string,
  detail: string,
): Promise<UpdateResult> {
  if (!priorCurrentTarget) return failResult("rollback failed", `${reason}: prior current target unavailable`);
  const priorLink = join(topology.root, `.current-prior-${randomUUID().slice(0, 8)}`);
  try {
    await fs.symlink(priorCurrentTarget, priorLink);
    await fs.rename(priorLink, topology.current);
    const restored = await fs.readlink(topology.current);
    if (restored !== priorCurrentTarget) throw new Error("restored target does not match prior current");
  } catch (cause) {
    await fs.rm(priorLink, { force: true }).catch(() => undefined);
    return failResult("rollback failed", `${reason}: ${(cause as Error).message}`);
  }
  const restoredVersion = priorCurrentTarget.startsWith("versions/v") ? priorCurrentTarget.slice("versions/v".length) : "unknown";
  return {
    status: "rolled_back",
    currentVersion: restoredVersion,
    installedVersion: version,
    ...(restoredVersion === "unknown" ? {} : { activeVersion: restoredVersion }),
    reason: `${reason}: ${detail}`,
  };
}

// ---------------------------------------------------------------------------
// Archive extraction
// ---------------------------------------------------------------------------

async function extractArchive(archive: Buffer, stageRoot: string, fs: FilesystemSeam): Promise<void> {
  // Write archive to a temp file so inspectReleaseArchive can read it
  const tmpArchive = join(dirname(stageRoot), `.archive-${randomUUID().slice(0, 8)}.tar.gz`);
  try {
    await fs.writeFile(tmpArchive, archive);
    const { entries } = await inspectReleaseArchive(tmpArchive);
    for (const entry of entries) {
      if (entry.type === "directory") {
        await fs.mkdir(join(stageRoot, relativePath(entry.path)), { recursive: true, mode: 0o755 });
      } else {
        const filePath = join(stageRoot, relativePath(entry.path));
        await fs.mkdir(dirname(filePath), { recursive: true, mode: 0o755 });
        await fs.writeFile(filePath, entry.content);
        await fs.chmod(filePath, entry.mode);
      }
    }
  } finally {
    await fs.rm(tmpArchive, { force: true });
  }
}

function relativePath(archivePath: string): string {
  if (archivePath === "horsepower" || archivePath === "horsepower/") return "";
  if (archivePath.startsWith("horsepower/")) return archivePath.slice("horsepower/".length);
  return archivePath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function failResult(code: string, message: string): UpdateResult {
  const failure = projectFailure({ code: `UPDATE_${code.toUpperCase().replace(/[^A-Z0-9]+/gu, "_")}`, boundary: "updater", stage: "update", message, remediation: "Inspect the reported update stage, repair the installation if necessary, and retry.", retryable: !["invalid current", "installation ownership conflict", "cli link unowned", "versions unowned"].includes(code) });
  return { status: "failed", currentVersion: "unknown", reason: `${code}: ${message} (${JSON.stringify(failure)})` };
}

// ---------------------------------------------------------------------------
// Process seam wrapping execFile
// ---------------------------------------------------------------------------

export function createProcessSeam(execFileFn: (file: string, args: readonly string[], options?: { timeout?: number; env?: Record<string, string> }) => Promise<{ stdout: string; stderr: string; exitCode: number }>): ProcessSeam {
  return {
    execFile: async (file, args, options) => {
      const result = await execFileFn(file, args, options);
      return result;
    },
  };
}
