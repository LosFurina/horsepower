import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

export type AgentScope = "bundled" | "global" | "project";

const delegationTools = new Set(["horsepower", "horsepower_subagent", "subagent"]);

export interface AgentDefinition {
  name: string;
  role: string;
  recommendedSlots: string[];
  tools: string[];
  standards: string[];
  prompt: string;
  source: string;
  scope: AgentScope;
}

export interface DiscoverAgentsOptions {
  bundledDir?: string;
  globalDir?: string;
  projectDir?: string;
}

interface AgentFrontmatter {
  name?: unknown;
  role?: unknown;
  recommendedSlots?: unknown;
  tools?: unknown;
  standards?: unknown;
  model?: unknown;
  provider?: unknown;
}

function stringArray(value: unknown, field: string, source: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Agent definition field ${field} must be an array of strings: ${source}`);
  }
  return [...value];
}

function parseAgent(source: string, scope: AgentScope, contents: string): AgentDefinition {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(contents);
  if (!match) throw new Error(`Agent definition is missing YAML frontmatter: ${source}`);
  const parsed: unknown = parse(match[1]!);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`Agent definition frontmatter must be an object: ${source}`);
  }
  const metadata = parsed as AgentFrontmatter;
  const allowedFields = new Set([
    "name", "role", "recommendedSlots", "tools", "standards", "model", "provider",
  ]);
  const unknownFields = Object.keys(metadata).filter((field) => !allowedFields.has(field)).sort();
  if (unknownFields.length > 0) {
    throw new Error(`Unknown agent definition fields ${unknownFields.join(", ")}: ${source}`);
  }
  if (typeof metadata.name !== "string" || typeof metadata.role !== "string") {
    throw new Error(`Agent definition requires string name and role: ${source}`);
  }
  if (metadata.model !== undefined) {
    throw new Error(`Agent definition must not bind a concrete model: ${source}`);
  }
  if (metadata.provider !== undefined) {
    throw new Error(`Agent definition must not bind a concrete provider: ${source}`);
  }
  const prompt = match[2]!.trim();
  if (!prompt) throw new Error(`Agent definition requires a non-empty prompt: ${source}`);
  return {
    name: metadata.name,
    role: metadata.role,
    recommendedSlots: stringArray(metadata.recommendedSlots, "recommendedSlots", source),
    tools: stringArray(metadata.tools, "tools", source)
      .filter((tool) => !delegationTools.has(tool)),
    standards: stringArray(metadata.standards, "standards", source),
    prompt,
    source,
    scope,
  };
}

async function readScope(directory: string | undefined, scope: AgentScope): Promise<AgentDefinition[]> {
  if (!directory) return [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  return Promise.all(files.map(async (file) => {
    const source = join(directory, file);
    return parseAgent(source, scope, await readFile(source, "utf8"));
  }));
}

export async function discoverAgents(options: DiscoverAgentsOptions): Promise<AgentDefinition[]> {
  const definitions = await Promise.all([
    readScope(options.bundledDir, "bundled"),
    readScope(options.globalDir, "global"),
    readScope(options.projectDir, "project"),
  ]);
  const effective = new Map<string, AgentDefinition>();
  for (const scope of definitions) {
    for (const agent of scope) effective.set(agent.name, agent);
  }
  return [...effective.values()].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );
}
