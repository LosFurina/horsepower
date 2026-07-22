export interface CapabilityRejectionError extends Error {
  kind: "capability_rejection";
  parameter: "thinking";
  rejectedValue?: string;
  acceptedValues?: readonly string[];
  acceptedValuesAuthoritative?: boolean;
  code?: string;
}

export function capabilityRejectionError(value: unknown): CapabilityRejectionError | undefined {
  const message = typeof value === "string" ? value : value instanceof Error ? value.message : undefined;
  const unsupported = message?.slice(0, 4_096).match(/Unsupported value:\s*'([^']+)'[\s\S]*?not supported[\s\S]*?Supported values are:\s*([^\r\n}]*)/iu);
  if (unsupported) {
    const acceptedValues = [...unsupported[2]!.matchAll(/'([^']+)'/gu)].map((match) => match[1]!);
    return Object.assign(new Error("Model thinking capability rejected"), {
      kind: "capability_rejection" as const,
      parameter: "thinking" as const,
      rejectedValue: unsupported[1]!, acceptedValues, acceptedValuesAuthoritative: true,
      code: "unsupported_value",
    });
  }
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
