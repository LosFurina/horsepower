export interface ProgressUsage { input?: number; output?: number }
export interface ProgressTelemetry { elapsedMs: number; usage?: ProgressUsage; latestAssistantSummary?: string }

export const DEFAULT_ASSISTANT_SUMMARY_BYTES = 500;

function safeCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function addProgressUsage(total: ProgressUsage, next: ProgressUsage): ProgressUsage {
  const result: ProgressUsage = {};
  for (const key of ["input", "output"] as const) {
    const value = safeCount(next[key]);
    if (value !== undefined || total[key] !== undefined) {
      const sum = (total[key] ?? 0) + (value ?? 0);
      if (Number.isSafeInteger(sum)) result[key] = sum;
    }
  }
  return result;
}

export function normalizeAssistantSummary(value: unknown, maxBytes = DEFAULT_ASSISTANT_SUMMARY_BYTES): string | undefined {
  if (typeof value !== "string") return undefined;
  let text = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!text) return undefined;
  if (/(?:api[_-]?key|token|secret|password|cookie|authorization)\s*[:=]|\bbearer\s+\S+/iu.test(text)) return "[REDACTED]";
  text = text.replace(/(?:\/(?:Users|home|private|var|tmp|etc)\/[^\s]+|[A-Z]:\\[^\s]+)/gu, "[private-path]");
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  while (end > 0) {
    const lead = bytes[end - 1]!;
    if ((lead & 0x80) === 0) break;
    if ((lead & 0xc0) === 0x80) { end--; continue; }
    const width = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
    if (end - 1 + width > maxBytes) end--;
    break;
  }
  return new TextDecoder().decode(bytes.subarray(0, end));
}

export function telemetrySnapshot(startedAt: number, now: () => number, usage: ProgressUsage, latestAssistantSummary?: string): ProgressTelemetry {
  const current = now();
  const elapsedMs = Math.max(0, Number.isFinite(current) ? current - startedAt : 0);
  return {
    elapsedMs,
    ...(Object.keys(usage).length ? { usage: { ...usage } } : {}),
    ...(latestAssistantSummary ? { latestAssistantSummary } : {}),
  };
}
