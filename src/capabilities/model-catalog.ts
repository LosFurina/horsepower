import { createHash } from "node:crypto";
import { thinkingLevels, type ModelCatalog, type ThinkingLevel } from "../slots/registry.js";

export interface PiCatalogModel {
  provider: string;
  id: string;
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
}

export interface PiModelRegistry {
  getAll(): PiCatalogModel[];
}

export interface PiAvailableModelRuntime {
  getAvailable(): Promise<readonly PiCatalogModel[]>;
}

export type PiModelCatalog = {
  status: "available";
  modelIds: readonly string[];
  models: ModelCatalog;
  revision: string;
} | {
  status: "unavailable";
  reason: "empty" | "registry-error";
};

function exactThinkingLevels(model: PiCatalogModel): readonly ThinkingLevel[] | undefined {
  if (!model.thinkingLevelMap) return undefined;
  return thinkingLevels.filter((level) => typeof model.thinkingLevelMap?.[level] === "string");
}

export function createPiModelCatalog(registry: PiModelRegistry): PiModelCatalog {
  let current: PiCatalogModel[];
  try {
    current = registry.getAll();
  } catch {
    return { status: "unavailable", reason: "registry-error" };
  }
  if (current.length === 0) return { status: "unavailable", reason: "empty" };

  const catalogModels = current
    .map((model) => ({
      id: `${model.provider}/${model.id}`,
      reasoning: model.reasoning === true,
      thinkingLevels: exactThinkingLevels(model),
    }))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const entries = catalogModels.map(({ id, thinkingLevels: levels }) => [id, { thinkingLevels: levels }] as const);
  const models = Object.freeze(Object.fromEntries(entries));
  const revisionInput = catalogModels.map(({ id, reasoning, thinkingLevels: levels }) => [id, reasoning, levels ?? null]);
  const revision = createHash("sha256").update(JSON.stringify(revisionInput)).digest("hex");

  return Object.freeze({
    status: "available" as const,
    modelIds: Object.freeze(entries.map(([id]) => id)),
    models,
    revision,
  });
}

export async function loadSelectablePiModelCatalog(
  runtime: PiAvailableModelRuntime,
  enabledModels: readonly string[] | undefined,
  resolveEnabled: (patterns: readonly string[]) => Promise<readonly PiCatalogModel[]>,
): Promise<PiModelCatalog> {
  try {
    const selected = enabledModels && enabledModels.length > 0
      ? await resolveEnabled(enabledModels)
      : await runtime.getAvailable();
    return createPiModelCatalog({ getAll: () => [...selected] });
  } catch {
    return { status: "unavailable", reason: "registry-error" };
  }
}
