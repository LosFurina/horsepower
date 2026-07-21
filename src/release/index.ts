import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { gzipSync, inflateRawSync } from "node:zlib";
import { parse as parseYaml } from "yaml";
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
  listTrackedFiles(repositoryRoot: string): Promise<string[]>;
}

const execFileAsync = promisify(execFile);

async function gitTrackedFiles(repositoryRoot: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "buffer",
    shell: false,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.toString("utf8").split("\0").filter(Boolean).sort(comparePath);
}

export function createReleaseBuilder(dependencies: Partial<ReleaseBuilderDependencies> = {}) {
  const resolved: ReleaseBuilderDependencies = {
    scan: dependencies.scan ?? scanPublicContent,
    inspectArchive: dependencies.inspectArchive ?? inspectReleaseArchive,
    listTrackedFiles: dependencies.listTrackedFiles ?? gitTrackedFiles,
  };
  return {
    async build(options: BuildReleaseOptions): Promise<ReleaseBuildResult> {
      return buildReleaseWith(resolved, options);
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

function isStrictSemVer(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u.exec(value);
  if (!match) return false;
  return match[4]?.split(".").every((identifier) => !/^\d+$/u.test(identifier) || identifier === "0" || !identifier.startsWith("0")) ?? true;
}

async function stageRelease(repositoryRoot: string, stageRoot: string, version: string): Promise<{ allowedFiles: string[]; manifest: ReleaseManifest }> {
  const packagePath = join(repositoryRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
  if (!isStrictSemVer(packageJson.version)) throw new Error(`Invalid package version: ${String(packageJson.version)}`);
  if (packageJson.version !== version) throw new Error(`Release version ${version} does not match package version ${packageJson.version}`);
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

const trackedPublicRoots = [".github/", "docs/", "openspec/", "resources/", "scripts/", "src/", "test/", "tests/"] as const;
const trackedPublicFiles = new Set([
  ".gitignore", "LICENSE", "LICENSE.md", "README", "README.md", "README.zh-CN.md",
  "package.json", "package-lock.json", "npm-shrinkwrap.json", "tsconfig.json", "vitest.config.ts",
  "install.sh",
]);
const excludedTrackedRoots = [".pi/prompts/", ".pi/skills/"] as const;

function classifyTrackedPath(path: string): "public" | "excluded" {
  assertSafeRelativePath(path, "Tracked repository path");
  if (excludedTrackedRoots.some((prefix) => path.startsWith(prefix))) return "excluded";
  if (trackedPublicFiles.has(path) || trackedPublicRoots.some((prefix) => path.startsWith(prefix))) return "public";
  throw new Error(`Unclassified tracked repository file: ${path}`);
}

async function repositoryPublicContents(repositoryRoot: string, listTrackedFiles: ReleaseBuilderDependencies["listTrackedFiles"]): Promise<PublicContent[]> {
  const tracked = await listTrackedFiles(repositoryRoot);
  const paths = tracked.filter((path) => classifyTrackedPath(path) === "public");
  const built = ["dist/cli/horsepower.js", "dist/extension/index.js"];
  return Promise.all([...new Set([...paths, ...built])].sort(comparePath)
    .map(async (path) => ({ path, content: await readFile(join(repositoryRoot, path)) })));
}

async function buildReleaseWith(dependencies: ReleaseBuilderDependencies, options: BuildReleaseOptions): Promise<ReleaseBuildResult> {
  const repositoryRoot = resolve(options.repositoryRoot);
  const outputDir = resolve(options.outputDir);
  if (!isStrictSemVer(options.version)) throw new Error(`Invalid release version: ${options.version}`);
  await options.runBuild();
  dependencies.scan(await repositoryPublicContents(repositoryRoot, dependencies.listTrackedFiles));
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
  const workDir = await mkdtemp(join(dirname(outputDir), `.horsepower-release-${process.pid}-`));
  const stageRoot = join(workDir, "horsepower");
  try {
    const { allowedFiles, manifest } = await stageRelease(repositoryRoot, stageRoot, options.version);
    const staged = await validateStagedRelease(stageRoot, { version: options.version, allowedFiles });
    dependencies.scan(staged);
    const archivePath = join(outputDir, archiveName);
    await writeFile(archivePath, await createArchive(stageRoot));
    const inspected = await dependencies.inspectArchive(archivePath);
    validateArchiveEntries(inspected.entries, allowedFiles);
    dependencies.scan(inspected.entries);
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

function tarField(buffer: Buffer, offset: number, length: number, label: string): string {
  const field = buffer.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  if (nul >= 0 && field.subarray(nul + 1).some((byte) => byte !== 0)) throw new Error(`Invalid archive ${label}`);
  return field.subarray(0, nul < 0 ? field.length : nul).toString("utf8");
}
function tarOctal(buffer: Buffer, offset: number, length: number, label: string): number {
  const raw = buffer.subarray(offset, offset + length).toString("ascii");
  if (!/^[0-7]+(?:\0[ ]*|[ ]*)$/u.test(raw)) throw new Error(`Invalid archive ${label}`);
  const value = raw.replace(/\0.*$/u, "").trim();
  const result = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(result)) throw new Error(`Invalid archive ${label}`);
  return result;
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

const canonicalGzipHeader = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x13]);

function crc32(content: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectCanonicalGzip(archive: Buffer): Buffer {
  if (archive.length < canonicalGzipHeader.length + 8 || !archive.subarray(0, canonicalGzipHeader.length).equals(canonicalGzipHeader)) {
    throw new Error("Invalid canonical gzip header");
  }
  let inflated: { buffer: Buffer; engine: { bytesWritten: number } };
  try {
    inflated = inflateRawSync(archive.subarray(canonicalGzipHeader.length), { info: true }) as unknown as typeof inflated;
  } catch {
    throw new Error("Invalid gzip deflate stream");
  }
  const tar = inflated.buffer;
  const trailerOffset = canonicalGzipHeader.length + inflated.engine.bytesWritten;
  if (trailerOffset + 8 !== archive.length) throw new Error("Invalid gzip member framing");
  const expectedCrc = archive.readUInt32LE(trailerOffset);
  const expectedSize = archive.readUInt32LE(trailerOffset + 4);
  if (crc32(tar) !== expectedCrc) throw new Error("Invalid gzip trailer CRC32");
  if ((tar.length >>> 0) !== expectedSize) throw new Error("Invalid gzip trailer ISIZE");
  return tar;
}

export async function inspectReleaseArchive(path: string): Promise<{ entries: ArchiveEntry[] }> {
  const tar = inspectCanonicalGzip(await readFile(path));
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (true) {
    if (offset + 512 > tar.length) throw new Error("Archive is missing its canonical end");
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      const secondEndBlock = offset + 1024;
      if (secondEndBlock > tar.length || !tar.subarray(offset + 512, secondEndBlock).every((byte) => byte === 0)) {
        throw new Error("Archive is missing its canonical end");
      }
      if (!tar.subarray(secondEndBlock).every((byte) => byte === 0)) throw new Error("Archive contains non-zero trailing data");
      break;
    }
    const storedChecksum = tarOctal(header, 148, 8, "header checksum");
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    if (checksumHeader.reduce((total, byte) => total + byte, 0) !== storedChecksum) throw new Error("Invalid archive header checksum");
    const name = tarField(header, 0, 100, "USTAR name");
    const prefix = tarField(header, 345, 155, "USTAR prefix");
    const typeFlag = tarField(header, 156, 1, "type") || "0";
    if (name.length === 0 || prefix.endsWith("/")) throw new Error("Invalid archive USTAR path");
    for (const [component, allowTrailingSlash] of [[name, typeFlag === "5"], [prefix, false]] as const) {
      if (component.length === 0) continue;
      if (isAbsolute(component) || component.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(component)) throw new Error(`Archive path must be relative: ${component}`);
      const parts = component.replaceAll("\\", "/").split("/");
      if (allowTrailingSlash && parts.at(-1) === "") parts.pop();
      if (parts.some((part) => part === ".." || part === "")) throw new Error(`Archive path traversal: ${component}`);
    }
    const canonicalPath = prefix.length > 0 ? `${prefix}/${name}` : name;
    const normalized = canonicalPath.replaceAll("\\", "/").replace(/\/$/u, "");
    if (normalized !== "horsepower" && !normalized.startsWith("horsepower/")) throw new Error(`Unexpected archive root: ${canonicalPath}`);
    if (typeFlag === "1" || typeFlag === "2") throw new Error(`Archive links are not allowed: ${name}`);
    if (typeFlag !== "0" && typeFlag !== "5") throw new Error(`Unsupported archive entry type ${typeFlag}: ${name}`);
    const size = tarOctal(header, 124, 12, "size");
    if (typeFlag === "5" && size !== 0) throw new Error(`Directory archive entry must have size zero: ${canonicalPath}`);
    const contentStart = offset + 512;
    if (size > tar.length - contentStart) throw new Error(`Invalid archive size: ${canonicalPath}`);
    const contentEnd = contentStart + size;
    const paddedEnd = contentStart + Math.ceil(size / 512) * 512;
    if (paddedEnd > tar.length) throw new Error(`Invalid archive size: ${canonicalPath}`);
    if (!tar.subarray(contentEnd, paddedEnd).every((byte) => byte === 0)) throw new Error(`Non-zero archive padding: ${canonicalPath}`);
    const mode = tarOctal(header, 100, 8, "mode");
    const uid = tarOctal(header, 108, 8, "uid");
    const gid = tarOctal(header, 116, 8, "gid");
    const mtime = tarOctal(header, 136, 12, "mtime");
    const expectedModes = typeFlag === "5" ? [0o755] : [0o644, 0o755];
    if (!expectedModes.includes(mode)) throw new Error(`Unsafe archive mode for ${name}: ${mode.toString(8)}`);
    if (uid !== 0 || gid !== 0 || mtime !== fixedMtimeSeconds) throw new Error(`Non-canonical archive metadata: ${name}`);
    const canonicalHeader = tarHeader(
      typeFlag === "5" ? `${normalized}/` : normalized,
      typeFlag,
      mode,
      size,
    );
    if (!header.equals(canonicalHeader)) throw new Error(`Non-canonical archive header: ${canonicalPath}`);
    entries.push({
      path: normalized,
      type: typeFlag === "5" ? "directory" : "file",
      mode,
      uid,
      gid,
      mtime,
      content: typeFlag === "0" ? Buffer.from(tar.subarray(contentStart, contentEnd)) : Buffer.alloc(0),
    });
    offset = paddedEnd;
  }
  return { entries };
}

function expectedArchivePaths(allowedFiles: readonly string[]): string[] {
  const expected = new Set(["horsepower"]);
  for (const path of allowedFiles) {
    const fullPath = `horsepower/${path}`;
    expected.add(fullPath);
    const components = fullPath.split("/");
    for (let index = 1; index < components.length; index += 1) expected.add(components.slice(0, index).join("/"));
  }
  return [...expected].sort(comparePath);
}

function validateArchiveEntries(entries: readonly ArchiveEntry[], allowedFiles: readonly string[]): void {
  const actualPaths = entries.map(({ path }) => path).sort(comparePath);
  const expectedPaths = expectedArchivePaths(allowedFiles);
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error("Archive entry layout mismatch");
  const expectedFiles = new Set(allowedFiles.map((path) => `horsepower/${path}`));
  for (const entry of entries) {
    if ((entry.type === "file") !== expectedFiles.has(entry.path)) throw new Error(`Archive path/type conflict: ${entry.path}`);
  }
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

const forbiddenPathPatterns: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "private-agent", pattern: /(?:^|[/\\])(?:personas?|private-agents?|\.pi[/\\]agents?)(?:[/\\]|$)/iu },
  { id: "session-history", pattern: /(?:^|[/\\])(?:sessions?|history|transcripts?)(?:[/\\]|\.(?:jsonl?|ndjson)\b)/iu },
  { id: "competing-plan", pattern: /(?:implementation|generated|external)[-_ ]plan\.md\b/iu },
];

const structuredBindingKeys = new Map<string, string>([
  ["provider", "provider-mapping"],
  ["providers", "provider-mapping"],
  ["providermapping", "provider-mapping"],
  ["model", "concrete-model"],
  ["models", "concrete-model"],
  ["modelid", "concrete-model"],
  ["modelname", "concrete-model"],
]);

function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (/^<[^>]+>$/u.test(trimmed)) return true;
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return normalized.length === 0
    || /^(?:your|example|sample|placeholder|replace|redacted|dummy|fake|test|change|todo|none|null|neverprint)/u.test(normalized)
    || /^(?:provider|model|providermodel|providerjudge|providerutil|providerstrong|providercraft|providercheap|providervision|providerta|providerza|providermissing|projectcraft|mutatedmodel|othermodel|pm|unknownmodel|tokenvalue)$/u.test(normalized)
    || /^(?:remove|stale|malformed|incompatible|requested|notification|auth|array|global|project)[a-z]*(?:credential|secret|token|header)$/u.test(normalized)
    || /(?:here|changeme|redacted|placeholder)$/u.test(normalized);
}

function hasConcreteStructuredValue(value: unknown): boolean {
  if (typeof value === "string") return !isPlaceholder(value);
  if (Array.isArray(value)) return value.some(hasConcreteStructuredValue);
  if (value !== null && typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasConcreteStructuredValue);
  return value !== null && value !== undefined;
}

function findStructuredBinding(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredBinding(item);
      if (found) return found;
    }
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const id = structuredBindingKeys.get(key.toLowerCase());
    if (id && hasConcreteStructuredValue(nested)) return id;
    const found = findStructuredBinding(nested);
    if (found) return found;
  }
  return undefined;
}

function structuredDocument(path: string, text: string): unknown | undefined {
  const trimmed = text.trimStart();
  try {
    if (/\.json$/iu.test(path) || trimmed.startsWith("{") || trimmed.startsWith("[")) return JSON.parse(text) as unknown;
    if (/\.ya?ml$/iu.test(path)) return parseYaml(text) as unknown;
    if (/\.md$/iu.test(path) && /^---\r?\n/u.test(text)) {
      const end = text.indexOf("\n---", 4);
      if (end < 0) throw new Error("unterminated frontmatter");
      return parseYaml(text.slice(text.indexOf("\n") + 1, end)) as unknown;
    }
    return undefined;
  } catch {
    throw new Error(`Forbidden public content (malformed-structured-content) in ${path}`);
  }
}

function isRuntimeReference(value: string): boolean {
  if (/^(?:new\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(/u.test(value)
    || /^[A-Za-z_$][\w$]*(?:(?:\.[A-Za-z_$][\w$]*)|(?:\[\s*(?:\d+|[A-Za-z_$][\w$]*|["'][^"']+["'])\s*\]))+$/u.test(value)
    || /^`\s*(?:(?:bearer|basic)\s+)?\$\{[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\}(?:-(?:settings-)?(?:secret|token|credential|password))?\s*`$/iu.test(value)) return true;
  const coalescing = /^([A-Za-z_$][\w$]*)\s*\?\?\s*(.+)$/u.exec(value);
  if (coalescing && isRuntimeReference(coalescing[2] ?? "")) return true;
  if (value.startsWith("{")) {
    const literals = [...value.matchAll(/(["'])(.*?)\1/gu)].map((match) => match[2] ?? "");
    return literals.every((literal) => literal.length < 16 || isPlaceholder(literal));
  }
  return false;
}

function withoutComments(text: string): string {
  return text.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*\1|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/gu, (token) => {
    if (!token.startsWith("/")) return token;
    return token.replace(/[^\r\n]/gu, " ");
  });
}

const typeAnnotation = String.raw`[A-Za-z_$][\w$]*(?:\s*<[^;={}]*>)?(?:\s*\[\s*\])?(?:\s*\|\s*[A-Za-z_$][\w$]*(?:\s*<[^;={}]*>)?(?:\s*\[\s*\])?)*`;

function assignmentPattern(keys: string): RegExp {
  const start = String.raw`(?:^|[\n;,{}])\s*(?:(?:[-*]\s+)|(?:export\s+)?(?:const|let|var)\s+|export\s+)?(?:[A-Za-z_$][\w$]*\s*(?:\.\s*|\[\s*))?["']?`;
  return new RegExp(`${start}(${keys})["']?\\s*\\]?\\s*(?::\\s*${typeAnnotation}\\s*=|[:=])\\s*`, "gimu");
}

function findTextualBinding(text: string): string | undefined {
  const assignment = assignmentPattern("providerMapping|providers?|models?|modelId|modelName|model");
  for (const match of withoutComments(text).matchAll(assignment)) {
    const key = match[1]?.toLowerCase() ?? "";
    const tail = text.slice((match.index ?? 0) + match[0].length);
    const quoted = /^(["'])([^\r\n]*?)\1/u.exec(tail);
    if (quoted) {
      if (!isPlaceholder(quoted[2] ?? "")) return key.startsWith("provider") ? "provider-mapping" : "concrete-model";
      continue;
    }
    const collection = /^([\[{])([\s\S]*?)[\]}]/u.exec(tail);
    if (collection) {
      const body = collection[2]?.trim() ?? "";
      const safePlaceholderArray = collection[1] === "[" && body.split(",")
        .map((value) => value.trim().replace(/^(?:["'])(.*)(?:["'])$/u, "$1"))
        .every(isPlaceholder);
      const modelPaths = [...body.matchAll(/[A-Za-z][\w.-]*\/[A-Za-z][\w.-]*/gu)].map(([value]) => value);
      const safePlaceholderMap = modelPaths.length > 0 && modelPaths.every(isPlaceholder)
        && !/\b(?:private|secret|production|personal)\b/iu.test(body);
      if (body.length > 0 && !safePlaceholderArray && !safePlaceholderMap) return key.startsWith("provider") ? "provider-mapping" : "concrete-model";
      continue;
    }
    const bare = /^([^\s,;}]+)/u.exec(tail)?.[1] ?? "";
    const typeKeyword = /^(?:string|unknown|never|boolean|number|undefined|null)$/u.test(bare);
    if (bare.length > 0 && !typeKeyword && !isRuntimeReference(bare) && !isPlaceholder(bare)) {
      return key.startsWith("provider") ? "provider-mapping" : "concrete-model";
    }
  }
  return undefined;
}

function hasLabeledCredential(text: string): boolean {
  const assignment = assignmentPattern("api[_-]?key|access[_-]?token|client[_-]?secret|token|secret|password|credential|authorization");
  for (const match of withoutComments(text).matchAll(assignment)) {
    const tail = text.slice((match.index ?? 0) + match[0].length);
    const quoted = /^(["'])([A-Za-z0-9_./+= -]+?)\1/u.exec(tail)?.[2];
    const template = /^`[^`\r\n]*`/u.exec(tail)?.[0];
    const expression = quoted ?? template ?? /^([^,;}\r\n]+)/u.exec(tail)?.[1] ?? "";
    const value = expression.trim();
    if (isRuntimeReference(value)) continue;
    const credential = /^(?:bearer|basic)\s+(.+)$/iu.exec(value)?.[1] ?? value;
    if (credential.length >= 16 && !isRuntimeReference(credential) && !isPlaceholder(credential)) return true;
  }
  return false;
}

const forbiddenPatterns: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "credential", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bsk-[A-Za-z0-9_-]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b|\bAIza[A-Za-z0-9_-]{35}\b|\bAKIA[A-Z0-9]{16}\b|\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/imu },
  { id: "machine-path", pattern: /(?:^|[\s"'`(])(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\[^\\\s]+\\)/mu },
  { id: "legacy-workflow", pattern: /\b(?:AgentFlow|Superpowers)\b/mu },
];

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const binarySignatures = [
  Buffer.from("GIF87a", "ascii"), Buffer.from("GIF89a", "ascii"), Buffer.from("%PDF-", "ascii"),
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x1f, 0x8b]), Buffer.from([0x89, 0x50, 0x4e, 0x47]),
] as const;

function decodePublicText(item: PublicContent): string {
  if (item.content.includes(0) || binarySignatures.some((signature) => item.content.subarray(0, signature.length).equals(signature))) {
    throw new Error(`Forbidden public content (invalid-text-encoding) in ${item.path}`);
  }
  try {
    return fatalUtf8Decoder.decode(item.content);
  } catch {
    throw new Error(`Forbidden public content (invalid-text-encoding) in ${item.path}`);
  }
}

export function scanPublicContent(contents: readonly PublicContent[]): void {
  for (const item of contents) {
    assertSafeRelativePath(item.path, "Public content path");
    for (const forbidden of forbiddenPathPatterns) {
      if (forbidden.pattern.test(item.path)) throw new Error(`Forbidden public content (${forbidden.id}) in ${item.path}`);
    }
    const text = decodePublicText(item);
    if (/\.(?:json|ya?ml|md)$/iu.test(item.path)) {
      const binding = findStructuredBinding(structuredDocument(item.path, text));
      if (binding) throw new Error(`Forbidden public content (${binding}) in ${item.path}`);
    }
    const definesPrivacyPolicy = item.path === "src/release/index.ts" || item.path === "test/unit/release.test.ts";
    const textualBinding = findTextualBinding(text);
    if (textualBinding && !definesPrivacyPolicy) throw new Error(`Forbidden public content (${textualBinding}) in ${item.path}`);
    if (hasLabeledCredential(text) && !definesPrivacyPolicy) throw new Error(`Forbidden public content (credential) in ${item.path}`);
    for (const forbidden of forbiddenPatterns) {
      const isApprovedPlanningHistory = item.path.startsWith("openspec/");
      if (forbidden.id === "legacy-workflow" && (definesPrivacyPolicy || isApprovedPlanningHistory)) continue;
      if (forbidden.pattern.test(text)) throw new Error(`Forbidden public content (${forbidden.id}) in ${item.path}`);
    }
  }
}
