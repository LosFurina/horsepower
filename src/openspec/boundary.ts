import { lstat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSupportedOpenSpecVersion, unsupportedOpenSpecMessage } from "../compatibility.js";
import { parseOpenSpecTaskInventory, type OpenSpecTaskInventory } from "./task-inventory.js";
import { createHash } from "node:crypto";

export type SafeAction = "status" | "list" | "read" | "abort" | "destroy" | "doctor";
export type AdvancingAction = "single" | "parallel" | "chain" | "create" | "send" | "steer" | "begin_change" | "report_terminal";
export type HorsepowerAction = SafeAction | AdvancingAction;

export interface OpenSpecCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface OpenSpecBoundaryOptions {
  run(args: readonly string[], options: { cwd: string }): Promise<OpenSpecCommandResult>;
  readText(path: string): Promise<string>;
  inspectPath?: (path: string) => Promise<{ isFile(): boolean; isDirectory?(): boolean; isSymbolicLink(): boolean; size?: number; nlink?: number }>;
}

export interface AuthorizationInput {
  action: HorsepowerAction;
  cwd: string;
  changeId?: string;
}

const safeActions = new Set<SafeAction>(["status", "list", "read", "abort", "destroy", "doctor"]);

export async function validateOpenSpecInstallation(
  options: OpenSpecBoundaryOptions,
  cwd: string,
): Promise<{ version: string; projectRoot: string }> {
  const versionResult = await options.run(["--version"], { cwd });
  if (versionResult.code !== 0) {
    throw new Error(
      "Official OpenSpec CLI was not found. Install @fission-ai/openspec from the official Fission-AI/OpenSpec project.",
    );
  }
  const version = versionResult.stdout.trim();
  if (!isSupportedOpenSpecVersion(version)) throw new Error(unsupportedOpenSpecMessage(version));
  const doctor = await options.run(["doctor", "--json"], { cwd });
  if (doctor.code !== 0) throw new Error("OpenSpec project is not healthy");
  let projectRoot: string;
  try {
    const parsed = JSON.parse(doctor.stdout) as { root?: { healthy?: unknown; path?: unknown } };
    if (parsed.root?.healthy !== true || typeof parsed.root.path !== "string" || !parsed.root.path) throw new Error("unhealthy");
    projectRoot = parsed.root.path;
  } catch {
    throw new Error("OpenSpec project is not healthy");
  }
  const skillPath = `${projectRoot}/.pi/skills/openspec-apply-change/SKILL.md`;
  const promptPath = `${projectRoot}/.pi/prompts/opsx-apply.md`;
  let skill: string;
  let prompt: string;
  try {
    [skill, prompt] = await Promise.all([options.readText(skillPath), options.readText(promptPath)]);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("OpenSpec Pi integration is missing; run: openspec init --tools pi");
    }
    throw cause;
  }
  const generatedBy = /^\s*generatedBy:\s*["']?([^\s"']+)/mu.exec(skill)?.[1];
  const official = /^name:\s*openspec-apply-change\s*$/mu.test(skill) && /^\s*author:\s*openspec\s*$/mu.test(skill) &&
    /^\s*allowed-tools:\s*Bash\(openspec:\*\)\s*$/mu.test(skill) && /^Implement tasks from an OpenSpec change\.?\s*$/mu.test(prompt);
  if (!official || generatedBy !== version) {
    throw new Error("OpenSpec Pi integration is stale; run: openspec update");
  }
  return { version, projectRoot };
}

export function createOpenSpecBoundary(options: OpenSpecBoundaryOptions) {
  async function applyContext(input: { cwd: string; changeId: string }) {
    const installation = await validateOpenSpecInstallation(options, input.cwd);
    const status = await options.run(["status", "--change", input.changeId, "--json"], { cwd: input.cwd });
    if (status.code !== 0) throw new Error(`OpenSpec change was not found or ready: ${input.changeId}`);
    let parsedStatus: Record<string, unknown>;
    try {
      parsedStatus = JSON.parse(status.stdout) as Record<string, unknown>;
      if (parsedStatus.changeName !== input.changeId) throw new Error("mismatch");
      if (parsedStatus.isComplete !== true) throw new Error(`OpenSpec change is not ready to apply: ${input.changeId}`);
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("OpenSpec change is not ready")) throw cause;
      throw new Error(`OpenSpec returned invalid status for change: ${input.changeId}`);
    }
    const validation = await options.run(["validate", input.changeId, "--strict", "--json"], { cwd: input.cwd });
    if (validation.code !== 0) throw new Error(`OpenSpec change is not valid: ${input.changeId}`);
    try {
      const parsed = JSON.parse(validation.stdout) as { summary?: { totals?: { failed?: unknown } } };
      if (parsed.summary?.totals?.failed !== 0) throw new Error("failed");
    } catch { throw new Error(`OpenSpec change is not valid: ${input.changeId}`); }
    return { ...installation, status: parsedStatus };
  }

  async function loadTaskInventory(input: { cwd: string; changeId: string }): Promise<OpenSpecTaskInventory> {
    const { projectRoot, status } = await applyContext(input);
    const artifactPaths = status.artifactPaths as Record<string, unknown> | undefined;
    const tasks = artifactPaths?.tasks as Record<string, unknown> | undefined;
    const rawPath = tasks?.resolvedOutputPath;
    if (typeof rawPath !== "string" || !rawPath || rawPath.includes("*")) throw new Error(`OpenSpec status has no resolved tasks artifact for change: ${input.changeId}`);
    const tasksPath = resolve(rawPath), root = resolve(projectRoot), rel = relative(root, tasksPath);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("OpenSpec tasks artifact escapes project root");
    const inspect = options.inspectPath ?? lstat;
    if (!options.inspectPath) {
      let ancestor = root;
      for (const part of rel.split(sep).slice(0, -1)) {
        ancestor = join(ancestor, part);
        const ancestorInfo = await inspect(ancestor);
        if (ancestorInfo.isSymbolicLink() || ancestorInfo.isDirectory?.() === false) throw new Error("OpenSpec tasks artifact path contains a non-directory or symbolic-link ancestor");
      }
    }
    const info = await inspect(tasksPath);
    if (info.isSymbolicLink() || !info.isFile() || (info.nlink !== undefined && info.nlink !== 1)) throw new Error("OpenSpec tasks artifact must be a regular non-symbolic-link file with one link");
    if (info.size !== undefined && info.size > 1024 * 1024) throw new Error("OpenSpec tasks artifact exceeds 1 MiB");
    return parseOpenSpecTaskInventory(await options.readText(tasksPath), { changeId: input.changeId, projectRoot: root, tasksPath });
  }

  return {
    async snapshotAcceptance(input: { cwd: string; changeId: string; selectedTaskIds: readonly string[]; selectedTasks?: readonly { id: string; description: string; sectionId: string; status?: "pending" | "complete" }[]; requireComplete?: boolean }): Promise<{ digest: string; refs: readonly string[] }> {
      const inventory = await loadTaskInventory(input);
      const selected = [...input.selectedTaskIds];
      const official = inventory.sections.flatMap((section) => section.tasks.map((task) => task.id));
      if (selected.length === 0 || new Set(selected).size !== selected.length) throw new Error("OpenSpec acceptance snapshot requires exact selected task IDs");
      if (selected.some((id) => !official.includes(id))) throw new Error("OpenSpec acceptance snapshot selected task is not in the official inventory");
      const order = official.filter((id) => selected.includes(id));
      if (order.join("\0") !== selected.join("\0")) throw new Error("OpenSpec acceptance snapshot task ordering drifted");
      if (input.selectedTasks) {
        if (input.selectedTasks.length !== selected.length) throw new Error("VERIFICATION_SCOPE_DRIFT: official selected task scope changed");
        for (let index = 0; index < selected.length; index += 1) {
          const expected = input.selectedTasks[index]!;
          const current = inventory.sections.flatMap((section) => section.tasks).find((task) => task.id === selected[index]);
          if (!current || current.description !== expected.description || current.sectionId !== expected.sectionId) throw new Error("VERIFICATION_SCOPE_DRIFT: official selected task identity changed");
        }
      }
      if (input.requireComplete) {
        const unchecked = inventory.sections.flatMap((section) => section.tasks).filter((task) => selected.includes(task.id) && task.status !== "complete").map((task) => task.id);
        if (unchecked.length) throw new Error(`VERIFICATION_ACCEPTANCE_UNCHECKED: complete current OpenSpec tasks before reporting: ${unchecked.join(",")}`);
      }
      const refs = selected.map((id) => `task:${id}`);
      const digest = createHash("sha256").update(JSON.stringify({ changeId: input.changeId, digest: inventory.digest, refs })).digest("hex");
      return { digest, refs };
    },
    async authorize(input: AuthorizationInput) {
      if (safeActions.has(input.action as SafeAction)) {
        return { allowed: true as const, action: input.action, openspecRequired: false as const };
      }
      if (!input.changeId?.trim()) throw new Error(`OpenSpec change is required for ${input.action}`);
      const { version } = await applyContext({ cwd: input.cwd, changeId: input.changeId });
      return {
        allowed: true as const,
        action: input.action,
        openspecRequired: true as const,
        version,
        changeId: input.changeId,
      };
    },
    async loadTaskInventory(input: { cwd: string; changeId: string }) {
      return loadTaskInventory(input);
    },
  };
}
