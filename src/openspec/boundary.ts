import { isSupportedOpenSpecVersion, unsupportedOpenSpecMessage } from "../compatibility.js";

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
  return {
    async authorize(input: AuthorizationInput) {
      if (safeActions.has(input.action as SafeAction)) {
        return { allowed: true as const, action: input.action, openspecRequired: false as const };
      }
      if (!input.changeId?.trim()) throw new Error(`OpenSpec change is required for ${input.action}`);
      const { version } = await validateOpenSpecInstallation(options, input.cwd);
      const status = await options.run(
        ["status", "--change", input.changeId, "--json"],
        { cwd: input.cwd },
      );
      if (status.code !== 0) throw new Error(`OpenSpec change was not found or ready: ${input.changeId}`);
      try {
        const parsed = JSON.parse(status.stdout) as { changeName?: unknown; isComplete?: unknown };
        if (parsed.changeName !== input.changeId) throw new Error("mismatch");
        if (parsed.isComplete !== true) {
          throw new Error(`OpenSpec change is not ready to apply: ${input.changeId}`);
        }
      } catch (cause) {
        if (cause instanceof Error && cause.message.startsWith("OpenSpec change is not ready")) throw cause;
        throw new Error(`OpenSpec returned invalid status for change: ${input.changeId}`);
      }
      const validation = await options.run(
        ["validate", input.changeId, "--strict", "--json"],
        { cwd: input.cwd },
      );
      if (validation.code !== 0) throw new Error(`OpenSpec change is not valid: ${input.changeId}`);
      try {
        const parsed = JSON.parse(validation.stdout) as { summary?: { totals?: { failed?: unknown } } };
        if (parsed.summary?.totals?.failed !== 0) throw new Error("failed");
      } catch {
        throw new Error(`OpenSpec change is not valid: ${input.changeId}`);
      }
      return {
        allowed: true as const,
        action: input.action,
        openspecRequired: true as const,
        version,
        changeId: input.changeId,
      };
    },
  };
}
