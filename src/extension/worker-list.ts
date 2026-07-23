import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { OutputLocale } from "../localization/index.js";
import type { ThinkingLevel } from "../slots/registry.js";
import type { ProgressTelemetry } from "../runtime/progress-telemetry.js";
import type { WorkerStatus } from "../runtime/persistent-manager.js";

export const WORKER_LIST_ENTRY_TYPE = "horsepower-worker-list";
export const MAX_WORKERS = 8;
export const MAX_FIELD_BYTES = 256;
export const MAX_SUMMARY_BYTES = 512;
export const MAX_ENTRY_BYTES = 50 * 1_024;
export const MAX_AGGREGATE_JSON_BYTES = 32 * 1_024;

export type WorkerListScope = "persistent-create-only";

export interface WorkerListTelemetry {
  elapsedMs: number;
  usage?: { input?: number; output?: number };
  latestAssistantSummary?: string;
}

export interface WorkerListItem {
  workerId: string;
  name: string;
  agent: string;
  role?: string;
  modelSlot: string;
  resolvedSlot?: string;
  model: string;
  thinking: ThinkingLevel;
  status: WorkerStatus;
  handoffMode?: "managed" | "inline";
  activeMessageId?: string;
  queuedMessageCount: number;
  telemetry?: WorkerListTelemetry;
}

export interface WorkerListPresentation {
  locale: OutputLocale;
  observedAt: number;
  scope: WorkerListScope;
  workers: WorkerListItem[];
}

export interface WorkerListSource {
  workerId: string;
  name: string;
  agent: string;
  role?: string;
  modelSlot: string;
  resolvedSlot?: string;
  model: string;
  thinking: ThinkingLevel;
  status: WorkerStatus;
  handoffMode?: "managed" | "inline";
  activeMessageId?: string;
  queuedMessageIds?: readonly string[];
  telemetry?: ProgressTelemetry;
}

export interface WorkerListLabels {
  title: string;
  scope: string;
  empty: string;
  workers: string;
  status: string;
  message: string;
  queue: string;
  elapsed: string;
  input: string;
  output: string;
  latest: string;
  observed: string;
  none: string;
  listFailed: string;
  appendFailed: string;
  renderFailed: string;
  tuiUnavailable: string;
}

/** Minimal Component-compatible renderer output without importing nested pi-tui. */
export class WorkerListView {
  #lines: string[];

  constructor(lines: string[]) {
    this.#lines = lines;
  }

  invalidate(): void {
    /* pure snapshot */
  }

  render(width: number): string[] {
    const safeWidth = Number.isFinite(width) ? Math.max(1, Math.floor(width)) : 1;
    return this.#lines.flatMap((line) => line ? wrapTextWithAnsi(line, safeWidth) : [""]);
  }
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

/** Final defense for accidental display secrets and private paths in list projection. */
export function safeField(value: string, maxBytes = MAX_FIELD_BYTES): string {
  const compact = value
    .replace(/(?:token|password|secret|authorization|api[_-]?key|cookie|bearer)\s*[:=]\s*\S+/giu, "[redacted]")
    .replace(/\bbearer\s+\S+/giu, "[redacted]")
    .replace(/\/(?:Users|home|private|tmp|var|etc)\/[^\s]*/gu, "[private-path]")
    .replace(/[A-Z]:\\[^\s]*/gu, "[private-path]")
    .replace(/\/[^\s]*\.pi\/agent\/horsepower\/state\/handoffs\/[^\s]*/gu, "[private-path]")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!compact) return "";
  if (Buffer.byteLength(compact, "utf8") <= maxBytes) return compact;
  return `${utf8Prefix(compact, Math.max(0, maxBytes - 3))}…`;
}

function optionalField(value: string | undefined, maxBytes = MAX_FIELD_BYTES): string | undefined {
  if (value === undefined) return undefined;
  const next = safeField(value, maxBytes);
  return next || undefined;
}

function projectTelemetry(telemetry: ProgressTelemetry | undefined): WorkerListTelemetry | undefined {
  if (!telemetry) return undefined;
  const elapsedMs = Number.isFinite(telemetry.elapsedMs) ? Math.max(0, telemetry.elapsedMs) : 0;
  const usage = telemetry.usage;
  const input = usage && typeof usage.input === "number" && Number.isSafeInteger(usage.input) && usage.input >= 0
    ? usage.input : undefined;
  const output = usage && typeof usage.output === "number" && Number.isSafeInteger(usage.output) && usage.output >= 0
    ? usage.output : undefined;
  const latest = telemetry.latestAssistantSummary === undefined
    ? undefined
    : optionalField(telemetry.latestAssistantSummary, MAX_SUMMARY_BYTES);
  return {
    elapsedMs,
    ...(input !== undefined || output !== undefined
      ? { usage: { ...(input === undefined ? {} : { input }), ...(output === undefined ? {} : { output }) } }
      : {}),
    ...(latest === undefined ? {} : { latestAssistantSummary: latest }),
  };
}

export function workerListLabels(locale: OutputLocale): WorkerListLabels {
  if (locale === "zh-CN") {
    return {
      title: "Horsepower 持久 worker",
      scope: "仅列出当前 Pi 进程中由 create 创建的持久 worker。已完成的 single、parallel、chain 一次性子进程不会出现在此列表。",
      empty: "当前没有持久 worker。空列表不表示未发生 single、parallel 或 chain 一次性执行。",
      workers: "worker",
      status: "状态",
      message: "消息",
      queue: "队列",
      elapsed: "耗时",
      input: "输入令牌",
      output: "输出令牌",
      latest: "最新",
      observed: "观察时间",
      none: "无",
      listFailed: "无法列出持久 worker。worker 状态未更改。请重试 /horsepower-workers，或运行 horsepower doctor。",
      appendFailed: "无法写入持久的 worker 列表结果。worker 状态未更改。请重试 /horsepower-workers。",
      renderFailed: "无法渲染 worker 列表快照。worker 状态未更改。",
      tuiUnavailable: "已记录持久 worker 列表快照，但当前为非交互 RPC 模式，TUI renderer 不可用。请通过 get_entries 查看 horsepower-worker-list，或使用 horsepower_subagent action=list。",
    };
  }
  return {
    title: "Horsepower persistent workers",
    scope: "Lists only current process-lifetime workers created by create. Completed single, parallel, and chain one-shot children are not included.",
    empty: "No persistent workers are present. An empty list does not imply that no single, parallel, or chain one-shot execution occurred.",
    workers: "workers",
    status: "status",
    message: "message",
    queue: "queue",
    elapsed: "elapsed",
    input: "input tokens",
    output: "output tokens",
    latest: "latest",
    observed: "observed",
    none: "none",
    listFailed: "Failed to list persistent workers. Workers were left unchanged. Retry /horsepower-workers or run horsepower doctor.",
    appendFailed: "Failed to record durable worker-list output. Workers were left unchanged. Retry /horsepower-workers.",
    renderFailed: "Failed to render the worker-list snapshot. Workers were left unchanged.",
    tuiUnavailable: "The persistent-worker snapshot was recorded, but the TUI renderer is unavailable in non-interactive RPC mode. Inspect horsepower-worker-list through get_entries or use horsepower_subagent action=list.",
  };
}

export function projectWorkerList(
  workers: readonly WorkerListSource[],
  options: { locale: OutputLocale; observedAt?: number },
): WorkerListPresentation {
  const ordered = [...workers]
    .slice(0, MAX_WORKERS)
    .map((worker): WorkerListItem => {
      const role = optionalField(worker.role);
      const resolvedSlot = optionalField(worker.resolvedSlot);
      const handoffMode = worker.handoffMode === "managed" || worker.handoffMode === "inline" ? worker.handoffMode : undefined;
      const activeMessageId = optionalField(worker.activeMessageId);
      const telemetry = projectTelemetry(worker.telemetry);
      return {
        workerId: safeField(worker.workerId),
        name: safeField(worker.name),
        agent: safeField(worker.agent),
        modelSlot: safeField(worker.modelSlot),
        model: safeField(worker.model),
        thinking: worker.thinking,
        status: worker.status,
        queuedMessageCount: Array.isArray(worker.queuedMessageIds) ? Math.max(0, worker.queuedMessageIds.length) : 0,
        ...(role === undefined ? {} : { role }),
        ...(resolvedSlot === undefined ? {} : { resolvedSlot }),
        ...(handoffMode === undefined ? {} : { handoffMode }),
        ...(activeMessageId === undefined ? {} : { activeMessageId }),
        ...(telemetry === undefined ? {} : { telemetry }),
      };
    });

  const presentation: WorkerListPresentation = {
    locale: options.locale === "zh-CN" ? "zh-CN" : "en",
    observedAt: options.observedAt ?? Date.now(),
    scope: "persistent-create-only",
    workers: ordered,
  };

  while (
    presentation.workers.length > 0
    && Buffer.byteLength(JSON.stringify(presentation), "utf8") > MAX_AGGREGATE_JSON_BYTES
  ) {
    presentation.workers = presentation.workers.slice(0, -1);
  }
  return presentation;
}

function workerHeading(worker: WorkerListItem): string {
  const slot = worker.resolvedSlot ? `${worker.modelSlot}→${worker.resolvedSlot}` : worker.modelSlot;
  const role = worker.role ? ` (${worker.role})` : "";
  const handoff = worker.handoffMode ? ` · ${worker.handoffMode}` : "";
  return `${worker.name} · ${worker.agent}${role} · ${slot} · ${worker.model} · thinking=${worker.thinking}${handoff} · id=${worker.workerId}`;
}

export function formatWorkerListText(presentation: WorkerListPresentation, expanded = false): string {
  const labels = workerListLabels(presentation.locale);
  const lines = [
    labels.title,
    labels.scope,
    `${labels.observed}: ${new Date(presentation.observedAt).toISOString()}`,
    `${labels.workers}: ${presentation.workers.length}`,
  ];
  if (!presentation.workers.length) {
    lines.push("", labels.empty);
  } else {
    for (const worker of presentation.workers) {
      lines.push("", workerHeading(worker));
      lines.push(`${labels.status}: ${worker.status}`);
      if (worker.activeMessageId) lines.push(`${labels.message}: ${worker.activeMessageId}`);
      lines.push(`${labels.queue}: ${worker.queuedMessageCount}`);
      if (expanded && worker.telemetry) {
        lines.push(`${labels.elapsed}: ${worker.telemetry.elapsedMs}ms`);
        if (worker.telemetry.usage?.input !== undefined) lines.push(`${labels.input}: ${worker.telemetry.usage.input}`);
        if (worker.telemetry.usage?.output !== undefined) lines.push(`${labels.output}: ${worker.telemetry.usage.output}`);
        if (worker.telemetry.latestAssistantSummary !== undefined) lines.push(`${labels.latest}: ${worker.telemetry.latestAssistantSummary}`);
      } else if (!expanded && worker.telemetry) {
        lines.push(`${labels.elapsed}: ${worker.telemetry.elapsedMs}ms`);
      }
    }
  }
  return utf8Prefix(lines.join("\n"), MAX_ENTRY_BYTES);
}

export function renderWorkerListEntry(
  entry: { data?: WorkerListPresentation },
  options: { expanded: boolean },
  theme: { fg(color: string, text: string): string; bg?(color: string, text: string): string; bold?(text: string): string },
): WorkerListView {
  try {
    const presentation = entry.data ?? {
      locale: "en" as const,
      observedAt: Date.now(),
      scope: "persistent-create-only" as const,
      workers: [],
    };
    const labels = workerListLabels(presentation.locale);
    const accent = (text: string) => theme.fg("accent", theme.bold ? theme.bold(text) : text);
    const dim = (text: string) => theme.fg("dim", text);
    const text = (value: string) => theme.fg("text", value);
    const warn = (value: string) => theme.fg("warning", value);
    const title = (value: string) => theme.fg("toolTitle", value);
    const lines = [
      accent(labels.title),
      dim(labels.scope),
      dim(`${labels.observed}: ${new Date(presentation.observedAt).toISOString()}`),
      text(`${labels.workers}: ${presentation.workers.length}`),
    ];
    if (!presentation.workers.length) {
      lines.push("", warn(labels.empty));
    } else {
      for (const worker of presentation.workers) {
        lines.push("", title(workerHeading(worker)));
        lines.push(text(`${labels.status}: ${worker.status}`));
        if (worker.activeMessageId) lines.push(dim(`${labels.message}: ${worker.activeMessageId}`));
        lines.push(dim(`${labels.queue}: ${worker.queuedMessageCount}`));
        if (options.expanded && worker.telemetry) {
          lines.push(dim(`${labels.elapsed}: ${worker.telemetry.elapsedMs}ms`));
          if (worker.telemetry.usage?.input !== undefined) lines.push(dim(`${labels.input}: ${worker.telemetry.usage.input}`));
          if (worker.telemetry.usage?.output !== undefined) lines.push(dim(`${labels.output}: ${worker.telemetry.usage.output}`));
          if (worker.telemetry.latestAssistantSummary !== undefined) lines.push(dim(`${labels.latest}: ${worker.telemetry.latestAssistantSummary}`));
        } else if (!options.expanded && worker.telemetry) {
          lines.push(dim(`${labels.elapsed}: ${worker.telemetry.elapsedMs}ms`));
        }
      }
    }
    return new WorkerListView(utf8Prefix(lines.join("\n"), MAX_ENTRY_BYTES).split("\n"));
  } catch {
    return new WorkerListView([workerListLabels("en").renderFailed]);
  }
}

export function isWorkerListSourceArray(value: unknown): value is WorkerListSource[] {
  return Array.isArray(value);
}
