import type { OutputLocale } from "../localization/index.js";
import type { OneShotProgress, WorkerIdentity } from "../runtime/one-shot.js";
import type { CaptainFailure } from "../failures/captain-failure.js";

const MAX_CHILDREN = 8;
const MAX_FIELD_BYTES = 256;
const MAX_SUMMARY_BYTES = 512;
const MAX_CARD_BYTES = 50 * 1_024;
/** After this interval without substantive assistant/tool progress, the card reports a soft stall. */
export const WORKER_PROGRESS_STALL_THRESHOLD_MS = 30_000;

type ParallelEvent = OneShotProgress & { identity: WorkerIdentity };
type ChildStatus = "pending" | "running" | "completed" | "failed" | "canceled";

interface ChildSnapshot {
  identity: WorkerIdentity;
  operation: string;
  status: ChildStatus;
  telemetry?: { elapsedMs: number; usage?: { input?: number; output?: number }; latestAssistantSummary?: string };
  lastSubstantiveProgressAt?: number;
  diagnostic?: { code: "WORKER_PROGRESS_STALLED"; message: string };
  summary?: string;
  failure?: Pick<CaptainFailure, "code" | "stage" | "remediation">;
  target?: string;
  terminal: boolean;
}

export interface ParallelCardDetails {
  dispatchStatus: "running" | "completed" | "failed" | "canceled";
  parallel: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    canceled: number;
    children: ChildSnapshot[];
  };
}

export interface ParallelCardResult {
  content: Array<{ type: "text"; text: string }>;
  details: ParallelCardDetails;
}

function utf8Prefix(value: string, maxBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

/** Progress is normalized upstream; this is a final defense for accidental display secrets and paths. */
function safe(value: string, maxBytes = MAX_FIELD_BYTES): string {
  const compact = value
    .replace(/(?:token|password|secret|authorization)\s*[:=]\s*\S+/giu, "[redacted]")
    .replace(/\/(?:Users|home|private|tmp)\/[^\s]*/gu, "[private-path]")
    .replace(/\/[^\s]*\.pi\/agent\/horsepower\/state\/handoffs\/[^\s]*/gu, "[private-path]")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (Buffer.byteLength(compact, "utf8") <= maxBytes) return compact;
  return `${utf8Prefix(compact, Math.max(0, maxBytes - 3))}…`;
}

function boundedIdentity(identity: WorkerIdentity): WorkerIdentity {
  return Object.freeze({
    name: safe(identity.name), agent: safe(identity.agent), role: safe(identity.role),
    requestedSlot: safe(identity.requestedSlot), resolvedSlot: safe(identity.resolvedSlot), model: safe(identity.model),
    thinking: identity.thinking, handoffMode: identity.handoffMode, invocationId: safe(identity.invocationId),
    ...(identity.runId ? { runId: safe(identity.runId) } : {}),
  });
}

function sameIdentity(left: WorkerIdentity, right: WorkerIdentity, authoritativeInvocationId: string): boolean {
  const rightRunId = right.runId ? safe(right.runId) : undefined;
  return left.name === safe(right.name) && left.agent === safe(right.agent) && left.role === safe(right.role)
    && left.requestedSlot === safe(right.requestedSlot) && left.resolvedSlot === safe(right.resolvedSlot)
    && left.model === safe(right.model) && left.thinking === right.thinking && left.handoffMode === right.handoffMode
    && right.invocationId === authoritativeInvocationId && (left.runId === undefined || left.runId === rightRunId);
}

function operation(event: OneShotProgress): string {
  if (event.type === "tool_start" || event.type === "tool_update" || event.type === "tool_end") return safe(event.operation);
  return event.type;
}

function status(event: OneShotProgress): ChildStatus {
  if (event.type === "accepted") return "pending";
  if (event.type === "completed" || event.type === "failed" || event.type === "canceled") return event.type;
  return "running";
}

function telemetry(event: OneShotProgress): ChildSnapshot["telemetry"] {
  if (!event.telemetry) return undefined;
  const usage = event.telemetry.usage;
  return {
    elapsedMs: Math.max(0, event.telemetry.elapsedMs),
    ...(usage && (usage.input !== undefined || usage.output !== undefined) ? { usage: {
      ...(usage.input === undefined ? {} : { input: usage.input }),
      ...(usage.output === undefined ? {} : { output: usage.output }),
    } } : {}),
    ...(event.telemetry.latestAssistantSummary === undefined ? {} : { latestAssistantSummary: safe(event.telemetry.latestAssistantSummary, MAX_SUMMARY_BYTES) }),
  };
}

function deepCopy(details: ParallelCardDetails): ParallelCardDetails {
  return structuredClone(details);
}

export function createParallelCardProjection(locale: OutputLocale) {
  const order: string[] = [];
  const children = new Map<string, ChildSnapshot>();

  function reduce(event: ParallelEvent): boolean {
    const key = event.identity.invocationId;
    const current = children.get(key);
    if (!current) {
      if (event.type !== "accepted" || !key || order.length >= MAX_CHILDREN) return false;
      const initialTelemetry = telemetry(event);
      children.set(key, { identity: boundedIdentity(event.identity), operation: "accepted", status: "pending", ...(initialTelemetry ? { telemetry: initialTelemetry } : {}), terminal: false });
      order.push(key);
      return true;
    }
    if (!sameIdentity(current.identity, event.identity, key) || event.type === "accepted" || current.terminal) return false;
    const nextStatus = status(event);
    const identity = current.identity.runId === undefined && event.identity.runId
      ? boundedIdentity(event.identity)
      : current.identity;
    const substantive = event.type !== "starting";
    const progressAt = substantive ? (event.telemetry?.elapsedMs ?? current.lastSubstantiveProgressAt ?? 0) : current.lastSubstantiveProgressAt;
    const elapsed = event.telemetry?.elapsedMs ?? 0;
    const stalled = !nextStatus.match(/completed|failed|canceled/u) && progressAt !== undefined && elapsed - progressAt >= WORKER_PROGRESS_STALL_THRESHOLD_MS;
    children.set(key, {
      identity,
      operation: operation(event),
      status: nextStatus,
      ...(progressAt === undefined ? {} : { lastSubstantiveProgressAt: progressAt }),
      ...(stalled ? { diagnostic: { code: "WORKER_PROGRESS_STALLED", message: `No substantive worker progress for ${WORKER_PROGRESS_STALL_THRESHOLD_MS}ms; dispatch remains running.` } } : substantive ? {} : current.diagnostic ? { diagnostic: current.diagnostic } : {}),
      ...(telemetry(event) ?? current.telemetry ? { telemetry: telemetry(event) ?? current.telemetry } : {}),
      ...("summary" in event ? { summary: safe(event.summary, MAX_SUMMARY_BYTES) } : {}),
      ...(event.type === "failed" ? { failure: { code: "DISPATCH_FAILED", stage: safe(event.stage), remediation: "Inspect the dispatch result and retry after resolving the reported stage." } } : {}),
      ...("target" in event && event.target ? { target: safe(event.target) } : {}),
      terminal: nextStatus === "completed" || nextStatus === "failed" || nextStatus === "canceled",
    });
    return true;
  }

  function snapshot(): ParallelCardResult {
    const list = order.map((key) => children.get(key)!);
    const count = (value: ChildStatus) => list.filter((child) => child.status === value).length;
    const dispatchStatus = list.some((child) => !child.terminal) ? "running" : list.some((child) => child.status === "failed") ? "failed" : list.some((child) => child.status === "canceled") ? "canceled" : "completed";
    const details: ParallelCardDetails = { dispatchStatus, parallel: {
      total: list.length, pending: count("pending"), running: count("running"), completed: count("completed"), failed: count("failed"), canceled: count("canceled"),
      children: list,
    } };
    const p = details.parallel;
    const labels = locale === "zh-CN"
      ? { parent: "并行", total: "总数", pending: "等待", running: "运行", completed: "完成", failed: "失败", canceled: "取消", operation: "操作", status: "状态", elapsed: "耗时", input: "输入令牌", output: "输出令牌", latest: "最新" }
      : { parent: "Parallel", total: "total", pending: "pending", running: "running", completed: "completed", failed: "failed", canceled: "canceled", operation: "operation", status: "status", elapsed: "elapsed", input: "input tokens", output: "output tokens", latest: "latest" };
    const humanStatus = (value: ChildStatus) => locale === "zh-CN"
      ? ({ pending: "等待", running: "运行", completed: "完成", failed: "失败", canceled: "取消" } as const)[value]
      : value;
    const lines = [`${labels.parent}: ${labels.total}=${p.total} ${labels.pending}=${p.pending} ${labels.running}=${p.running} ${labels.completed}=${p.completed} ${labels.failed}=${p.failed} ${labels.canceled}=${p.canceled}`];
    for (const child of list) {
      const id = child.identity;
      lines.push("", `${id.name} · ${id.agent} (${id.role}) · ${id.requestedSlot}→${id.resolvedSlot} · ${id.model} · thinking=${id.thinking} · ${id.handoffMode} · invocation=${id.invocationId}${id.runId ? ` · run=${id.runId}` : ""}`);
      lines.push(`${labels.operation}: ${child.operation}`, `${labels.status}: ${humanStatus(child.status)}`);
      if (child.target) lines.push(`target: ${child.target}`);
      if (child.summary) lines.push(`summary: ${child.summary}`);
      if (child.diagnostic) lines.push(`diagnostic: ${child.diagnostic.code} — ${child.diagnostic.message}`);
      if (child.failure) lines.push(`failure: ${child.failure.code} @ ${child.failure.stage} — ${child.failure.remediation}`);
      if (child.telemetry) {
        lines.push(`${labels.elapsed}: ${child.telemetry.elapsedMs}ms`);
        if (child.telemetry.usage?.input !== undefined) lines.push(`${labels.input}: ${child.telemetry.usage.input}`);
        if (child.telemetry.usage?.output !== undefined) lines.push(`${labels.output}: ${child.telemetry.usage.output}`);
        if (child.telemetry.latestAssistantSummary !== undefined) lines.push(`${labels.latest}: ${child.telemetry.latestAssistantSummary}`);
      }
    }
    const text = utf8Prefix(lines.join("\n"), MAX_CARD_BYTES);
    return { content: [{ type: "text", text }], details: deepCopy(details) };
  }

  return { reduce, snapshot };
}
