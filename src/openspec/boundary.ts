import { lstat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isSupportedOpenSpecVersion, unsupportedOpenSpecMessage } from "../compatibility.js";
import { parseOpenSpecTaskInventory, type OpenSpecTaskInventory } from "./task-inventory.js";
import {
  parseTestAndGatePlan,
  type AcceptanceInventory,
  type TestAndGatePlan,
} from "./test-and-gate-plan.js";
import { createHash } from "node:crypto";

export type SafeAction = "status" | "list" | "read" | "abort" | "destroy" | "doctor";
export type AdvancingAction = "single" | "parallel" | "chain" | "create" | "send" | "steer" | "begin_change" | "report_terminal";
export type HorsepowerAction = SafeAction | AdvancingAction;

export interface OpenSpecCommandResult {
  code: number;
  stdout: string;
  stderr: string;
  truncated?: boolean;
  timedOut?: boolean;
}

export interface OpenSpecBoundaryOptions {
  run(args: readonly string[], options: { cwd: string }): Promise<OpenSpecCommandResult>;
  readText(path: string): Promise<string>;
  inspectPath?: (path: string) => Promise<{ isFile(): boolean; isDirectory?(): boolean; isSymbolicLink(): boolean; size?: number; nlink?: number }>;
}

export interface OpenSpecChangeCandidate {
  changeId: string;
  completedTasks: number;
  totalTasks: number;
}

export interface AuthorizationInput {
  action: HorsepowerAction;
  cwd: string;
  changeId?: string;
}

const MAX_DISCOVERY_BYTES = 1024 * 1024;
const MAX_DISCOVERY_CANDIDATES = 100;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_SPEC_FILES = 50;
const DISCOVERY_CONCURRENCY = 4;
const changeIdPattern = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u;
type VerifiedOpenSpecContext = Awaited<ReturnType<typeof validateOpenSpecInstallation>>;

class SkippableCandidateError extends Error {}

async function readProtectedArtifact(options: OpenSpecBoundaryOptions, input: {
  projectRoot: string;
  rawPath: string;
  label: string;
}): Promise<{ path: string; text: string }> {
  const artifactPath = resolve(input.rawPath);
  const root = resolve(input.projectRoot);
  const rel = relative(root, artifactPath);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`OpenSpec ${input.label} artifact escapes project root`);
  }
  const inspect = options.inspectPath ?? lstat;
  if (!options.inspectPath) {
    let ancestor = root;
    for (const part of rel.split(sep).slice(0, -1)) {
      ancestor = join(ancestor, part);
      const ancestorInfo = await inspect(ancestor);
      if (ancestorInfo.isSymbolicLink() || ancestorInfo.isDirectory?.() === false) {
        throw new Error(`OpenSpec ${input.label} artifact path contains a non-directory or symbolic-link ancestor`);
      }
    }
  }
  const info = await inspect(artifactPath);
  if (info.isSymbolicLink() || !info.isFile() || (info.nlink !== undefined && info.nlink !== 1)) {
    throw new Error(`OpenSpec ${input.label} artifact must be a regular non-symbolic-link file with one link`);
  }
  if (info.size !== undefined && info.size > MAX_ARTIFACT_BYTES) {
    throw new Error(`OpenSpec ${input.label} artifact exceeds 1 MiB`);
  }
  const text = await options.readText(artifactPath);
  if (Buffer.byteLength(text, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error(`OpenSpec ${input.label} artifact exceeds 1 MiB`);
  }
  return { path: artifactPath, text };
}

function parseRequirementScenarios(source: string): AcceptanceInventory["requirements"][number][] {
  const requirements: AcceptanceInventory["requirements"][number][] = [];
  let current: { title: string; scenarios: string[] } | undefined;
  for (const line of source.split(/\r?\n/u)) {
    const requirement = /^###\s+Requirement:\s+(.+?)\s*$/u.exec(line);
    if (requirement) {
      current = { title: requirement[1]!.trim(), scenarios: [] };
      requirements.push(current);
      continue;
    }
    const scenario = /^####\s+Scenario:\s+(.+?)\s*$/u.exec(line);
    if (scenario) {
      if (!current) continue;
      current.scenarios.push(scenario[1]!.trim());
    }
  }
  return requirements;
}

function checkedJson(result: OpenSpecCommandResult, operation: string): unknown {
  if (result.timedOut) throw new Error(`OpenSpec ${operation} timed out; run openspec doctor and retry`);
  if (result.truncated || Buffer.byteLength(result.stdout, "utf8") > MAX_DISCOVERY_BYTES) throw new Error(`OpenSpec ${operation} output exceeded the 1 MiB limit`);
  if (result.code !== 0) throw new Error(`OpenSpec ${operation} failed; run openspec doctor and retry`);
  try { return JSON.parse(result.stdout) as unknown; }
  catch { throw new Error(`OpenSpec ${operation} returned malformed or truncated JSON`); }
}

const safeActions = new Set<SafeAction>(["status", "list", "read", "abort", "destroy", "doctor"]);

export async function validateOpenSpecInstallation(
  options: OpenSpecBoundaryOptions,
  cwd: string,
): Promise<{ version: string; projectRoot: string }> {
  const versionResult = await options.run(["--version"], { cwd });
  if (versionResult.timedOut) throw new Error("OpenSpec version check timed out; run openspec doctor and retry");
  if (versionResult.truncated || Buffer.byteLength(versionResult.stdout, "utf8") > MAX_DISCOVERY_BYTES) throw new Error("OpenSpec version output exceeded the 1 MiB limit");
  if (versionResult.code !== 0) {
    throw new Error(
      "Official OpenSpec CLI was not found. Install @fission-ai/openspec from the official Fission-AI/OpenSpec project.",
    );
  }
  const version = versionResult.stdout.trim();
  if (!isSupportedOpenSpecVersion(version)) throw new Error(unsupportedOpenSpecMessage(version));
  const doctor = checkedJson(await options.run(["doctor", "--json"], { cwd }), "doctor");
  let projectRoot: string;
  try {
    const parsed = doctor as { root?: { healthy?: unknown; path?: unknown } };
    if (parsed === null || typeof parsed !== "object" || parsed.root?.healthy !== true || typeof parsed.root.path !== "string" || !parsed.root.path) throw new Error("unhealthy");
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
  async function discoverUnfinishedChanges(input: { cwd: string }): Promise<OpenSpecChangeCandidate[]> {
    const verifiedContext = await validateOpenSpecInstallation(options, input.cwd);
    const { projectRoot } = verifiedContext;
    const listed = checkedJson(await options.run(["list", "--json"], { cwd: input.cwd }), "change discovery");
    if (listed === null || Array.isArray(listed) || typeof listed !== "object") throw new Error("OpenSpec change discovery returned an unsupported schema");
    const output = listed as { changes?: unknown; root?: { path?: unknown; source?: unknown } };
    if (!Array.isArray(output.changes) || typeof output.root?.path !== "string" || output.root.source !== "nearest") throw new Error("OpenSpec change discovery returned an unsupported schema");
    if (resolve(output.root.path) !== resolve(projectRoot)) throw new Error("OpenSpec change discovery returned a different project root");
    if (output.changes.length > MAX_DISCOVERY_CANDIDATES) throw new Error(`OpenSpec change discovery permits at most ${MAX_DISCOVERY_CANDIDATES} candidates`);
    const seen = new Set<string>();
    const admitted: OpenSpecChangeCandidate[] = [];
    for (const raw of output.changes) {
      if (raw === null || typeof raw !== "object") throw new Error("OpenSpec change discovery returned an invalid candidate");
      const item = raw as Record<string, unknown>;
      const changeId = item.name;
      const completedTasks = item.completedTasks;
      const totalTasks = item.totalTasks;
      if (typeof changeId !== "string" || !changeIdPattern.test(changeId)) throw new Error("OpenSpec change discovery returned an invalid change ID");
      if (seen.has(changeId)) throw new Error("OpenSpec change discovery returned a duplicate change ID");
      seen.add(changeId);
      if (!Number.isSafeInteger(completedTasks) || !Number.isSafeInteger(totalTasks) || Number(completedTasks) < 0 || Number(totalTasks) < 0 || Number(completedTasks) > Number(totalTasks) || Number(totalTasks) > 1_000) throw new Error(`OpenSpec change discovery returned invalid progress for: ${changeId}`);
      if (typeof item.status !== "string" || !new Set(["in-progress", "complete", "completed", "archived", "no-tasks"]).has(item.status)) throw new Error(`OpenSpec change discovery returned an unsupported status for: ${changeId}`);
      if (item.status === "in-progress" && completedTasks !== totalTasks && totalTasks !== 0) {
        admitted.push({ changeId, completedTasks: Number(completedTasks), totalTasks: Number(totalTasks) });
      }
    }
    type Outcome = { candidate?: OpenSpecChangeCandidate; error?: Error };
    const outcomes = new Array<Outcome>(admitted.length);
    let nextIndex = 0;
    async function inspectNext(): Promise<void> {
      while (nextIndex < admitted.length) {
        const index = nextIndex++;
        const candidate = admitted[index]!;
        try {
          const inventory = await loadTaskInventory({ cwd: input.cwd, changeId: candidate.changeId }, verifiedContext);
          const tasks = inventory.sections.flatMap((section) => section.tasks);
          const complete = tasks.filter((task) => task.status === "complete").length;
          if (tasks.length !== candidate.totalTasks || complete !== candidate.completedTasks) throw new Error(`OpenSpec change progress is ambiguous for: ${candidate.changeId}`);
          outcomes[index] = tasks.some((task) => task.status === "pending") ? { candidate } : {};
        } catch (cause) {
          outcomes[index] = cause instanceof SkippableCandidateError
            ? {}
            : cause instanceof Error && cause.message.startsWith("OpenSpec change progress is ambiguous")
              ? { error: cause }
              : { error: new Error(`OpenSpec change discovery could not validate change: ${candidate.changeId}`) };
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(DISCOVERY_CONCURRENCY, admitted.length) }, () => inspectNext()));
    const failure = outcomes.find((outcome) => outcome.error)?.error;
    if (failure) throw failure;
    return outcomes.flatMap((outcome) => outcome.candidate ? [outcome.candidate] : []);
  }
  async function applyContext(input: { cwd: string; changeId: string }, verifiedContext?: VerifiedOpenSpecContext) {
    const installation = verifiedContext ?? await validateOpenSpecInstallation(options, input.cwd);
    const status = await options.run(["status", "--change", input.changeId, "--json"], { cwd: input.cwd });
    if (status.timedOut) throw new Error(`OpenSpec status timed out for change: ${input.changeId}`);
    if (status.truncated || Buffer.byteLength(status.stdout, "utf8") > MAX_DISCOVERY_BYTES) throw new Error(`OpenSpec status output exceeded the 1 MiB limit for change: ${input.changeId}`);
    if (status.code === 1) throw new SkippableCandidateError(`OpenSpec change was not found or ready: ${input.changeId}`);
    if (status.code !== 0) throw new Error(`OpenSpec status failed for change: ${input.changeId}`);
    let parsedStatus: Record<string, unknown>;
    try {
      parsedStatus = JSON.parse(status.stdout) as Record<string, unknown>;
      if (parsedStatus.changeName !== input.changeId) throw new Error("mismatch");
      if (parsedStatus.isComplete !== true) throw new SkippableCandidateError(`OpenSpec change is not ready to apply: ${input.changeId}`);
    } catch (cause) {
      if (cause instanceof SkippableCandidateError) throw cause;
      throw new Error(`OpenSpec returned invalid status for change: ${input.changeId}`);
    }
    const validation = await options.run(["validate", input.changeId, "--strict", "--json"], { cwd: input.cwd });
    if (validation.timedOut) throw new Error(`OpenSpec strict validation timed out for change: ${input.changeId}`);
    if (validation.truncated || Buffer.byteLength(validation.stdout, "utf8") > MAX_DISCOVERY_BYTES) throw new Error(`OpenSpec strict validation output exceeded the 1 MiB limit for change: ${input.changeId}`);
    if (validation.code !== 0) throw new Error(`OpenSpec change is not valid: ${input.changeId}`);
    try {
      const parsed = JSON.parse(validation.stdout) as { summary?: { totals?: { failed?: unknown } } };
      if (parsed.summary?.totals?.failed !== 0) throw new Error("failed");
    } catch { throw new Error(`OpenSpec change is not valid: ${input.changeId}`); }
    return { ...installation, status: parsedStatus };
  }

  async function loadTaskInventory(input: { cwd: string; changeId: string }, verifiedContext?: VerifiedOpenSpecContext): Promise<OpenSpecTaskInventory> {
    const { projectRoot, status } = await applyContext(input, verifiedContext);
    const artifactPaths = status.artifactPaths as Record<string, unknown> | undefined;
    const tasks = artifactPaths?.tasks as Record<string, unknown> | undefined;
    const rawPath = tasks?.resolvedOutputPath;
    if (typeof rawPath !== "string" || !rawPath || rawPath.includes("*")) throw new Error(`OpenSpec status has no resolved tasks artifact for change: ${input.changeId}`);
    const { path: tasksPath, text } = await readProtectedArtifact(options, {
      projectRoot,
      rawPath,
      label: "tasks",
    });
    return parseOpenSpecTaskInventory(text, { changeId: input.changeId, projectRoot: resolve(projectRoot), tasksPath });
  }

  async function loadTestAndGatePlan(input: { cwd: string; changeId: string }, verifiedContext?: VerifiedOpenSpecContext): Promise<TestAndGatePlan> {
    const { projectRoot, status } = await applyContext(input, verifiedContext);
    const artifactPaths = status.artifactPaths as Record<string, unknown> | undefined;
    const design = artifactPaths?.design as Record<string, unknown> | undefined;
    const tasks = artifactPaths?.tasks as Record<string, unknown> | undefined;
    const specs = artifactPaths?.specs as Record<string, unknown> | undefined;
    const designPath = design?.resolvedOutputPath;
    const tasksPath = tasks?.resolvedOutputPath;
    if (typeof designPath !== "string" || !designPath || designPath.includes("*")) {
      throw new Error(`OpenSpec status has no resolved design artifact for change: ${input.changeId}`);
    }
    if (typeof tasksPath !== "string" || !tasksPath || tasksPath.includes("*")) {
      throw new Error(`OpenSpec status has no resolved tasks artifact for change: ${input.changeId}`);
    }

    const designArtifact = await readProtectedArtifact(options, {
      projectRoot,
      rawPath: designPath,
      label: "design",
    });
    const tasksArtifact = await readProtectedArtifact(options, {
      projectRoot,
      rawPath: tasksPath,
      label: "tasks",
    });

    const inventory = parseOpenSpecTaskInventory(tasksArtifact.text, {
      changeId: input.changeId,
      projectRoot: resolve(projectRoot),
      tasksPath: tasksArtifact.path,
    });

    const existingSpecPaths = Array.isArray(specs?.existingOutputPaths)
      ? specs.existingOutputPaths.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    if (existingSpecPaths.length === 0) {
      throw new Error(`OpenSpec status has no resolved specs artifacts for change: ${input.changeId}`);
    }
    if (existingSpecPaths.length > MAX_SPEC_FILES) {
      throw new Error(`OpenSpec specs inventory permits at most ${MAX_SPEC_FILES} files`);
    }

    const requirements: AcceptanceInventory["requirements"][number][] = [];
    for (const rawSpecPath of existingSpecPaths) {
      if (rawSpecPath.includes("*")) throw new Error(`OpenSpec status has no resolved specs artifacts for change: ${input.changeId}`);
      const specArtifact = await readProtectedArtifact(options, {
        projectRoot,
        rawPath: rawSpecPath,
        label: "specs",
      });
      requirements.push(...parseRequirementScenarios(specArtifact.text));
    }

    const acceptance: AcceptanceInventory = {
      requirements,
      taskIds: inventory.sections.flatMap((section) => section.tasks.map((task) => task.id)),
    };
    return parseTestAndGatePlan(designArtifact.text, {
      changeId: input.changeId,
      acceptance,
    });
  }

  return {
    discoverUnfinishedChanges,
    async revalidateUnfinishedChange(input: { cwd: string; changeId: string; inventoryDigest: string }) {
      const inventory = await loadTaskInventory(input);
      if (inventory.digest !== input.inventoryDigest || !inventory.sections.some((section) => section.tasks.some((task) => task.status === "pending"))) {
        throw new Error("OpenSpec change changed before campaign confirmation; run /horsepower-campaign again");
      }
      return inventory;
    },
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
    async loadTestAndGatePlan(input: { cwd: string; changeId: string }) {
      return loadTestAndGatePlan(input);
    },
    async revalidateTestAndGatePlan(input: {
      cwd: string;
      changeId: string;
      planDigest: string;
      selectedTaskIds: readonly string[];
    }) {
      const plan = await loadTestAndGatePlan(input);
      if (plan.digest !== input.planDigest) {
        throw new Error("PLAN_DRIFT: official test-and-gate plan changed before authorization; confirm a new campaign");
      }
      const inventory = await loadTaskInventory(input);
      const official = new Set(inventory.sections.flatMap((section) => section.tasks.map((task) => task.id)));
      if (input.selectedTaskIds.length === 0 || new Set(input.selectedTaskIds).size !== input.selectedTaskIds.length) {
        throw new Error("PLAN_SCOPE: selected task IDs must be exact and unique");
      }
      for (const taskId of input.selectedTaskIds) {
        if (!official.has(taskId)) throw new Error(`PLAN_SCOPE: selected task is not in the official inventory: ${taskId}`);
        const ref = `task:${taskId}`;
        const covered = plan.cases.some((item) => item.maps.includes(ref))
          || plan.nonApplicability.some((item) => item.covers.includes(ref));
        if (!covered) throw new Error(`PLAN_SCOPE: selected task lacks plan coverage: ${taskId}`);
      }
      return plan;
    },
  };
}
