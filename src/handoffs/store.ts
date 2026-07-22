import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const ONE_MIB = 1024 * 1024;
const TEN_MIB = 10 * ONE_MIB;
const RUN_LIMIT = 20 * ONE_MIB;
const MANIFEST = "manifest.json";
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface HandoffProducer { kind: "captain" | "worker"; id: string }
export interface ArtifactReference {
  projectId: string; runId: string; artifactId: string; sha256: string; bytes: number;
  mediaType: string; summary: string;
}
interface ArtifactRecord { path: string; sha256: string; bytes: number; mediaType: string; producer: HandoffProducer }
interface HandoffManifest {
  version: 1; projectId: string; runId: string; revision: number; brief: ArtifactRecord; report: ArtifactRecord | null;
  attachments: ArtifactRecord[]; terminal: { status: "completed" | "failed" | "canceled"; reportPresent: boolean } | null;
}
export interface CreateHandoffStoreOptions { stateRoot: string }

function opaqueProjectId(projectPath: string): string {
  return createHash("sha256").update(resolve(projectPath)).digest("hex").slice(0, 32);
}
function validId(value: string, label: string): void {
  if (!idPattern.test(value) || value.includes("..") || value.includes("/") || value.includes("\\") || value.includes("\0") || isAbsolute(value)) {
    throw new Error(`Invalid handoff ${label}: ${JSON.stringify(value)}`);
  }
}
function validRelativePath(value: string): void {
  if (!value || value.includes("\0") || value.includes("\\") || isAbsolute(value) || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Invalid manifest relative path: ${JSON.stringify(value)}`);
  }
}
function artifact(path: string, data: Buffer, mediaType: string, producer: HandoffProducer): ArtifactRecord {
  return { path, sha256: createHash("sha256").update(data).digest("hex"), bytes: data.length, mediaType, producer };
}
function encodeText(text: string, label: string, limit = ONE_MIB): Buffer {
  const data = Buffer.from(text, "utf8");
  if (data.length > limit) throw new Error(`${label} exceeds 1 MiB`);
  return data;
}
function decodeText(data: Buffer, label: string): string {
  try { return decoder.decode(data); } catch { throw new Error(`${label} must be valid UTF-8`); }
}
function summary(text: string): string {
  const compact = text.replace(/\s+/gu, " ").trim();
  const bytes = Buffer.from(compact);
  if (bytes.length <= 500) return compact;
  let end = 497;
  while (end > 0) {
    try { return `${decoder.decode(bytes.subarray(0, end))}...`; } catch { end -= 1; }
  }
  return "...";
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new Error(`Invalid handoff manifest ${label} fields`);
}
function producerValue(value: unknown): HandoffProducer {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid handoff producer");
  const record = value as Record<string, unknown>; exactKeys(record, ["kind", "id"], "producer");
  if ((record.kind !== "captain" && record.kind !== "worker") || typeof record.id !== "string" || !record.id) throw new Error("Invalid handoff producer");
  return { kind: record.kind, id: record.id };
}
function artifactValue(value: unknown): ArtifactRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid handoff artifact");
  const record = value as Record<string, unknown>; exactKeys(record, ["path", "sha256", "bytes", "mediaType", "producer"], "artifact");
  if (typeof record.path !== "string") throw new Error("Invalid handoff artifact path"); validRelativePath(record.path);
  if (typeof record.sha256 !== "string" || !digestPattern.test(record.sha256) || typeof record.bytes !== "number" || !Number.isSafeInteger(record.bytes) || record.bytes < 0 || typeof record.mediaType !== "string" || !record.mediaType) throw new Error("Invalid handoff artifact metadata");
  return { path: record.path, sha256: record.sha256, bytes: record.bytes, mediaType: record.mediaType, producer: producerValue(record.producer) };
}
function parseManifest(raw: Buffer, expectedProject: string, expectedRun: string): HandoffManifest {
  let value: unknown; try { value = JSON.parse(decodeText(raw, "manifest")); } catch (cause) { if (cause instanceof SyntaxError) throw new Error("Malformed handoff manifest"); throw cause; }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid handoff manifest");
  const record = value as Record<string, unknown>; exactKeys(record, ["version", "projectId", "runId", "revision", "brief", "report", "attachments", "terminal"], "root");
  if (record.version !== 1 || record.projectId !== expectedProject || record.runId !== expectedRun) throw new Error("Handoff manifest ownership mismatch");
  if (typeof record.revision !== "number" || !Number.isSafeInteger(record.revision) || record.revision < 0) throw new Error("Invalid handoff revision");
  if (!Array.isArray(record.attachments) || record.attachments.length > 16) throw new Error("Invalid handoff attachments");
  let terminal: HandoffManifest["terminal"] = null;
  if (record.terminal !== null) {
    if (!record.terminal || typeof record.terminal !== "object" || Array.isArray(record.terminal)) throw new Error("Invalid handoff terminal metadata");
    const item = record.terminal as Record<string, unknown>; exactKeys(item, ["status", "reportPresent"], "terminal");
    if (!["completed", "failed", "canceled"].includes(String(item.status)) || typeof item.reportPresent !== "boolean") throw new Error("Invalid handoff terminal metadata");
    terminal = { status: item.status as "completed" | "failed" | "canceled", reportPresent: item.reportPresent };
  }
  const report = record.report === null ? null : artifactValue(record.report);
  if (terminal && terminal.reportPresent !== (report !== null)) throw new Error("Handoff manifest report presence mismatch");
  if (terminal?.status === "completed" && !report) throw new Error("Completed handoff requires report metadata");
  return { version: 1, projectId: expectedProject, runId: expectedRun, revision: record.revision, brief: artifactValue(record.brief), report, attachments: record.attachments.map(artifactValue), terminal };
}

export function createHandoffStore(options: CreateHandoffStoreOptions) {
  const stateRoot = resolve(options.stateRoot);
  const handoffsRoot = join(stateRoot, "handoffs");
  const paths = (projectPath: string, runId: string) => {
    validId(runId, "run ID"); const projectId = opaqueProjectId(projectPath);
    const projectRoot = join(handoffsRoot, projectId); const runRoot = join(projectRoot, runId);
    return { projectId, projectRoot, runRoot, manifest: join(runRoot, MANIFEST) };
  };
  async function ensureDirectory(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const info = await lstat(path); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`Unsafe handoff directory: ${path}`);
    await chmod(path, 0o700);
  }
  async function verifyAncestors(path: string, includeFinal: boolean): Promise<void> {
    const target = resolve(path); const rel = relative(handoffsRoot, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("Handoff path escapes storage root");
    const rootInfo = await lstat(handoffsRoot);
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("Handoff storage root must be an unlinked directory");
    const parts = rel.split(sep).filter(Boolean); let current = handoffsRoot;
    const count = includeFinal ? parts.length : Math.max(0, parts.length - 1);
    for (let i = 0; i < count; i += 1) {
      current = join(current, parts[i]!); const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Handoff path contains symbolic link: ${current}`);
      if (!info.isDirectory()) throw new Error(`Handoff ancestor is not a directory: ${current}`);
    }
  }
  async function readRegular(path: string, label: string, limit?: number): Promise<Buffer> {
    await verifyAncestors(path, false);
    const info = await lstat(path).catch((cause) => { if ((cause as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`${label} is missing`); throw cause; });
    if (info.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link`);
    if (!info.isFile()) throw new Error(`${label} must be a regular file`);
    if (info.nlink !== 1) throw new Error(`${label} must not be a hard link`);
    if ((info.mode & 0o777) !== 0o600) throw new Error(`${label} must use mode 0600`);
    if (limit !== undefined && info.size > limit) throw new Error(`${label} exceeds ${limit === ONE_MIB ? "1 MiB" : "size limit"}`);
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { const data = await handle.readFile(); if (limit !== undefined && data.length > limit) throw new Error(`${label} exceeds 1 MiB`); return data; } finally { await handle.close(); }
  }
  async function atomic(path: string, data: Buffer): Promise<void> {
    await verifyAncestors(path, false); const temp = join(resolve(path, ".."), `.${basename(path)}.${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      await handle.writeFile(data); await handle.sync(); await handle.close(); handle = undefined; await chmod(temp, 0o600); await rename(temp, path);
      const directory = await open(resolve(path, ".."), constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
    } finally { if (handle) await handle.close().catch(() => undefined); await rm(temp, { force: true }).catch(() => undefined); }
  }
  async function readOwned(projectPath: string, runId: string): Promise<{ manifest: HandoffManifest; p: ReturnType<typeof paths> }> {
    const p = paths(projectPath, runId);
    try { const raw = await readRegular(p.manifest, "handoff manifest", ONE_MIB); return { manifest: parseManifest(raw, p.projectId, runId), p }; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT" || (cause as Error).message.includes("is missing")) throw new Error(`Unknown handoff run: ${runId}`); throw cause; }
  }
  async function writeManifest(path: string, manifest: HandoffManifest): Promise<void> { await atomic(path, Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8")); }
  function total(manifest: HandoffManifest, nextBytes = 0): number {
    const artifactBytes = manifest.brief.bytes + (manifest.report?.bytes ?? 0) + manifest.attachments.reduce((sum, item) => sum + item.bytes, 0) + nextBytes;
    return artifactBytes + Buffer.byteLength(`${JSON.stringify(manifest)}\n`);
  }
  async function validateArtifacts(p: ReturnType<typeof paths>, manifest: HandoffManifest): Promise<void> {
    const artifacts = [manifest.brief, ...(manifest.report ? [manifest.report] : []), ...manifest.attachments];
    const expected = new Set([MANIFEST, ...artifacts.map((item) => item.path)]);
    const actual = await readdir(p.runRoot);
    const reportPlaceholder = manifest.report === null && actual.includes("report.md");
    if (reportPlaceholder) expected.add("report.md");
    for (const name of actual) if (!expected.has(name)) throw new Error(`Unexpected object in handoff run: ${name}`);
    if (actual.length !== expected.size) throw new Error("Handoff run artifact set is incomplete");
    if (reportPlaceholder) {
      const placeholder = await readRegular(join(p.runRoot, "report.md"), "Managed report placeholder", 0);
      if (placeholder.length !== 0) throw new Error("Managed report placeholder must be empty");
    }
    for (const item of artifacts) {
      validRelativePath(item.path); const data = await readRegular(join(p.runRoot, item.path), `handoff artifact ${item.path}`);
      if (data.length !== item.bytes || createHash("sha256").update(data).digest("hex") !== item.sha256) throw new Error(`Handoff artifact metadata mismatch: ${item.path}`);
    }
    if (total(manifest) > RUN_LIMIT) throw new Error("Handoff run exceeds 20 MiB");
  }
  return {
    handoffsRoot,
    async create(input: { projectPath: string; runId: string; brief: string; producer: HandoffProducer }) {
      const p = paths(input.projectPath, input.runId); const brief = encodeText(input.brief, "Handoff brief");
      await ensureDirectory(stateRoot); await ensureDirectory(handoffsRoot); await ensureDirectory(p.projectRoot); await verifyAncestors(p.runRoot, false);
      try { await mkdir(p.runRoot, { mode: 0o700 }); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`Handoff run already exists: ${input.runId}`); throw cause; }
      await chmod(p.runRoot, 0o700);
      const briefRecord = artifact("brief.md", brief, "text/markdown; charset=utf-8", input.producer);
      const manifest: HandoffManifest = { version: 1, projectId: p.projectId, runId: input.runId, revision: 0, brief: briefRecord, report: null, attachments: [], terminal: null };
      try { await atomic(join(p.runRoot, "brief.md"), brief); await atomic(join(p.runRoot, "report.md"), Buffer.alloc(0)); await writeManifest(p.manifest, manifest); }
      catch (cause) { await rm(p.runRoot, { recursive: true, force: true }); throw cause; }
      return { reference: { projectId: p.projectId, runId: input.runId }, worker: { briefPath: join(p.runRoot, "brief.md"), reportPath: join(p.runRoot, "report.md") } };
    },
    async prepareMessage(input: { projectPath: string; runId: string; brief: string; producer: HandoffProducer }) {
      const { manifest, p } = await readOwned(input.projectPath, input.runId);
      const brief = encodeText(input.brief, "Handoff brief");
      const next: HandoffManifest = {
        ...manifest,
        revision: manifest.revision + 1,
        brief: artifact("brief.md", brief, "text/markdown; charset=utf-8", input.producer),
        report: null,
        terminal: null,
      };
      if (total(next) > RUN_LIMIT) throw new Error("Handoff run exceeds 20 MiB");
      await atomic(join(p.runRoot, "brief.md"), brief);
      await atomic(join(p.runRoot, "report.md"), Buffer.alloc(0));
      await writeManifest(p.manifest, next);
      return { worker: { briefPath: join(p.runRoot, "brief.md"), reportPath: join(p.runRoot, "report.md") }, reportRevision: next.revision };
    },
    async validateReport(input: { projectPath: string; runId: string; producer: HandoffProducer; expectedRevision?: number }): Promise<ArtifactReference> {
      const { manifest, p } = await readOwned(input.projectPath, input.runId);
      if (input.expectedRevision !== undefined && manifest.revision !== input.expectedRevision) throw new Error("Managed report revision mismatch");
      if (manifest.terminal) throw new Error(`Handoff run ${input.runId} is already terminal as ${manifest.terminal.status}`);
      const data = await readRegular(join(p.runRoot, "report.md"), "Managed report", ONE_MIB); const text = decodeText(data, "Managed report");
      if (data.length === 0) throw new Error("Managed report is empty");
      manifest.report = artifact("report.md", data, "text/markdown; charset=utf-8", input.producer); manifest.terminal = { status: "completed", reportPresent: true };
      if (total(manifest) > RUN_LIMIT) throw new Error("Handoff run exceeds 20 MiB"); await writeManifest(p.manifest, manifest);
      return { projectId: p.projectId, runId: input.runId, artifactId: "report", sha256: manifest.report.sha256, bytes: data.length, mediaType: manifest.report.mediaType, summary: summary(text) };
    },
    async addAttachment(input: { projectPath: string; runId: string; name: string; content: string | Uint8Array; mediaType: string; producer: HandoffProducer }): Promise<ArtifactReference> {
      validId(input.name, "attachment name"); if (input.name === MANIFEST || input.name === "brief.md" || input.name === "report.md") throw new Error("Reserved attachment name");
      const { manifest, p } = await readOwned(input.projectPath, input.runId);
      if (manifest.attachments.some((item) => item.path === input.name)) throw new Error(`Handoff attachment already exists: ${input.name}`);
      const data = typeof input.content === "string" ? Buffer.from(input.content, "utf8") : Buffer.from(input.content); if (data.length > TEN_MIB) throw new Error("Handoff attachment exceeds 10 MiB");
      if (manifest.attachments.length >= 16) throw new Error("Handoff permits at most 16 attachments");
      if (!input.mediaType) throw new Error("Attachment media type is required"); const record = artifact(input.name, data, input.mediaType, input.producer); const next = { ...manifest, attachments: [...manifest.attachments, record] };
      if (total(next) > RUN_LIMIT) throw new Error("Handoff run exceeds 20 MiB"); await atomic(join(p.runRoot, input.name), data);
      try { await writeManifest(p.manifest, next); } catch (cause) { await rm(join(p.runRoot, input.name), { force: true }); throw cause; }
      return { projectId: p.projectId, runId: input.runId, artifactId: input.name, sha256: record.sha256, bytes: data.length, mediaType: input.mediaType, summary: input.name };
    },
    async recordTerminal(input: { projectPath: string; runId: string; status: "failed" | "canceled"; producer?: HandoffProducer }) {
      const { manifest, p } = await readOwned(input.projectPath, input.runId);
      if (manifest.terminal) {
        if (manifest.terminal.status !== input.status) {
          throw new Error(`Handoff run ${input.runId} is already terminal as ${manifest.terminal.status}`);
        }
        return structuredClone(manifest.terminal);
      }
      try {
        const data = await readRegular(join(p.runRoot, "report.md"), "Managed report", ONE_MIB);
        decodeText(data, "Managed report");
        if (data.length === 0) {
          manifest.report = null;
          await rm(join(p.runRoot, "report.md"), { force: true });
        } else {
          manifest.report = artifact("report.md", data, "text/markdown; charset=utf-8", input.producer ?? { kind: "worker", id: "unknown" });
        }
      } catch {
        manifest.report = null;
        await rm(join(p.runRoot, "report.md"), { force: true }).catch(() => undefined);
      }
      manifest.terminal = { status: input.status, reportPresent: manifest.report !== null };
      await writeManifest(p.manifest, manifest);
      return structuredClone(manifest.terminal);
    },
    async inspect(input: { projectPath: string; runId: string }) {
      const { manifest, p } = await readOwned(input.projectPath, input.runId); await validateArtifacts(p, manifest);
      return structuredClone(manifest);
    },
    async list(input: { projectPath: string }) {
      const projectId = opaqueProjectId(input.projectPath); const projectRoot = join(handoffsRoot, projectId);
      let names: string[]; try { await verifyAncestors(projectRoot, false); const info = await lstat(projectRoot); if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe handoff project directory"); names = await readdir(projectRoot); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []; throw cause; }
      const result = []; for (const runId of names.sort()) { validId(runId, "run ID"); const { manifest, p } = await readOwned(input.projectPath, runId); await validateArtifacts(p, manifest); result.push({ projectId, runId, terminal: manifest.terminal, artifactCount: 1 + (manifest.report ? 1 : 0) + manifest.attachments.length }); }
      return result;
    },
    async clean(input: { projectPath: string; runId: string }) {
      const { manifest, p } = await readOwned(input.projectPath, input.runId); await validateArtifacts(p, manifest); await verifyAncestors(p.runRoot, false); await rm(p.runRoot, { recursive: true }); return { removed: input.runId };
    },
    async cleanTerminal(input: { projectPath: string }) {
      const entries = await this.list(input); const removed: string[] = []; for (const item of entries) if (item.terminal) { await this.clean({ ...input, runId: item.runId }); removed.push(item.runId); } return { removed };
    },
  };
}

export type HandoffStore = ReturnType<typeof createHandoffStore>;
