import type { OutputLocale } from "../localization/index.js";
import type { OneShotProgress, WorkerIdentity } from "../runtime/one-shot.js";
import type { CaptainFailure } from "../failures/captain-failure.js";
import type { WorkerSummary } from "../runtime/persistent-manager.js";

export const MAX_WORKER_CARDS = 8;
const MAX_BYTES = 50 * 1024;
const MAX_FIELD_BYTES = 256;

export type WorkerCardStatus = "pending" | "running" | "completed" | "failed" | "canceled" | "idle" | "destroying";
export interface WorkerCardModel {
  workerId: string;
  name: string;
  agent: string;
  role?: string;
  requestedSlot: string;
  resolvedSlot?: string;
  model: string;
  thinking: string;
  status: WorkerCardStatus;
  operation?: string;
  summary?: string;
  target?: string;
  elapsedMs?: number;
  usage?: { input?: number; output?: number };
  latestAssistantSummary?: string;
  nextPollAt?: number;
  lastProgressAt?: number;
  stallState?: "none" | "stalled";
  failure?: Pick<CaptainFailure, "code" | "stage" | "message">;
  invocationKind: "one-shot" | "persistent";
  handoffMode?: string;
  runId?: string;
}

function safe(value: unknown): string {
  const text = String(value ?? "").replace(/(?:token|password|secret|authorization)\s*[:=]\s*\S+/giu, "[redacted]").replace(/(?:\/Users|\/home|\/private|\/tmp)\/[^\s]*/gu, "[private-path]").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (Buffer.byteLength(text, "utf8") <= MAX_FIELD_BYTES) return text;
  return `${text.slice(0, MAX_FIELD_BYTES - 1)}…`;
}

export function modelFromOneShot(event: OneShotProgress & { identity: WorkerIdentity }): WorkerCardModel {
  const i = event.identity;
  const terminal = event.type === "completed" || event.type === "failed" || event.type === "canceled";
  return { workerId: safe(i.invocationId), runId: safe(i.runId), name: safe(i.name), agent: safe(i.agent), role: safe(i.role), requestedSlot: safe(i.requestedSlot), resolvedSlot: safe(i.resolvedSlot), model: safe(i.model), thinking: i.thinking, status: event.type === "accepted" ? "pending" : terminal ? event.type : "running", operation: "operation" in event ? safe(event.operation) : event.type, ...("summary" in event ? { summary: safe(event.summary) } : {}), ...("target" in event && event.target ? { target: safe(event.target) } : {}), ...(event.telemetry ? { elapsedMs: event.telemetry.elapsedMs, ...(event.telemetry.usage ? { usage: event.telemetry.usage } : {}), ...(event.telemetry.latestAssistantSummary ? { latestAssistantSummary: safe(event.telemetry.latestAssistantSummary) } : {}) } : {}), invocationKind: "one-shot", handoffMode: i.handoffMode };
}

export function modelFromPersistent(worker: WorkerSummary): WorkerCardModel {
  return { workerId: safe(worker.workerId), name: safe(worker.name), agent: safe(worker.agent), ...(worker.role ? { role: safe(worker.role) } : {}), requestedSlot: safe(worker.modelSlot), ...(worker.resolvedSlot ? { resolvedSlot: safe(worker.resolvedSlot) } : {}), model: safe(worker.model), thinking: worker.thinking, status: worker.status as WorkerCardStatus, ...(worker.telemetry?.elapsedMs !== undefined ? { elapsedMs: worker.telemetry.elapsedMs } : {}), ...(worker.telemetry?.usage ? { usage: worker.telemetry.usage } : {}), ...(worker.telemetry?.latestAssistantSummary ? { summary: safe(worker.telemetry.latestAssistantSummary) } : {}), ...(worker.observation?.nextPollAt !== undefined ? { nextPollAt: worker.observation.nextPollAt } : {}), ...(worker.observation?.lastProgressAt !== undefined ? { lastProgressAt: worker.observation.lastProgressAt } : {}), ...(worker.observation?.stallState ? { stallState: worker.observation.stallState } : {}), ...(worker.failure ? { failure: { code: safe(worker.failure.code), stage: safe(worker.failure.stage), message: safe(worker.failure.message) } } : {}), invocationKind: "persistent", ...(worker.handoffMode ? { handoffMode: worker.handoffMode } : {}), ...(worker.handoffRunId ? { runId: safe(worker.handoffRunId) } : {}) };
}

export function workerCardLines(card: WorkerCardModel, locale: OutputLocale = "en"): string[] {
  const status = locale === "zh-CN" ? "状态" : "status";
  return [
    `${card.name} · ${card.agent}${card.role ? ` (${card.role})` : ""} · ${card.requestedSlot}${card.resolvedSlot ? `→${card.resolvedSlot}` : ""} · ${card.model} · thinking=${card.thinking} · ${status}=${card.status}`,
    ...(card.operation ? [`operation: ${card.operation}`] : []),
    ...(card.target ? [`target: ${card.target}`] : []),
    ...(card.summary ? [`summary: ${card.summary}`] : []),
    `invocation: ${card.workerId}`,
    ...(card.runId ? [`run: ${card.runId}`] : []),
    ...(card.elapsedMs !== undefined ? [`elapsed: ${Math.max(0, card.elapsedMs)}ms`] : []),
    ...(card.nextPollAt !== undefined ? [`next poll: ${card.nextPollAt}`] : []),
    ...(card.lastProgressAt !== undefined ? [`last progress: ${card.lastProgressAt}`] : []),
    ...(card.stallState ? [`stall: ${card.stallState}`] : []),
    ...(card.failure ? [`failure: ${card.failure.code} @ ${card.failure.stage} — ${card.failure.message}`] : []),
  ];
}

export function renderWorkerCards(cards: readonly WorkerCardModel[], locale: OutputLocale = "en"): { content: Array<{ type: "text"; text: string }>; details: { workers: WorkerCardModel[] } } {
  const labels = locale === "zh-CN" ? ["工作者", "状态", "模型"] : ["Workers", "status", "model"];
  const lines = [`${labels[0]}: ${cards.length}`];
  for (const card of cards.slice(0, MAX_WORKER_CARDS)) {
    lines.push("", `${card.name} · ${card.agent}${card.role ? ` (${card.role})` : ""} · ${card.requestedSlot}${card.resolvedSlot ? `→${card.resolvedSlot}` : ""} · ${card.model} · thinking=${card.thinking} · ${labels[1]}=${card.status}`);
    if (card.operation) lines.push(`operation: ${card.operation}`);
    if (card.target) lines.push(`target: ${card.target}`);
    if (card.summary) lines.push(`summary: ${card.summary}`);
    lines.push(`handoff: ${card.handoffMode ?? ""}`);
    lines.push(`invocation: ${card.workerId}`);
    if (card.runId) lines.push(`run: ${card.runId}`);
    if (card.elapsedMs !== undefined) lines.push(`elapsed: ${Math.max(0, card.elapsedMs)}ms`);
    if (card.usage) lines.push(`usage: ${card.usage.input}/${card.usage.output}`);
    if (card.latestAssistantSummary) lines.push(`latest: ${card.latestAssistantSummary}`);
  }
  const text = Buffer.byteLength(lines.join("\n"), "utf8") <= MAX_BYTES ? lines.join("\n") : lines.join("\n").slice(0, MAX_BYTES);
  return { content: [{ type: "text", text }], details: { workers: structuredClone(cards.slice(0, MAX_WORKER_CARDS)) } };
}
