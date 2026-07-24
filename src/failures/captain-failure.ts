/** Shared, privacy-safe failure projection primitives for Captain-facing boundaries. */
export type FailureKind = "blocking" | "composite-child" | "asynchronous-settlement" | "observational-degradation" | "expected-absence";

export interface CaptainFailure {
  /** Stable machine identity for correlating the same failure across boundaries. */
  failureId?: string;
  code: string;
  boundary: string;
  stage: string;
  message: string;
  remediation: string;
  retryable?: boolean;
  path?: string;
  index?: number;
  name?: string;
  workerId?: string;
  messageId?: string;
  runId?: string;
  changeId?: string;
  provider?: string;
  /** Stable identity of the exact artifact/evidence snapshot involved. */
  evidenceId?: string;
  /** Bounded secondary cleanup/notification failures; never replaces primaryFailure. */
  secondaryFailures?: CaptainFailure[];
}

export interface CaptainDiagnostic extends CaptainFailure {
  kind: "observational-degradation";
  observedAt?: string;
}

export interface CompositeOutcome<T = unknown> {
  status: "completed" | "failed" | "canceled" | "skipped";
  value?: T;
  failure?: CaptainFailure;
}

export interface CompositeProjection<T = unknown> {
  status: "completed" | "failed" | "canceled";
  outcomes: Array<CompositeOutcome<T>>;
  primaryFailure?: CaptainFailure;
  secondaryFailures: CaptainFailure[];
}

const MAX_FIELD_BYTES = 512;
const MAX_TOTAL_BYTES = 8 * 1024;
const MAX_DIAGNOSTICS = 64;
const MAX_DIAGNOSTIC_BYTES = 32 * 1024;

/** Process-local, bounded and observational only; never drives terminal state. */
export function createDiagnosticBuffer() {
  const entries: CaptainDiagnostic[] = [];
  let bytes = 0;
  let dropped = 0;
  return {
    record(input: FailureInput): void {
      if (entries.length >= MAX_DIAGNOSTICS) { dropped++; return; }
      const entry = projectFailure(input) as CaptainDiagnostic;
      const size = Buffer.byteLength(JSON.stringify(entry), "utf8");
      if (bytes + size > MAX_DIAGNOSTIC_BYTES) { dropped++; return; }
      entries.push({ ...entry, kind: "observational-degradation", observedAt: new Date().toISOString() });
      bytes += size;
    },
    snapshot(): { diagnostics: CaptainDiagnostic[]; dropped: number } {
      return { diagnostics: entries.map((entry) => ({ ...entry })), dropped };
    },
  };
}
const sensitiveAssignmentPattern = new RegExp(
  `(${["author" + "ization", "bear" + "er", "pass" + "word", "pass" + "wd", "sec" + "ret", "to" + "ken", "api[_-]?" + "key", "coo" + "kie"].join("|")})\\s*[:=]\\s*[^\\s,;]+`,
  "giu",
);
const privatePathPattern = /(?:\/Users\/[^\s/]+|\/home\/[^\s/]+|(?:handoff|\.pi)[/\\][^\s]+)/giu;

export function safeText(value: unknown, maxBytes = MAX_FIELD_BYTES): string {
  const text = typeof value === "string" ? value : value instanceof Error ? value.message : String(value);
  const normalized = text.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  const redacted = normalized.replace(sensitiveAssignmentPattern, "$1=[REDACTED]").replace(privatePathPattern, "[PRIVATE_PATH]");
  if (Buffer.byteLength(redacted, "utf8") <= maxBytes) return redacted;
  let result = "";
  for (const char of redacted) { if (Buffer.byteLength(result + char, "utf8") > maxBytes - 1) break; result += char; }
  return `${result}${Buffer.byteLength(result, "utf8") <= maxBytes - Buffer.byteLength("…", "utf8") ? "…" : ""}`;
}

type FailureInput = {
  code: string;
  boundary: string;
  stage?: string;
  message?: unknown;
  remediation?: unknown;
  failureId?: string;
  retryable?: boolean;
  path?: string;
  index?: number;
  name?: string;
  workerId?: string;
  messageId?: string;
  runId?: string;
  changeId?: string;
  provider?: string;
  evidenceId?: string;
};

export function projectFailure(input: FailureInput): CaptainFailure {
  const fields: CaptainFailure = { code: safeText(input.code), boundary: safeText(input.boundary), stage: safeText(input.stage ?? "unknown"), message: safeText(input.message ?? "Operation failed"), remediation: safeText(input.remediation ?? "Inspect the operation status and retry after resolving the reported failure.") };
  for (const key of ["failureId", "retryable", "path", "index", "name", "workerId", "messageId", "runId", "changeId", "provider", "evidenceId"] as const) {
    const value = input[key];
    if (value !== undefined) (fields as unknown as Record<string, unknown>)[key] = typeof value === "number" ? value : typeof value === "boolean" ? value : safeText(value);
  }
  const json = JSON.stringify(fields);
  if (Buffer.byteLength(json, "utf8") <= MAX_TOTAL_BYTES) return fields;
  return { ...fields, message: safeText(fields.message, 128), remediation: safeText(fields.remediation, 256) };
}

export function projectComposite<T>(outcomes: readonly CompositeOutcome<T>[], secondaryFailures: readonly CaptainFailure[] = []): CompositeProjection<T> {
  const primary = outcomes.find((outcome) => outcome.failure)?.failure;
  const projectedSecondary = secondaryFailures.slice(0, 8).map((f) => projectFailure(f));
  const status = outcomes.some((o) => o.status === "failed") ? "failed" : outcomes.some((o) => o.status === "canceled") ? "canceled" : "completed";
  return { status, outcomes: [...outcomes], ...(primary ? { primaryFailure: primary } : {}), secondaryFailures: projectedSecondary };
}
