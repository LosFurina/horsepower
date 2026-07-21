import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { DefaultPackageManager, SettingsManager, type ResolvedResource } from "@earendil-works/pi-coding-agent";
import { parse as parseYaml } from "yaml";

export type AuditStatus = "complete" | "partial" | "failed";
export type StaticSkillResolver = (onMissing: (source: string) => Promise<"skip">) => Promise<{ skills: ResolvedResource[] }>;
export interface AuditSkill {
  name: string;
  scope: "user" | "project";
  source: string;
  path: string;
  evidence: "resolved" | "candidate";
}
export interface SkillAuditResult {
  status: AuditStatus;
  cwd: string;
  externalCount: number;
  excludedCount: number;
  dynamicExtensionsEnumerated: false;
  skills: AuditSkill[];
  limitations: string[];
  candidateScanCommand: string;
}
export interface SkillAuditOptions {
  homeDir: string;
  cwd: string;
  agentDir?: string;
  openSpecVersion?: string;
  resolveStatic?: StaticSkillResolver;
  /** Deliberately unused: tests can prove the audit has no persistence hook. */
  onPersist?: () => void;
}

const MAX_RESULTS = 50;
const MAX_NAME = 64;
export const HOME_CANDIDATE_SCAN = 'find "$HOME" \\( -name node_modules -o -name .git -o -name Library \\) -prune -o \\( -name SKILL.md -o -path "*/.pi/skills/*.md" \\) -type f -print';
const LIMIT_DYNAMIC = "Dynamically extension-contributed Skills were not enumerated.";
const LIMIT_SCOPE = "The audit covers global and current-project context; future projects may expose different Skills.";

function within(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}
function fold(path: string, homeDir: string, cwd: string): string {
  if (within(cwd, path)) return `$PROJECT${sep}${relative(resolve(cwd), resolve(path))}`;
  if (within(homeDir, path)) return `$HOME${sep}${relative(resolve(homeDir), resolve(path))}`;
  const parts = resolve(path).split(sep).filter(Boolean);
  return `${sep}…${sep}${parts.slice(-3).join(sep)}`;
}
function sourceCategory(resource: ResolvedResource, evidence: "resolved" | "candidate"): string {
  if (evidence === "candidate") return "standard-location";
  if (resource.metadata.origin !== "package") return "settings";
  if (resource.metadata.source.startsWith("npm:")) return "npm-package";
  if (resource.metadata.source.startsWith("git:") || /^[a-z]+:\/\//iu.test(resource.metadata.source)) return "git-package";
  return "local-package";
}
function cleanName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/gu, "-");
  return (normalized || "unknown").slice(0, MAX_NAME);
}
function frontmatter(text: string): Record<string, string> {
  const end = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1;
  const parsed = parseYaml(end >= 0 ? text.slice(4, end) : text) as unknown;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") return {};
  const raw = parsed as Record<string, unknown>;
  const nested = raw.metadata !== null && !Array.isArray(raw.metadata) && typeof raw.metadata === "object"
    ? raw.metadata as Record<string, unknown>
    : {};
  const result: Record<string, string> = {};
  for (const key of ["name", "description", "allowed-tools"] as const) {
    if (typeof raw[key] === "string") result[key] = raw[key];
  }
  for (const key of ["author", "generatedBy"] as const) {
    const value = nested[key] ?? raw[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
async function ownedHorsepower(path: string, bytes: Buffer, homeDir: string): Promise<boolean> {
  const versionsPath = join(homeDir, ".pi", "agent", "horsepower", "versions");
  let canonical: string; let versions: string;
  try { canonical = await realpath(path); versions = await realpath(versionsPath); } catch { return false; }
  if (!within(versions, canonical)) return false;
  const rel = relative(versions, canonical).split(sep);
  if (rel.length < 3) return false;
  const release = join(versions, rel[0]!);
  try {
    const manifest = JSON.parse(await readFile(join(release, "release-manifest.json"), "utf8")) as Record<string, unknown>;
    const entry = (manifest.entryPoints as Record<string, unknown> | undefined)?.skill;
    const digest = (manifest.digests as Record<string, unknown> | undefined)?.[String(entry)];
    return typeof entry === "string" && resolve(release, entry) === resolve(canonical) && typeof digest === "string"
      && createHash("sha256").update(bytes).digest("hex") === digest;
  } catch { return false; }
}
function officialOpenSpec(path: string, metadata: Record<string, string>, cwd: string, version?: string): boolean {
  if (!version || !within(join(cwd, ".pi", "skills"), path)) return false;
  return metadata.author === "openspec" && metadata.generatedBy === version
    && metadata["allowed-tools"] === "Bash(openspec:*)"
    && /^openspec-[a-z0-9-]+$/u.test(metadata.name ?? "");
}
async function normalize(resources: readonly ResolvedResource[], options: SkillAuditOptions, evidence: "resolved" | "candidate") {
  const skills: AuditSkill[] = []; let excludedCount = 0; let unreadable = false;
  const seen = new Set<string>();
  for (const resource of resources) {
    if (!resource.enabled || skills.length >= MAX_RESULTS) continue;
    const key = resolve(resource.path); if (seen.has(key)) continue; seen.add(key);
    try {
      const bytes = await readFile(resource.path); const metadata = frontmatter(bytes.toString("utf8", 0, 8192));
      if (await ownedHorsepower(resource.path, bytes, options.homeDir) || officialOpenSpec(resource.path, metadata, options.cwd, options.openSpecVersion)) { excludedCount += 1; continue; }
      skills.push({
        name: cleanName(metadata.name ?? resource.path.split(sep).at(-2) ?? resource.path.split(sep).at(-1) ?? "unknown"),
        scope: resource.metadata.scope === "project" ? "project" : "user",
        source: sourceCategory(resource, evidence),
        path: fold(resource.path, options.homeDir, options.cwd), evidence,
      });
    } catch { unreadable = true; }
  }
  skills.sort((a, b) => `${a.scope}\0${a.name}\0${a.path}`.localeCompare(`${b.scope}\0${b.name}\0${b.path}`));
  return { skills, excludedCount, unreadable, truncated: resources.filter(({ enabled }) => enabled).length > MAX_RESULTS };
}
async function candidates(root: string, scope: "user" | "project", output: ResolvedResource[]): Promise<void> {
  async function visit(path: string, depth: number): Promise<void> {
    if (depth > 8 || output.length >= MAX_RESULTS) return;
    const info = await lstat(path);
    if (info.isSymbolicLink()) return;
    if (info.isFile() && (path.endsWith(`${sep}SKILL.md`) || (depth === 1 && path.endsWith(".md")))) {
      output.push({ path, enabled: true, metadata: { source: "standard-location", scope, origin: "top-level" } }); return;
    }
    if (!info.isDirectory()) return;
    for (const entry of await readdir(path)) await visit(join(path, entry), depth + 1);
  }
  try { await visit(root, 0); } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
}
async function fallback(options: SkillAuditOptions): Promise<ResolvedResource[]> {
  const output: ResolvedResource[] = [];
  for (const root of [join(options.homeDir, ".pi/agent/skills"), join(options.homeDir, ".agents/skills")]) await candidates(root, "user", output);
  for (const root of [join(options.cwd, ".pi/skills"), join(options.cwd, ".agents/skills")]) await candidates(root, "project", output);
  return output;
}
function sdkResolver(options: SkillAuditOptions): StaticSkillResolver {
  const agentDir = options.agentDir ?? join(options.homeDir, ".pi", "agent");
  const settings = SettingsManager.create(options.cwd, agentDir, { projectTrusted: true });
  const packages = new DefaultPackageManager({ cwd: options.cwd, agentDir, settingsManager: settings });
  return async (onMissing) => packages.resolve(onMissing);
}
export async function auditSkillExposure(options: SkillAuditOptions): Promise<SkillAuditResult> {
  const limitations = [LIMIT_DYNAMIC, LIMIT_SCOPE]; let missing = false;
  try {
    const resolved = await (options.resolveStatic ?? sdkResolver(options))(async () => { missing = true; return "skip"; });
    const normalized = await normalize(resolved.skills, options, "resolved");
    if (missing) limitations.push("One or more unavailable package sources were skipped without installation.");
    if (normalized.unreadable) limitations.push("One or more Skill resources were unreadable or malformed.");
    if (normalized.truncated) limitations.push(`Output was limited to ${MAX_RESULTS} Skills.`);
    const status: AuditStatus = missing || normalized.unreadable ? "partial" : "complete";
    return { status, cwd: resolve(options.cwd), externalCount: normalized.skills.length, excludedCount: normalized.excludedCount, dynamicExtensionsEnumerated: false, skills: normalized.skills, limitations, candidateScanCommand: HOME_CANDIDATE_SCAN };
  } catch {
    try {
      const normalized = await normalize(await fallback(options), options, "candidate");
      limitations.push("Static resolution failed; standard-location files are candidates and their enabled state is not fully known.");
      if (normalized.skills.length === 0 && normalized.unreadable) throw new Error("fallback unreadable");
      return { status: "partial", cwd: resolve(options.cwd), externalCount: normalized.skills.length, excludedCount: normalized.excludedCount, dynamicExtensionsEnumerated: false, skills: normalized.skills, limitations, candidateScanCommand: HOME_CANDIDATE_SCAN };
    } catch {
      limitations.push("Static resolution and safe standard-location fallback could not establish reliable candidates.");
      return { status: "failed", cwd: resolve(options.cwd), externalCount: 0, excludedCount: 0, dynamicExtensionsEnumerated: false, skills: [], limitations, candidateScanCommand: HOME_CANDIDATE_SCAN };
    }
  }
}
