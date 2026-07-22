import type { JsonObject, JsonWrite } from "../config/json-store.js";
import type { PiModelCatalog } from "../capabilities/model-catalog.js";
import type { CapabilityProbeResult, ModelCapabilityProbe } from "../runtime/model-capability-probe.js";
import { createSlotRegistry, thinkingLevels, type ModelBinding, type ModelCatalog, type SlotConfiguration, type ThinkingLevel } from "../slots/registry.js";

export const requiredSetupSlots = ["judgment", "craft", "utility"] as const;
export type RequiredSetupSlot = typeof requiredSetupSlots[number];
export type SetupAction = "retry" | "reselect" | "skip" | "cancel";

export interface SetupTerminal {
  showModels(modelIds: readonly string[]): void | Promise<void>;
  chooseModel(request: { slot: RequiredSetupSlot; modelIds: readonly string[] }): Promise<string | undefined>;
  chooseThinking(request: { slot: RequiredSetupSlot; model: string; thinkingLevels: readonly ThinkingLevel[] }): Promise<ThinkingLevel | undefined>;
  chooseProbeAction(request: {
    slot: RequiredSetupSlot;
    selection: ModelBinding;
    result: Exclude<CapabilityProbeResult, { status: "supported" }>;
  }): Promise<SetupAction | undefined>;
}

export interface SetupValidation {
  slot: RequiredSetupSlot;
  model: string;
  thinking: ThinkingLevel;
  status: CapabilityProbeResult["status"];
  evidenceCode: string;
}

export type SetupResult = {
  status: "configured";
  catalogRevision: string;
  revision: string;
  validations: SetupValidation[];
  effective: Readonly<Record<string, unknown>>;
} | {
  status: "skipped" | "canceled";
  catalogRevision: string;
};

export class SetupFailure extends Error {
  constructor(
    readonly code: "MODEL_CATALOG_UNAVAILABLE" | "MODEL_CAPABILITY_UNSUPPORTED" | "MODEL_CAPABILITY_INCONCLUSIVE" | "SETUP_CANCELED" | "SETUP_COMMIT_FAILED",
    readonly fields: Readonly<Record<string, unknown>>,
    message: string,
  ) {
    super(message);
  }
}

export interface SetupTransactionOptions {
  catalog: PiModelCatalog | undefined;
  probe: ModelCapabilityProbe | undefined;
  prevalidated?: readonly SetupValidation[];
  forceLiveProbe?: boolean;
  currentGlobal: JsonObject;
  project: SlotConfiguration;
  settings: JsonObject;
  modelSlotsPath: string;
  settingsPath: string;
  write(entries: readonly JsonWrite[]): Promise<void>;
}

function catalogOrThrow(catalog: PiModelCatalog | undefined): Extract<PiModelCatalog, { status: "available" }> {
  if (!catalog || catalog.status === "unavailable") {
    const reason = catalog?.reason ?? "registry-error";
    throw new SetupFailure("MODEL_CATALOG_UNAVAILABLE", { status: "inconclusive", reason }, `Model catalog unavailable: ${reason}`);
  }
  return catalog;
}

function validateSelection(catalog: Extract<PiModelCatalog, { status: "available" }>, slot: RequiredSetupSlot, selection: ModelBinding): void {
  if (!catalog.models[selection.model]) {
    throw new SetupFailure("MODEL_CAPABILITY_INCONCLUSIVE", {
      status: "inconclusive", slot, model: selection.model, thinking: selection.thinking, evidenceCode: "unknown_model",
    }, `Unknown model for slot ${slot}: ${selection.model}`);
  }
  if (!thinkingLevels.includes(selection.thinking)) {
    throw new SetupFailure("MODEL_CAPABILITY_INCONCLUSIVE", {
      status: "inconclusive", slot, model: selection.model, thinking: selection.thinking, evidenceCode: "invalid_thinking",
    }, `Invalid thinking level for slot ${slot}: ${selection.thinking}`);
  }
}

async function verify(
  catalog: Extract<PiModelCatalog, { status: "available" }>,
  _probe: ModelCapabilityProbe | undefined,
  slot: RequiredSetupSlot,
  selection: ModelBinding,
  _forceLiveProbe = false,
): Promise<SetupValidation> {
  validateSelection(catalog, slot, selection);
  const declared = catalog.models[selection.model]?.thinkingLevels;
  const result: CapabilityProbeResult = declared !== undefined && !declared.includes(selection.thinking)
    ? { status: "unsupported", evidence: { code: "declared_exact_exclusion" } }
    : { status: "supported", evidence: { code: declared?.includes(selection.thinking) ? "declared_exact_support" : "user_configured" } };
  return { slot, ...selection, status: result.status, evidenceCode: result.evidence.code };
}

function failure(validation: SetupValidation): SetupFailure {
  if (validation.status === "inconclusive" && validation.evidenceCode === "aborted") {
    return new SetupFailure("SETUP_CANCELED", { ...validation, status: "canceled" }, `${validation.model} capability validation was canceled`);
  }
  const code = validation.status === "unsupported" ? "MODEL_CAPABILITY_UNSUPPORTED" : "MODEL_CAPABILITY_INCONCLUSIVE";
  return new SetupFailure(code, { ...validation }, `${validation.model} with thinking ${validation.thinking} is ${validation.status}`);
}

export async function commitSetup(
  options: SetupTransactionOptions,
  selections: Readonly<Record<RequiredSetupSlot, ModelBinding>>,
): Promise<SetupResult> {
  const catalog = catalogOrThrow(options.catalog);
  const existingValidations = new Map(options.prevalidated?.map((validation) => [validation.slot, validation]));
  const validations = await Promise.all(requiredSetupSlots.map((slot) => {
    const validation = existingValidations.get(slot);
    const selection = selections[slot];
    return validation?.status === "supported" && validation.model === selection.model && validation.thinking === selection.thinking
      ? validation
      : verify(catalog, options.probe, slot, selection, options.forceLiveProbe);
  }));
  const rejected = validations.find(({ status }) => status !== "supported");
  if (rejected) throw failure(rejected);

  const existingSlots = options.currentGlobal.slots !== null && typeof options.currentGlobal.slots === "object" && !Array.isArray(options.currentGlobal.slots)
    ? options.currentGlobal.slots as Record<string, unknown> : {};
  const nextGlobal = { ...options.currentGlobal, slots: { ...existingSlots, ...selections } };
  const registry = createSlotRegistry({ global: nextGlobal as SlotConfiguration, project: options.project, models: catalog.models as ModelCatalog });
  try {
    await options.write([
      { path: options.modelSlotsPath, value: nextGlobal },
      { path: options.settingsPath, value: options.settings },
    ]);
  } catch (cause) {
    throw new SetupFailure("SETUP_COMMIT_FAILED", { status: "write-failed" }, cause instanceof Error ? cause.message : "Configuration commit failed");
  }
  return {
    status: "configured",
    catalogRevision: catalog.revision,
    revision: registry.revision,
    validations,
    effective: registry.effective,
  };
}

export async function collectGuidedSetup(
  catalogValue: PiModelCatalog | undefined,
  probe: ModelCapabilityProbe | undefined,
  terminal: SetupTerminal,
): Promise<{ status: "selected"; selections: Record<RequiredSetupSlot, ModelBinding>; validations: SetupValidation[] } | { status: "skipped" | "canceled"; catalogRevision: string }> {
  const catalog = catalogOrThrow(catalogValue);
  await terminal.showModels(catalog.modelIds);
  const selections = {} as Record<RequiredSetupSlot, ModelBinding>;
  const validations: SetupValidation[] = [];
  for (const slot of requiredSetupSlots) {
    let selected = false;
    while (!selected) {
      const model = await terminal.chooseModel({ slot, modelIds: catalog.modelIds });
      if (!model) return { status: "canceled", catalogRevision: catalog.revision };
      const thinking = await terminal.chooseThinking({ slot, model, thinkingLevels });
      if (!thinking) return { status: "canceled", catalogRevision: catalog.revision };
      const selection = { model, thinking };
      validateSelection(catalog, slot, selection);
      const validation = await verify(catalog, probe, slot, selection);
      if (validation.status !== "supported") throw failure(validation);
      selections[slot] = selection;
      validations.push(validation);
      selected = true;
    }
  }
  return { status: "selected", selections, validations };
}
