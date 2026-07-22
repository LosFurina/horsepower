import type {
  CapabilityEvidenceCache,
  CapabilityEvidenceKey,
} from "../capabilities/evidence-cache.js";
import type { ThinkingLevel } from "../slots/registry.js";
import type { ModelCapabilityProbe } from "./model-capability-probe.js";
import type { CapabilityRejectionError } from "./capability-rejection.js";

const MAX_REMEDIATION_BYTES = 512;

export interface CapabilityGateSelection extends CapabilityEvidenceKey {}

export type WorkerCapabilityRejection = CapabilityRejectionError;

export class ModelCapabilityError extends Error {
  readonly code: "MODEL_CAPABILITY_UNVERIFIED" | "MODEL_CAPABILITY_REJECTED";
  readonly status: "unsupported" | "inconclusive";

  constructor(
    code: ModelCapabilityError["code"],
    status: ModelCapabilityError["status"],
    selection: CapabilityGateSelection,
    evidenceCode: string,
  ) {
    const action = status === "unsupported" ? "Choose a supported binding" : "Retry validation";
    const message = `${code}: ${selection.model} thinking=${selection.thinking} is ${status} (${evidenceCode.slice(0, 128)}). ${action} with horsepower setup --interactive.`;
    super(Buffer.from(message, "utf8").subarray(0, MAX_REMEDIATION_BYTES).toString("utf8"));
    this.name = "ModelCapabilityError";
    this.code = code;
    this.status = status;
  }
}

function rejection(value: unknown, thinking: ThinkingLevel): WorkerCapabilityRejection | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as Partial<WorkerCapabilityRejection>;
  if (candidate.kind !== "capability_rejection" || candidate.parameter !== "thinking") return undefined;
  const selectedRejected = candidate.rejectedValue === thinking;
  const authoritativeExclusion = candidate.acceptedValuesAuthoritative === true &&
    Array.isArray(candidate.acceptedValues) && !candidate.acceptedValues.includes(thinking);
  return selectedRejected || authoritativeExclusion ? candidate as WorkerCapabilityRejection : undefined;
}

export function createPreLaunchCapabilityGate(options: {
  cache: CapabilityEvidenceCache;
  probe: ModelCapabilityProbe;
}) {
  return {
    async ensure(selection: CapabilityGateSelection, declaredThinking?: readonly ThinkingLevel[]): Promise<void> {
      if (options.cache.get(selection)) return;
      options.cache.recordSupported(selection, {
        source: declaredThinking?.includes(selection.thinking) ? "declared" : "user-configured",
        code: declaredThinking?.includes(selection.thinking) ? "catalog_declared" : "user_configured",
      });
    },
    handleWorkerRejection(selection: CapabilityGateSelection, cause: unknown): ModelCapabilityError | undefined {
      const explicit = rejection(cause, selection.thinking);
      if (!explicit) return undefined;
      options.cache.invalidate(selection);
      return new ModelCapabilityError(
        "MODEL_CAPABILITY_REJECTED",
        "unsupported",
        selection,
        explicit.code ?? "capability_rejected",
      );
    },
  };
}

export type PreLaunchCapabilityGate = ReturnType<typeof createPreLaunchCapabilityGate>;
