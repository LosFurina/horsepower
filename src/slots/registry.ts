import { createHash } from "node:crypto";

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ThinkingLevel = (typeof thinkingLevels)[number];

export interface ModelBinding {
  model: string;
  thinking: ThinkingLevel;
}

export interface FallbackBinding {
  fallback: string;
}

export type SlotBinding = ModelBinding | FallbackBinding;

export interface SlotConfiguration {
  slots?: Readonly<Record<string, SlotBinding>>;
}

export interface ModelCapabilities {
  thinkingLevels: readonly ThinkingLevel[] | undefined;
}

export type ModelCatalog = Readonly<Record<string, ModelCapabilities>>;

export interface CreateSlotRegistryOptions {
  global?: SlotConfiguration;
  project?: SlotConfiguration;
  models?: ModelCatalog;
}

export interface ResolvedSlot extends ModelBinding {
  requestedSlot: string;
  resolvedSlot: string;
  fallbackPath: string[];
  revision: string;
}

export interface SlotRegistry {
  readonly revision: string;
  readonly effective: Readonly<Record<string, SlotBinding>>;
  resolve(slot: string): ResolvedSlot;
}

const requiredSlots = ["judgment", "craft", "utility"] as const;
const slotIdPattern = /^[a-z][a-z0-9-]{0,31}$/;
const thinkingLevelSet = new Set<string>(thinkingLevels);
const builtInFallbacks: Readonly<Record<string, FallbackBinding>> = {
  speed: { fallback: "utility" },
  context: { fallback: "judgment" },
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, nested]) => [key, normalize(nested)]),
  );
}

function normalizedJson(value: Record<string, SlotBinding>): string {
  return JSON.stringify(normalize(value));
}

function traceFallback(
  effective: Record<string, SlotBinding>,
  requestedSlot: string,
): { binding: ModelBinding; fallbackPath: string[]; resolvedSlot: string } {
  const fallbackPath = [requestedSlot];
  const visited = new Map<string, number>([[requestedSlot, 0]]);
  let resolvedSlot = requestedSlot;
  let binding = effective[resolvedSlot];

  while (binding && "fallback" in binding) {
    const source = resolvedSlot;
    resolvedSlot = binding.fallback;
    fallbackPath.push(resolvedSlot);
    if (!(resolvedSlot in effective)) {
      throw new Error(`Model slot fallback target does not exist: ${source} -> ${resolvedSlot}`);
    }
    const cycleStart = visited.get(resolvedSlot);
    if (cycleStart !== undefined) {
      throw new Error(`Model slot fallback cycle: ${fallbackPath.slice(cycleStart).join(" -> ")}`);
    }
    visited.set(resolvedSlot, fallbackPath.length - 1);
    binding = effective[resolvedSlot];
  }

  if (!binding || !("model" in binding)) {
    throw new Error(`Model slot does not resolve to a binding: ${requestedSlot}`);
  }
  return { binding, fallbackPath, resolvedSlot };
}

function parseBinding(slot: string, value: unknown): SlotBinding {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Invalid binding for model slot ${slot}: expected an object`);
  }
  const raw = value as Record<string, unknown>;
  const hasFallback = Object.hasOwn(raw, "fallback");
  const hasModel = Object.hasOwn(raw, "model");
  const hasThinking = Object.hasOwn(raw, "thinking");
  if (hasFallback && (hasModel || hasThinking)) {
    throw new Error(`Invalid binding for model slot ${slot}: choose fallback or model/thinking`);
  }

  const allowed = hasFallback ? new Set(["fallback"]) : new Set(["model", "thinking"]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) {
    throw new Error(`Unknown fields for model slot ${slot}: ${unknown.join(", ")}`);
  }

  if (hasFallback) {
    if (typeof raw.fallback !== "string") {
      throw new Error(`Invalid fallback for model slot ${slot}: expected a string`);
    }
    return Object.freeze({ fallback: raw.fallback });
  }
  if (!hasModel || !hasThinking) {
    throw new Error(`Invalid binding for model slot ${slot}: expected model and thinking`);
  }
  if (typeof raw.model !== "string") {
    throw new Error(`Invalid model for slot ${slot}: expected a string`);
  }
  if (typeof raw.thinking !== "string") {
    throw new Error(`Invalid thinking level for slot ${slot}: expected a string`);
  }
  return Object.freeze({ model: raw.model, thinking: raw.thinking as ThinkingLevel });
}

function validateEffectiveConfiguration(
  effective: Record<string, SlotBinding>,
  models?: ModelCatalog,
): void {
  for (const [slot, binding] of Object.entries(effective)) {
    if (!slotIdPattern.test(slot)) throw new Error(`Invalid model slot ID: ${slot}`);
    if ("fallback" in binding) {
      if (!slotIdPattern.test(binding.fallback)) {
        throw new Error(`Invalid fallback slot ID for slot ${slot}: ${binding.fallback}`);
      }
      continue;
    }
    if (!binding.model.trim()) throw new Error(`Missing model for slot ${slot}`);
    if (!thinkingLevelSet.has(binding.thinking)) {
      throw new Error(`Invalid thinking level for slot ${slot}: ${binding.thinking}`);
    }
    if (models) {
      const capabilities = models[binding.model];
      if (!capabilities) throw new Error(`Unknown model for slot ${slot}: ${binding.model}`);
      if (capabilities.thinkingLevels && !capabilities.thinkingLevels.includes(binding.thinking)) {
        throw new Error(
          `Thinking level ${binding.thinking} is not supported by model ${binding.model} for slot ${slot}`,
        );
      }
    }
  }
  for (const slot of Object.keys(effective).sort()) traceFallback(effective, slot);
}

export function createSlotRegistry(options: CreateSlotRegistryOptions): SlotRegistry {
  const rawEffective: Record<string, unknown> = {
    ...builtInFallbacks,
    ...options.global?.slots,
    ...options.project?.slots,
  };
  const missing = requiredSlots.filter((slot) => !(slot in rawEffective));
  if (missing.length > 0) {
    throw new Error(`Missing required model slots: ${missing.join(", ")}`);
  }
  const effective = Object.freeze(Object.fromEntries(
    Object.entries(rawEffective).map(([slot, binding]) => [slot, parseBinding(slot, binding)]),
  ));
  for (const slot of requiredSlots) {
    if ("fallback" in effective[slot]!) {
      throw new Error(`Required model slot must contain model and thinking: ${slot}`);
    }
  }
  validateEffectiveConfiguration(effective, options.models);

  const revision = createHash("sha256").update(normalizedJson(effective)).digest("hex");

  return Object.freeze({
    effective,
    revision,
    resolve(requestedSlot: string): ResolvedSlot {
      const { binding, fallbackPath, resolvedSlot } = traceFallback(effective, requestedSlot);
      return {
        requestedSlot,
        resolvedSlot,
        model: binding.model,
        thinking: binding.thinking,
        fallbackPath,
        revision,
      };
    },
  });
}
