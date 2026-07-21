import type { ThinkingLevel } from "../slots/registry.js";

export interface CapabilityProbeSelection {
  model: string;
  thinking: ThinkingLevel;
}

export interface CapabilityProbeRequest extends CapabilityProbeSelection {
  signal?: AbortSignal;
}

export type CapabilityFailureCategory =
  | "authentication"
  | "authorization"
  | "quota"
  | "rate-limit"
  | "timeout"
  | "transport"
  | "service"
  | "malformed-response"
  | "unknown";

export type CapabilityProbeObservation =
  | { kind: "success"; code?: string }
  | {
      kind: "capability-rejection";
      code?: string;
      rejectedValue?: string;
      acceptedValues?: readonly string[];
      acceptedValuesAuthoritative?: boolean;
    }
  | { kind: "failure"; category: CapabilityFailureCategory; code?: string; message?: string };

export interface CapabilityProbeEvidence {
  code: string;
  detail?: string;
}

export type CapabilityProbeResult =
  | { status: "supported"; evidence: CapabilityProbeEvidence }
  | { status: "unsupported"; evidence: CapabilityProbeEvidence }
  | { status: "inconclusive"; evidence: CapabilityProbeEvidence };

export interface ModelCapabilityProbe {
  probe(request: CapabilityProbeRequest): Promise<CapabilityProbeResult>;
}

export function classifyCapabilityProbe(
  selection: CapabilityProbeSelection,
  observation: CapabilityProbeObservation,
): CapabilityProbeResult {
  if (observation.kind === "success") {
    return { status: "supported", evidence: { code: observation.code ?? "completed" } };
  }
  if (observation.kind === "capability-rejection") {
    const selectedRejected = observation.rejectedValue === selection.thinking;
    const authoritativeExclusion = observation.acceptedValuesAuthoritative === true &&
      observation.acceptedValues !== undefined &&
      !observation.acceptedValues.includes(selection.thinking);
    if (selectedRejected || authoritativeExclusion) {
      return { status: "unsupported", evidence: { code: observation.code ?? "capability_rejected" } };
    }
  }
  return {
    status: "inconclusive",
    evidence: { code: observation.kind === "failure" ? observation.code ?? observation.category : observation.code ?? "unverified_rejection" },
  };
}

export function runCapabilityProbe(
  probe: ModelCapabilityProbe,
  request: CapabilityProbeRequest,
): Promise<CapabilityProbeResult> {
  return probe.probe(request);
}
