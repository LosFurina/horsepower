import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { validateReleaseCompatibility, type ReleaseCompatibility } from "../release-manifest.js";

const compatibility = {
  node: ">=22.19.0",
  pi: "0.80.10",
  openspec: ">=1.6.0",
} as const satisfies ReleaseCompatibility;

const entryPoints = {
  cli: "bin/horsepower",
  extension: "pi/extensions/horsepower/index.js",
  skill: "pi/skills/horsepower/SKILL.md",
} as const;

const criticalFiles = Object.values(entryPoints);
const executableFiles = new Set<string>([entryPoints.cli]);
const fixedMtimeSeconds = 0;

export interface PublicContent {
  path: string;
  content: Buffer;
}

export interface ArchiveEntry extends PublicContent {
  type: "file" | "directory";
  mode: number;
  uid: number;
  gid: number;
  mtime: number;
}

export interface ReleaseManifest {
  version: string;
  compatibility: ReleaseCompatibility;
  entryPoints: typeof entryPoints;
  digests: Record<string, string>;
}

export interface BuildReleaseOptions {
  repositoryRoot: string;
  outputDir: string;
  version: string;
  runBuild(): Promise<void>;
}

export interface ReleaseBuildResult {
  archivePath: string;
  checksumPath: string;
  checksum: string;
  manifest: ReleaseManifest;
}

export interface ReleaseBuilderDependencies {
  scan(contents: readonly PublicContent[]): void;
  inspectArchive(path: string): Promise<{ entries: ArchiveEntry[] }>;
}

export function createReleaseBuilder(dependencies: Partial<ReleaseBuilderDependencies> = {}) {
  const scan = dependencies.scan ?? scanPublicContent;
  const inspectArchive = dependencies.inspectArchive ?? inspectReleaseArchive;
  return {
    async build(options: BuildReleaseOptions): Promise<ReleaseBuildResult> {
      return buildReleaseWith({ scan, inspectArchive }, options);
    },
  };
}

export async function buildRelease(options: BuildReleaseOptions): Promise<ReleaseBuildResult> {
  return createReleaseBuilder().build(options);
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item === null || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([left], [right]) => comparePath(left, right))
      .map(([key, nested]) => [key, normalize(nested)]));
  };
  return `${JSON.stringify(normalize(value), undefined, 2)}\n`;
}

function assertSafeRelativePath(path: string, label: string): void {
  if (path.length === 0 || isAbsolute(path) || path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path)) {
    throw new Error(`${label} must be relative: ${path}`);
  }
  const components = path.replaceAll("\\", "/").split("/");
  if (components.some((component) => component === ".." || component === "")) {
    throw new Error(`${label} traversal: ${path}`);
  }
}

async function copyCanonical(source: string, destination: string, executable: boolean): Promise<void> {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Release source must be a regular file: ${source}`);
  await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
  await writeFile(destination, await readFile(source), { mode: executable ? 0o755 : 0o644 });
  await chmod(destination, executable ? 0o755 : 0o644);
}

async function regularFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Release source must not contain symbolic links: ${path}`);
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) result.push(relative(root, path).split(sep).join("/"));
      else throw new Error(`Unsupported release source object: ${path}`);
    }
  }
  await visit(root);
  return result;
}

async function stageRelease(repositoryRoot: string, stageRoot: string, version: string): Promise<{ allowedFiles: string[]; manifest: ReleaseManifest }> {
  const packagePath = join(repositoryRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
  if (packageJson.version !== version) throw new Error(`Release version ${version} does not match package version ${String(packageJson.version)}`);
  if (packageJson.private !== true) throw new Error("Release package metadata must be private");

  const copies: Array<{ source: string; target: string; executable?: boolean }> = [
    { source: join(repositoryRoot, "dist", "cli", "horsepower.js"), target: entryPoints.cli, executable: true },
    { source: join(repositoryRoot, "dist", "extension", "index.js"), target: entryPoints.extension },
    { source: join(repositoryRoot, "LICENSE"), target: "LICENSE" },
  ];
  const agentRoot = join(repositoryRoot, "resources", "agents");
  for (const path of await regularFiles(agentRoot)) copies.push({ source: join(agentRoot, path), target: `resources/agents/${path}` });
  const skillRoot = join(repositoryRoot, "resources", "skills", "horsepower");
  for (const path of await regularFiles(skillRoot)) copies.push({ source: join(skillRoot, path), target: `pi/skills/horsepower/${path}` });

  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true, mode: 0o755 });
  for (const copy of copies.sort((left, right) => comparePath(left.target, right.target))) {
    assertSafeRelativePath(copy.target, "Staged path");
    await copyCanonical(copy.source, join(stageRoot, copy.target), copy.executable === true);
  }

  const publicPackage = {
    name: packageJson.name,
    version,
    private: true,
    type: packageJson.type,
    engines: packageJson.engines,
  };
  await writeFile(join(stageRoot, "package.json"), stableJson(publicPackage), { mode: 0o644 });
  const digests = Object.fromEntries(await Promise.all(criticalFiles.map(async (path) => [path, sha256(await readFile(join(stageRoot, path)))])));
  const manifest: ReleaseManifest = { version, compatibility: { ...compatibility }, entryPoints: { ...entryPoints }, digests };
  await writeFile(join(stageRoot, "release-manifest.json"), stableJson(manifest), { mode: 0o644 });
  const allowedFiles = [...copies.map(({ target }) => target), "package.json", "release-manifest.json"].sort();
  return { allowedFiles, manifest };
}

async function repositoryPublicContents(repositoryRoot: string): Promise<PublicContent[]> {
  const paths = [
    "package.json",
    "LICENSE",
    "dist/cli/horsepower.js",
    "dist/extension/index.js",
    ...(await regularFiles(join(repositoryRoot, "resources", "agents"))).map((path) => `resources/agents/${path}`),
    ...(await regularFiles(join(repositoryRoot, "resources", "skills", "horsepower"))).map((path) => `resources/skills/horsepower/${path}`),
  ].sort(comparePath);
  return Promise.all(paths.map(async (path) => ({ path, content: await readFile(join(repositoryRoot, path)) })));
}

async function buildReleaseWith(dependencies: ReleaseBuilderDependencies, options: BuildReleaseOptions): Promise<ReleaseBuildResult> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const outputDir = resolve(options.outputDir);
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(options.version)) {
    throw new Error(`Invalid release version: ${options.version}`);
  }
  await options.runBuild();
  dependencies.scan(await repositoryPublicContents(repositoryRoot));
  const archiveName = `horsepower-v${options.version}.tar.gz`;
  const outputNames = new Set([archiveName, `${archiveName}.sha256`]);
  try {
    const outputInfo = await lstat(outputDir);
    if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) throw new Error(`Release output must be a regular directory: ${outputDir}`);
    for (const name of await readdir(outputDir)) {
      if (!outputNames.has(name)) throw new Error(`Release output contains unexpected entry: ${name}`);
      const path = join(outputDir, name);
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Release output contains unsafe entry: ${name}`);
      await rm(path);
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    await mkdir(outputDir, { recursive: true, mode: 0o755 });
  }
  const workDir = join(dirname(outputDir), `.horsepower-release-${process.pid}`);
  const stageRoot = join(workDir, "horsepower");
  try {
    const { allowedFiles, manifest } = await stageRelease(repositoryRoot, stageRoot, options.version);
    const staged = await validateStagedRelease(stageRoot, { version: options.version, allowedFiles });
    dependencies.scan(staged);
    const archivePath = join(outputDir, archiveName);
    await writeFile(archivePath, await createArchive(stageRoot));
    const inspected = await dependencies.inspectArchive(archivePath);
    validateArchiveEntries(inspected.entries, allowedFiles);
    dependencies.scan(inspected.entries.filter((entry) => entry.type === "file"));
    verifyArchiveManifest(inspected.entries, manifest);
    const archive = await readFile(archivePath);
    const checksum = sha256(archive);
    const checksumPath = `${archivePath}.sha256`;
    await writeFile(checksumPath, `${checksum}  ${archiveName}\n`, { mode: 0o644 });
    return { archivePath, checksumPath, checksum, manifest };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function validateStagedRelease(
  stageRoot: string,
  options: { version: string; allowedFiles: readonly string[] },
): Promise<PublicContent[]> {
  const root = resolve(stageRoot);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error(`Invalid staged release root: ${root}`);
  const allowed = new Set(options.allowedFiles);
  const allowedDirectories = new Set<string>();
  for (const path of allowed) {
    const components = path.split("/");
    for (let index = 1; index < components.length; index += 1) allowedDirectories.add(components.slice(0, index).join("/"));
  }
  const files: PublicContent[] = [];
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = join(directory, name);
      const path = relative(root, absolute).split(sep).join("/");
      assertSafeRelativePath(path, "Staged path");
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${path}`);
      if (info.isDirectory()) {
        if (!allowedDirectories.has(path)) throw new Error(`Unexpected staged directory: ${path}`);
        if ((info.mode & 0o777) !== 0o755) throw new Error(`Unsafe staged mode for ${path}: ${(info.mode & 0o777).toString(8)}`);
        await visit(absolute);
      } else if (info.isFile()) {
        if (!allowed.has(path)) throw new Error(`Unexpected staged path: ${path}`);
        const expectedMode = executableFiles.has(path) ? 0o755 : 0o644;
        if ((info.mode & 0o777) !== expectedMode) throw new Error(`Unsafe staged mode for ${path}: ${(info.mode & 0o777).toString(8)}`);
        files.push({ path, content: await readFile(absolute) });
      } else throw new Error(`Unsupported staged object: ${path}`);
    }
  }
  await visit(root);
  const actual = new Set(files.map(({ path }) => path));
  for (const path of allowed) if (!actual.has(path)) throw new Error(`Missing staged path: ${path}`);
  if (allowed.has("release-manifest.json")) await validateManifest(root, options.version);
  return files;
}

async function validateManifest(root: string, version: string): Promise<ReleaseManifest> {
  const manifest = JSON.parse(await readFile(join(root, "release-manifest.json"), "utf8")) as ReleaseManifest;
  if (manifest.version !== version) throw new Error(`Staged manifest version mismatch: expected ${version}`);
  validateReleaseCompatibility(manifest.compatibility);
  if (JSON.stringify(manifest.entryPoints) !== JSON.stringify(entryPoints)) throw new Error("Invalid release manifest entry points");
  const digestPaths = Object.keys(manifest.digests).sort();
  if (JSON.stringify(digestPaths) !== JSON.stringify([...criticalFiles].sort())) throw new Error("Invalid release manifest digest fields");
  for (const path of criticalFiles) {
    const digest = manifest.digests[path];
    if (!/^[a-f0-9]{64}$/u.test(digest ?? "")) throw new Error(`Invalid release manifest digest: ${path}`);
    if (sha256(await readFile(join(root, path))) !== digest) throw new Error(`Release manifest digest mismatch: ${path}`);
  }
  return manifest;
}

function tarString(buffer: Buffer, offset: number, length: number): string {
  const end = buffer.indexOf(0, offset);
  return buffer.subarray(offset, end >= offset && end < offset + length ? end : offset + length).toString("utf8");
}
function tarOctal(buffer: Buffer, offset: number, length: number): number {
  const value = tarString(buffer, offset, length).trim();
  return value === "" ? 0 : Number.parseInt(value, 8);
}
function writeTarString(header: Buffer, value: string, offset: number, length: number): void {
  const bytes = Buffer.from(value);
  if (bytes.length > length) throw new Error(`Archive path is too long: ${value}`);
  bytes.copy(header, offset);
}
function writeTarOctal(header: Buffer, value: number, offset: number, length: number): void {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}
function tarHeader(path: string, type: "0" | "5", mode: number, size: number): Buffer {
  const header = Buffer.alloc(512);
  writeTarString(header, path, 0, 100);
  writeTarOctal(header, mode, 100, 8);
  writeTarOctal(header, 0, 108, 8);
  writeTarOctal(header, 0, 116, 8);
  writeTarOctal(header, size, 124, 12);
  writeTarOctal(header, fixedMtimeSeconds, 136, 12);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  writeTarString(header, "ustar", 257, 6);
  writeTarString(header, "00", 263, 2);
  writeTarString(header, "root", 265, 32);
  writeTarString(header, "root", 297, 32);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
}

async function archiveSourceEntries(stageRoot: string): Promise<Array<{ path: string; type: "file" | "directory"; mode: number; content: Buffer }>> {
  const result: Array<{ path: string; type: "file" | "directory"; mode: number; content: Buffer }> = [
    { path: "horsepower/", type: "directory", mode: 0o755, content: Buffer.alloc(0) },
  ];
  async function visit(directory: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = join(directory, name);
      const relativePath = relative(stageRoot, absolute).split(sep).join("/");
      const info = await lstat(absolute);
      if (info.isDirectory()) {
        result.push({ path: `horsepower/${relativePath}/`, type: "directory", mode: 0o755, content: Buffer.alloc(0) });
        await visit(absolute);
      } else result.push({ path: `horsepower/${relativePath}`, type: "file", mode: info.mode & 0o777, content: await readFile(absolute) });
    }
  }
  await visit(stageRoot);
  return result.sort((left, right) => comparePath(left.path, right.path));
}

function tarPadding(size: number): Buffer {
  return Buffer.alloc((512 - (size % 512)) % 512);
}

function createArchive(stageRoot: string): Promise<Buffer> {
  return archiveSourceEntries(stageRoot).then((entries) => {
    const chunks: Buffer[] = [];
    for (const entry of entries) {
      chunks.push(tarHeader(entry.path, entry.type === "file" ? "0" : "5", entry.mode, entry.content.length));
      if (entry.type === "file") chunks.push(entry.content, tarPadding(entry.content.length));
    }
    chunks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(chunks), { level: 9 });
  });
}

export async function inspectReleaseArchive(path: string): Promise<{ entries: ArchiveEntry[] }> {
  const tar = gunzipSync(await readFile(path));
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const storedChecksum = tarOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    if (checksumHeader.reduce((total, byte) => total + byte, 0) !== storedChecksum) throw new Error("Invalid archive header checksum");
    const name = tarString(header, 0, 100);
    if (isAbsolute(name) || name.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(name)) throw new Error(`Archive path must be relative: ${name}`);
    const normalized = name.replaceAll("\\", "/").replace(/\/$/u, "");
    if (normalized.split("/").some((component) => component === ".." || component === "")) throw new Error(`Archive path traversal: ${name}`);
    if (normalized !== "horsepower" && !normalized.startsWith("horsepower/")) throw new Error(`Unexpected archive root: ${name}`);
    const typeFlag = tarString(header, 156, 1) || "0";
    if (typeFlag === "1" || typeFlag === "2") throw new Error(`Archive links are not allowed: ${name}`);
    if (typeFlag !== "0" && typeFlag !== "5") throw new Error(`Unsupported archive entry type ${typeFlag}: ${name}`);
    const size = tarOctal(header, 124, 12);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tar.length) throw new Error(`Truncated archive entry: ${name}`);
    const mode = tarOctal(header, 100, 8);
    const uid = tarOctal(header, 108, 8);
    const gid = tarOctal(header, 116, 8);
    const mtime = tarOctal(header, 136, 12);
    const expectedModes = typeFlag === "5" ? [0o755] : [0o644, 0o755];
    if (!expectedModes.includes(mode)) throw new Error(`Unsafe archive mode for ${name}: ${mode.toString(8)}`);
    if (uid !== 0 || gid !== 0 || mtime !== fixedMtimeSeconds) throw new Error(`Non-canonical archive metadata: ${name}`);
    entries.push({
      path: normalized,
      type: typeFlag === "5" ? "directory" : "file",
      mode,
      uid,
      gid,
      mtime,
      content: typeFlag === "0" ? Buffer.from(tar.subarray(contentStart, contentEnd)) : Buffer.alloc(0),
    });
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return { entries };
}

function validateArchiveEntries(entries: readonly ArchiveEntry[], allowedFiles: readonly string[]): void {
  const files = entries.filter((entry) => entry.type === "file");
  const expected = allowedFiles.map((path) => `horsepower/${path}`).sort();
  if (JSON.stringify(files.map(({ path }) => path).sort()) !== JSON.stringify(expected)) throw new Error("Archive file allowlist mismatch");
  for (const entry of entries) {
    if (entry.uid !== 0 || entry.gid !== 0 || entry.mtime !== fixedMtimeSeconds) throw new Error(`Non-canonical archive metadata: ${entry.path}`);
    const relativePath = entry.path === "horsepower" ? "" : entry.path.slice("horsepower/".length);
    const expectedMode = entry.type === "directory" || executableFiles.has(relativePath) ? 0o755 : 0o644;
    if (entry.mode !== expectedMode) throw new Error(`Unsafe archive mode for ${entry.path}: ${entry.mode.toString(8)}`);
  }
}

function verifyArchiveManifest(entries: readonly ArchiveEntry[], expected: ReleaseManifest): void {
  const byPath = new Map(entries.filter((entry) => entry.type === "file").map((entry) => [entry.path, entry.content]));
  const raw = byPath.get("horsepower/release-manifest.json");
  if (!raw) throw new Error("Archive manifest is missing");
  const actual = JSON.parse(raw.toString("utf8")) as ReleaseManifest;
  if (stableJson(actual) !== stableJson(expected)) throw new Error("Archive manifest differs from staged manifest");
  for (const path of criticalFiles) {
    const content = byPath.get(`horsepower/${path}`);
    if (!content || sha256(content) !== actual.digests[path]) throw new Error(`Archive manifest digest mismatch: ${path}`);
  }
}

const forbiddenPatterns: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "private-agent", pattern: /(?:^|[/\\])(?:personas?|private-agents?|\.pi[/\\]agents?)(?:[/\\]|$)/imu },
  { id: "provider-mapping", pattern: /^\s*(?:provider|providers|providerMapping)\s*[:=]\s*(?:["'][^"'\n]+["']|[a-z0-9_-]+(?:\/[a-z0-9._-]+)?)\s*(?:[,}]|$)/imu },
  { id: "concrete-model", pattern: /^\s*(?:model|modelId|modelName)\s*[:=]\s*(?:["'][^"'\n]+["']|[a-z0-9_-]+(?:\/[a-z0-9._-]+)?)\s*(?:[,}]|$)/imu },
  { id: "credential", pattern: /(?:api[_-]?key|access[_-]?token|client[_-]?secret|authorization)\s*[:=]\s*["']?(?:bearer\s+)?[A-Za-z0-9_./+=-]{16,}/imu },
  { id: "machine-path", pattern: /(?:^|[\s"'`(])(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/mu },
  { id: "session-history", pattern: /(?:^|[/\\])(?:sessions?|history)(?:[/\\]|\.(?:jsonl?|ndjson)\b)/imu },
  { id: "competing-plan", pattern: /(?:implementation|generated|external)[-_ ]plan\.md\b/imu },
  { id: "legacy-workflow", pattern: /\b(?:AgentFlow|Superpowers)\b/mu },
];

export function scanPublicContent(contents: readonly PublicContent[]): void {
  for (const item of contents) {
    assertSafeRelativePath(item.path, "Public content path");
    if (item.content.includes(0)) continue;
    const text = `${item.path}\n${item.content.toString("utf8")}`;
    for (const forbidden of forbiddenPatterns) {
      if (forbidden.pattern.test(text)) throw new Error(`Forbidden public content (${forbidden.id}) in ${item.path}`);
    }
  }
}
