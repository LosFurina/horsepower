import type { SpawnOptionsWithoutStdio } from "node:child_process";
import type { ThinkingLevel } from "../slots/registry.js";

const delegationTools = new Set(["horsepower", "horsepower_subagent", "subagent"]);
const toolNamePattern = /^[A-Za-z][A-Za-z0-9_-]*$/;

export interface PersistentPiLaunchInput {
  executable: string;
  model: string;
  thinking: ThinkingLevel;
  promptFile: string;
  tools: readonly string[];
}

export interface PiLaunch {
  command: string;
  args: string[];
  options: SpawnOptionsWithoutStdio & { stdio: ["pipe", "pipe", "pipe"] };
}

export function safePiTools(tools: readonly string[]): string[] {
  for (const tool of tools) {
    if (!toolNamePattern.test(tool)) throw new Error(`Invalid Pi tool name: ${tool}`);
  }
  return tools.filter((tool) => !delegationTools.has(tool));
}

export function buildPersistentPiLaunch(input: PersistentPiLaunchInput): PiLaunch {
  const tools = safePiTools(input.tools);
  const args = [
    "--mode", "rpc",
    "--no-session",
    "--no-skills",
    "--model", input.model,
    "--thinking", input.thinking,
    "--append-system-prompt", input.promptFile,
  ];
  args.push(...(tools.length > 0 ? ["--tools", tools.join(",")] : ["--no-tools"]));
  return {
    command: input.executable,
    args,
    options: {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  };
}
