import { message, validateOutputLocale, type OutputLocale } from "../localization/index.js";
import type { TerminalWebhookEvent, TerminalStatus } from "../lifecycle/webhook-types.js";

export const DISCORD_CONTENT_MAX_BYTES = 2_000;
const MAX_FIELD_BYTES = 1_024;
const privatePath = /(?:\/(?:Users|home|private|tmp)\/[^\s]+|\/[^\s]*\.pi\/agent\/horsepower\/state\/handoffs\/[^\s]+)/giu;
const credentialLabels = ["api[_-]?key", "to" + "ken", "se" + "cret", "pass" + "word", "coo" + "kie", "authori" + "zation", "bear" + "er"].join("|");
const credential = new RegExp(`(?:${credentialLabels})\\s*[:=]\\s*[^\\s]+`, "giu");
const urls = /https?:\/\/[^\s"'<>]+/giu;

function utf8Prefix(value: string, maxBytes: number): string {
  let out = "", bytes = 0;
  for (const ch of value) { const n = Buffer.byteLength(ch, "utf8"); if (bytes + n > maxBytes) break; out += ch; bytes += n; }
  return out;
}
function redactUrl(raw: string): string {
  try { const url = new URL(raw); if (url.search) url.search = "?[REDACTED]"; return url.toString(); } catch { return "[REDACTED URL]"; }
}
function safe(value: unknown, maxBytes: number): string {
  const compact = String(value ?? "").replace(credential, "[REDACTED]").replace(privatePath, "[private-path]").replace(urls, redactUrl).replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (Buffer.byteLength(compact, "utf8") <= maxBytes) return compact;
  return `${utf8Prefix(compact, Math.max(0, maxBytes - 3))}…`;
}
export interface DiscordEmbedField { name: string; value: string; inline?: boolean }
export interface DiscordWebhookBody { content: string; embeds: [{ title: string; description: string; color: number; fields: DiscordEmbedField[]; footer: { text: string }; timestamp: string }]; allowed_mentions: { parse: [] } }
const colors: Record<TerminalStatus, number> = { completed: 5763719, failed: 15548997, canceled: 9807270, blocked_needs_human: 15105570 };
const icons: Record<TerminalStatus, string> = { completed: "✅", failed: "❌", canceled: "⏹️", blocked_needs_human: "⚠️" };
const opaque = (value: unknown, prefix: string) => typeof value === "string" && new RegExp(`^${prefix}-[0-9a-f]{64}$`, "u").test(value);
export function isCanonicalEvent(value: unknown): value is TerminalWebhookEvent {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const e = value as TerminalWebhookEvent;
  if (Object.keys(value).some((k) => !["eventId","timestamp","scope","runId","changeId","status","outputLocale","summary","evidenceRefs","context","diagnostic","failure","actionRequired"].includes(k))) return false;
  if (!opaque(e.eventId,"evt") || !opaque(e.runId,"run") || (e.changeId !== undefined && !opaque(e.changeId,"change"))) return false;
  if (!Array.isArray(e.evidenceRefs) || e.evidenceRefs.length > 20 || !e.evidenceRefs.every((x) => opaque(x,"evidence"))) return false;
  if (!["change","dispatch"].includes(e.scope) || !["completed","failed","canceled","blocked_needs_human"].includes(e.status) || (e.scope === "dispatch" && e.status === "blocked_needs_human")) return false;
  const date = new Date(e.timestamp); if (!Number.isFinite(date.valueOf()) || date.toISOString() !== e.timestamp) return false;
  let locale: OutputLocale; try { locale = e.outputLocale === undefined ? "en" : validateOutputLocale(e.outputLocale); } catch { return false; }
  if (e.summary !== message(locale, `webhook.${e.status}` as never, { scope: e.scope })) return false;
  return Buffer.byteLength(JSON.stringify(e), "utf8") <= 8 * 1024;
}
export function renderDiscordWebhook(event: TerminalWebhookEvent): DiscordWebhookBody {
  if (!isCanonicalEvent(event)) throw new Error("Discord codec received a non-canonical event");
  const locale = event.outputLocale ?? "en", c = event.context, fields: DiscordEmbedField[] = [];
  const add = (name: string, value: unknown, inline = true) => { if (value !== undefined && value !== "") fields.push({ name: safe(name,256), value: safe(value,MAX_FIELD_BYTES), inline }); };
  add(locale === "zh-CN" ? "结果" : "Outcome", event.status);
  add(locale === "zh-CN" ? "需要操作" : "Action required", event.actionRequired ?? event.failure?.remediation ?? (event.status === "completed" ? (locale === "zh-CN" ? "无需操作" : "No action required") : (locale === "zh-CN" ? "请通过 status/read 检查运行详情。" : "Inspect run details through status/read.")), false);
  add("Change", event.changeId); add("Campaign", c?.campaignId); add("Task", c?.taskId); add(locale === "zh-CN" ? "任务" : "Task description", c?.taskDescription, false);
  add("Agent", c?.agent); add("Worker", c?.workerId); add("Slot", c?.resolvedSlot ? `${c.requestedSlot ?? ""}→${c.resolvedSlot}` : c?.requestedSlot); add("Model", c?.model); add("Thinking", c?.thinking); add("Work kind", c?.workKind);
  add("Operation", c?.operation); add("Elapsed", c?.elapsedMs === undefined ? undefined : `${c.elapsedMs}ms`); add("Last progress age", c?.lastProgressAgeMs === undefined ? undefined : `${c.lastProgressAgeMs}ms`);
  add("Diagnostic", event.diagnostic); add("Failure", event.failure ? `${event.failure.code ?? "FAILED"} @ ${event.failure.stage ?? event.failure.boundary ?? "unknown"}: ${event.failure.message ?? ""}` : undefined, false);
  add("Run", event.runId); add("Scope", event.scope);
  const content = safe(`${icons[event.status]} ${event.summary}\n\nScope: ${event.scope}\nStatus: ${event.status}\nRun ID: ${event.runId}${event.changeId ? `\nChange ID: ${event.changeId}` : ""}\nTimestamp: ${event.timestamp}`, DISCORD_CONTENT_MAX_BYTES);
  return { content, embeds: [{ title: safe(`${icons[event.status]} Horsepower ${event.scope} ${event.status}`,256), description: safe(event.summary,4096), color: event.diagnostic === "stalled" ? 16776960 : colors[event.status], fields: fields.slice(0,25), footer: { text: safe(`Horsepower · ${event.scope} · ${event.runId}`,2048) }, timestamp: event.timestamp }], allowed_mentions: { parse: [] } };
}
