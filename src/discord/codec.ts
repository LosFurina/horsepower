import { createHash } from "node:crypto";
import { message, validateOutputLocale, type OutputLocale } from "../localization/index.js";
import type { TerminalWebhookEvent } from "../lifecycle/webhook-types.js";

/**
 * Horsepower's conservative UTF-8 byte bound for Discord `content`.
 * Discord documents a 2,000-character limit; the stricter byte cap keeps the
 * provider projection bounded for every Unicode shape.
 */
export const DISCORD_CONTENT_MAX_BYTES = 2_000;

/**
 * Omission markers used when content exceeds the Discord limit.
 */
const omissionMarkers: Record<OutputLocale, string> = {
  en: " […]",
  "zh-CN": " …",
};

/**
 * Canonical Discord incoming webhook request body.
 */
export interface DiscordWebhookBody {
  content: string;
  allowed_mentions: { parse: [] };
}

/**
 * Check whether a terminal event originates from a privacy-safe normalized source.
 *
 * This function enforces the canonical privacy boundary: it returns `true` only
 * for events that have been through `normalizeEvent`. Raw identifiers, prompts,
 * reports, command output, credentials, private paths, or unbounded evidence
 * are rejected.
 */
export function isCanonicalEvent(value: unknown): value is TerminalWebhookEvent {
  if (value === null || Array.isArray(value) || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;

  // Must have exactly the canonical fields and nothing else
  const allowed = new Set([
    "eventId", "timestamp", "scope", "runId", "changeId", "status",
    "outputLocale", "summary", "evidenceRefs",
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return false;

  // Type checks matching normalizeEvent behavior
  if (typeof raw.eventId !== "string" || typeof raw.timestamp !== "string" ||
      typeof raw.runId !== "string" || typeof raw.summary !== "string" ||
      (raw.changeId !== undefined && typeof raw.changeId !== "string") ||
      !Array.isArray(raw.evidenceRefs) || !raw.evidenceRefs.every((item) => typeof item === "string")) {
    return false;
  }

  // All identifiers must follow opaque hash format
  const opaquePrefixes = ["evt-", "run-", "change-", "evidence-"];
  const hexPattern = /^[0-9a-f]{64}$/u;
  if (!raw.eventId.startsWith("evt-") || !hexPattern.test(raw.eventId.slice(4))) return false;
  if (!raw.runId.startsWith("run-") || !hexPattern.test(raw.runId.slice(4))) return false;
  if (raw.changeId !== undefined && (!raw.changeId.startsWith("change-") || !hexPattern.test(raw.changeId.slice(7)))) {
    return false;
  }
  if (!raw.evidenceRefs.every((ref: string) => ref.startsWith("evidence-") && hexPattern.test(ref.slice(9)))) {
    return false;
  }

  // Scope, status, timestamp, and canonical field bounds mirror normalization.
  if (raw.scope !== "change" && raw.scope !== "dispatch") return false;
  if (raw.status !== "completed" && raw.status !== "blocked_needs_human" &&
      raw.status !== "failed" && raw.status !== "canceled") return false;
  if (raw.scope === "dispatch" && raw.status === "blocked_needs_human") return false;
  const timestamp = new Date(raw.timestamp);
  if (!Number.isFinite(timestamp.valueOf()) || timestamp.toISOString() !== raw.timestamp) return false;
  if (raw.eventId.length > 1_024 || raw.runId.length > 1_024 ||
      (raw.changeId?.length ?? 0) > 1_024 || raw.summary.length > 500 ||
      raw.evidenceRefs.length > 20 || raw.evidenceRefs.some((item: string) => item.length > 2_048)) return false;

  // outputLocale must be valid
  try {
    validateOutputLocale(raw.outputLocale ?? "en");
  } catch {
    return false;
  }

  // Summary must be a localized message, not raw text
  const locale: OutputLocale = raw.outputLocale === undefined ? "en" : validateOutputLocale(raw.outputLocale);
  const expectedSummary = message(locale, `webhook.${raw.status}` as "webhook.completed" | "webhook.blocked_needs_human" | "webhook.failed" | "webhook.canceled", { scope: raw.scope });
  if (raw.summary !== expectedSummary) return false;

  // Byte bound check (same as normalizeEvent)
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > 8 * 1024) return false;

  return true;
}

/**
 * Render a canonical terminal event into a Discord incoming webhook request body.
 *
 * The adapter:
 * - Receives only the normalized canonical event
 * - Builds a non-empty bounded `content` field
 * - Disables all parsed mentions
 * - Truncates safely on a UTF-8 boundary if content exceeds Discord's limit
 * - Uses a localized omission marker
 * - Never emits raw identifiers, credentials, prompts, reports, private paths,
 *   or unbounded evidence
 *
 * @throws {Error} if the event is not a valid canonical event
 */
export function renderDiscordWebhook(event: TerminalWebhookEvent): DiscordWebhookBody {
  if (!isCanonicalEvent(event)) {
    throw new Error("Discord codec received a non-canonical event");
  }

  const locale = event.outputLocale ?? "en";
  const summary = event.summary;

  // Build stable machine-readable fields for operators
  const scope = event.scope;
  const status = event.status;
  const runId = event.runId;
  const changeId = event.changeId;
  const timestamp = event.timestamp;

  // Build content: localized summary + stable machine fields
  let content: string;
  if (locale === "zh-CN") {
    const parts: string[] = [];
    parts.push(summary);
    parts.push("");
    parts.push(`范围：${scope}`);
    parts.push(`状态：${status}`);
    parts.push(`运行 ID：${runId}`);
    if (changeId) parts.push(`变更 ID：${changeId}`);
    parts.push(`时间：${timestamp}`);
    content = parts.join("\n");
  } else {
    const parts: string[] = [];
    parts.push(summary);
    parts.push("");
    parts.push(`Scope: ${scope}`);
    parts.push(`Status: ${status}`);
    parts.push(`Run ID: ${runId}`);
    if (changeId) parts.push(`Change ID: ${changeId}`);
    parts.push(`Timestamp: ${timestamp}`);
    content = parts.join("\n");
  }

  // Truncate safely on UTF-8 boundary if content exceeds Discord's limit
  const omission = omissionMarkers[locale];
  const maxBytes = DISCORD_CONTENT_MAX_BYTES;
  if (Buffer.byteLength(content, "utf8") > maxBytes) {
    // Binary search for the longest valid prefix that fits with the omission marker
    const omissionBytes = Buffer.byteLength(omission, "utf8");
    const targetBytes = maxBytes - omissionBytes;
    let low = 0;
    let high = content.length;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const slice = content.slice(0, mid);
      if (Buffer.byteLength(slice, "utf8") <= targetBytes) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    // Avoid ending on the leading half of a surrogate pair.
    if (best > 0 && /[\uD800-\uDBFF]/u.test(content[best - 1]!)) best -= 1;
    content = content.slice(0, best) + omission;
  }

  return {
    content,
    allowed_mentions: { parse: [] },
  };
}
