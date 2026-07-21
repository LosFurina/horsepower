export interface CapabilityRejectionError extends Error {
  kind: "capability_rejection";
  parameter: "thinking";
  rejectedValue?: string;
  acceptedValues?: readonly string[];
  acceptedValuesAuthoritative?: boolean;
  code?: string;
}

export function capabilityRejectionError(value: unknown): CapabilityRejectionError | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.kind !== "capability_rejection" || raw.parameter !== "thinking") return undefined;
  const error = Object.assign(new Error("Model thinking capability rejected"), {
    kind: "capability_rejection" as const,
    parameter: "thinking" as const,
    ...(typeof raw.rejectedValue === "string" ? { rejectedValue: raw.rejectedValue } : {}),
    ...(Array.isArray(raw.acceptedValues) && raw.acceptedValues.every((item) => typeof item === "string")
      ? { acceptedValues: raw.acceptedValues as string[] } : {}),
    ...(raw.acceptedValuesAuthoritative === true ? { acceptedValuesAuthoritative: true } : {}),
    ...(typeof raw.code === "string" ? { code: raw.code.slice(0, 128) } : {}),
  });
  return error;
}
