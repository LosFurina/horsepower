import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { resolveHorsepowerPaths } from "../config/paths.js";
import { parseWebhookSettings } from "../config/webhook.js";
import { horsepowerSubagentSchema } from "../orchestration/schema.js";
import { message, resolveOutputLocale, type OutputLocale } from "../localization/index.js";
import { acquireGlobalRuntime, type RuntimeLease } from "../runtime/global-runtime.js";
import type { OneShotProgress, WorkerIdentity } from "../runtime/one-shot.js";
import { deliverSettlementNotice } from "../runtime/settlement-delivery.js";
import type { CreateHorsepowerRuntimeOptions, HorsepowerRuntime, HorsepowerRuntimeContext } from "./runtime.js";
import { createHorsepowerRuntime } from "./runtime.js";
import { createParallelCardProjection } from "./parallel-card.js";
import { modelFromOneShot, modelFromPersistent, workerCardLines, type WorkerCardModel } from "./worker-card.js";
import {
  WORKER_LIST_ENTRY_TYPE,
  formatWorkerListText,
  isWorkerListSourceArray,
  projectWorkerList,
  renderWorkerListEntry,
  workerListLabels,
  type WorkerListPresentation,
} from "./worker-list.js";

interface CampaignCandidate {
  changeId: string;
  completedTasks: number;
  totalTasks: number;
}

interface CampaignInventory {
  changeId: string;
  projectRoot: string;
  digest: string;
  sections: Array<{ id: string; title: string; tasks: Array<{ id: string; description: string; status: "pending" | "complete"; sectionId: string; checks?: string[] }> }>;
}

interface CampaignContinuationIdentity {
  campaignId: string;
  projectId: string;
  changeId: string;
  selectedTaskIds: string[];
  mode: "multi_agent" | "main_agent";
  generation: number;
  disposition?: "active" | "paused" | "blocked" | "terminal" | "superseded";
}

interface ExtensionRuntime {
  execute(input: unknown, context: HorsepowerRuntimeContext): Promise<unknown>;
  clearCampaignContinuation?(): void;
  pauseCampaignContinuation?(projectId: string): CampaignContinuationIdentity | undefined;
  currentCampaignContinuation?(projectId: string): CampaignContinuationIdentity | undefined;
  prepareCampaignContinuation?(input: { campaignId: string; projectId: string; generation?: number }): Promise<CampaignContinuationIdentity | undefined>;
  discoverImplementationChanges?(input: { projectId: string }): Promise<CampaignCandidate[]>;
  loadImplementationTaskInventory?(input: { changeId: string; projectId: string }): Promise<CampaignInventory>;
  beginImplementationCampaign?(input: {
    changeId: string; projectId: string; selectedTaskIds: string[];
    selectedTasks: Array<{ id: string; description: string; status: "pending"; sectionId: string; checks?: string[] }>;
    inventoryDigest: string; mode: "multi_agent" | "main_agent"; testingPrompt: string; pollIntervalSeconds?: number;
  } | { changeId: string; projectId: string; taskScopes: string[]; mode: "multi_agent" | "main_agent" }): Promise<unknown>;
  authorizeImplementationReviewer?(input: { campaignId: string; projectId: string; reviewCampaignId: string; acceptanceScope: string; budget: number }): Promise<unknown>;
}


const CAMPAIGN_UI_CHUNK_BYTES = 40 * 1024;
function notifyChunks(ui: { notify(message: string, level?: "info" | "warning" | "error"): void }, heading: string, lines: readonly string[]): void {
  let chunk = heading;
  for (const line of lines) {
    if (Buffer.byteLength(`${chunk}\n${line}`, "utf8") > CAMPAIGN_UI_CHUNK_BYTES) {
      ui.notify(chunk, "info");
      chunk = line;
    } else chunk += `\n${line}`;
  }
  if (chunk) ui.notify(chunk, "info");
}

interface ExtensionLease {
  value: ExtensionRuntime;
  cleanup(): Promise<void>;
  abandon(): void;
}

export interface HorsepowerExtensionDependencies {
  acquireRuntime(ctx?: ExtensionContext): ExtensionLease;
  resolveOutputLocale?: (cwd: string) => Promise<OutputLocale>;
}

const MAX_CONTENT_BYTES = 50 * 1024;
const MAX_CONTENT_LINES = 2_000;
const OMISSION_NOTICE = "[Horsepower output omitted: exceeded 50 KiB or 2,000 lines]";

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

function boundedContent(value: string): string {
  let lineBreaks = 0;
  let lineBoundary = value.length;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 10) continue;
    lineBreaks += 1;
    if (lineBreaks === MAX_CONTENT_LINES - 1) {
      lineBoundary = index;
      break;
    }
  }
  const lineTruncated = lineBoundary < value.length;
  const byteTruncated = Buffer.byteLength(value, "utf8") > MAX_CONTENT_BYTES;
  if (!lineTruncated && !byteTruncated) return value;

  const prefix = lineTruncated ? value.slice(0, lineBoundary) : value;
  const suffix = `\n${OMISSION_NOTICE}`;
  return utf8Prefix(prefix, MAX_CONTENT_BYTES - Buffer.byteLength(suffix, "utf8")) + suffix;
}

function textResult(result: unknown) {
  const serialized = JSON.stringify(result, undefined, 2) ?? String(result);
  return {
    content: [{ type: "text" as const, text: boundedContent(serialized) }],
    details: result,
  };
}

interface StructuredFailure {
  status: "failed";
  action: string;
  failure: {
    code: string;
    boundary: string;
    message: string;
    remediation: string;
  };
}

function structuredFailure(action: string, cause: unknown): StructuredFailure {
  const failureMessage = cause instanceof Error ? cause.message : String(cause);
  const typed = cause !== null && typeof cause === "object" && "horsepowerFailure" in cause
    ? (cause as { horsepowerFailure?: unknown }).horsepowerFailure : undefined;
  const stableCode = /^([A-Z][A-Z0-9_]+):/u.exec(failureMessage)?.[1];
  const classified = typed !== null && typeof typed === "object"
    && typeof (typed as { code?: unknown }).code === "string"
    && typeof (typed as { boundary?: unknown }).boundary === "string"
    && typeof (typed as { remediation?: unknown }).remediation === "string"
    ? typed as { code: string; boundary: string; remediation: string }
    : stableCode?.startsWith("VERIFICATION_")
      ? { code: stableCode, boundary: "verification", remediation: "Submit fresh Captain-observed claim-matched evidence using the current verification manifest." }
      : stableCode?.startsWith("REVIEW_")
        ? { code: stableCode, boundary: "review_campaign", remediation: "Inspect the current campaign and finding states, then make an explicit Captain decision." }
        : { code: "DISPATCH_FAILED", boundary: "dispatch", remediation: "Run horsepower doctor --json and retry after resolving the reported failure." };
  return { status: "failed", action, failure: { ...classified, message: failureMessage } };
}

function safeTitlePart(value: string, limit = 120): string {
  const compact = value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

function workerTitle(identity: WorkerIdentity): string {
  return [
    safeTitlePart(identity.name),
    `${safeTitlePart(identity.agent)} (${safeTitlePart(identity.role)})`,
    `${safeTitlePart(identity.requestedSlot)}→${safeTitlePart(identity.resolvedSlot)}`,
    safeTitlePart(identity.model),
    `thinking=${identity.thinking}`,
    identity.handoffMode,
    `invocation=${safeTitlePart(identity.invocationId, 80)}`,
    ...(identity.runId ? [`run=${safeTitlePart(identity.runId, 80)}`] : []),
  ].join(" · ");
}

function progressResult(event: OneShotProgress & { identity: WorkerIdentity }) {
  let body: string;
  const telemetry = "telemetry" in event ? event.telemetry : undefined;
  const telemetryLines = telemetry ? [
    `elapsed: ${Math.max(0, telemetry.elapsedMs)}ms`,
    ...(telemetry.usage?.input === undefined ? [] : [`input tokens: ${telemetry.usage.input}`]),
    ...(telemetry.usage?.output === undefined ? [] : [`output tokens: ${telemetry.usage.output}`]),
    ...(telemetry.latestAssistantSummary === undefined ? [] : [`latest: ${telemetry.latestAssistantSummary}`]),
  ] : [];
  if (event.type === "tool_start" || event.type === "tool_update" || event.type === "tool_end") {
    const status = event.type === "tool_end" ? (event.isError ? "failed" : "completed") : event.type === "tool_start" ? "started" : "running";
    body = [
      `operation: ${event.operation}`,
      ...(event.target ? [`target: ${event.target}`] : []),
      `status: ${status}`,
      ...telemetryLines,
    ].join("\n");
  } else if (event.type === "assistant") {
    body = [`operation: assistant`, `summary: ${event.summary}`, `status: completed`, ...telemetryLines].join("\n");
  } else {
    body = [`operation: ${event.type}`, ...("summary" in event ? [`summary: ${event.summary}`] : []), `status: ${event.type}`, ...telemetryLines].join("\n");
  }
  return {
    content: [{ type: "text" as const, text: boundedContent(`${workerTitle(event.identity)}\n${body}`) }],
    details: { progress: event, title: workerTitle(event.identity) },
  };
}

function runtimeContext(
  ctx: ExtensionContext,
  signal?: AbortSignal,
  onProgress?: (event: OneShotProgress & { identity: WorkerIdentity }) => void,
): HorsepowerRuntimeContext {
  return { captain: true, cwd: ctx.cwd, modelRegistry: ctx.modelRegistry, ...(signal ? { signal } : {}), ...(onProgress ? { onProgress } : {}) };
}

export function registerHorsepowerExtension(
  pi: ExtensionAPI,
  dependencies: HorsepowerExtensionDependencies,
): void {
  let lease: ExtensionLease | undefined;
  let cleanup: Promise<void> | undefined;
  let sessionGeneration = 0;
  let sessionProject = "";
  const runtime = (ctx: ExtensionContext) => (lease ??= dependencies.acquireRuntime(ctx)).value;
  const deliveryOwner = () => ({ cwd: sessionProject, generation: sessionGeneration });

  let compactionSerial = 0;
  // One process-local arm per successful automatic compaction generation.
  // Official Pi contract: arm only on session_compact with a saved entry and
  // willRetry=false; enqueue at most once after agent_settled when idle with no
  // pending steering/follow-up. Pi native overflow retry owns willRetry=true.
  let compactGeneration: { serial: number; reason: "threshold" | "overflow"; campaignId: string; projectId: string; handled: boolean } | undefined;
  const oneShotCards = new Map<string, WorkerCardModel>();
  const clearCompactGeneration = () => { compactGeneration = undefined; };
  pi.on("session_start", (_event, ctx) => {
    lease ??= dependencies.acquireRuntime(ctx);
    // Keep the process-global runtime's delivery target aligned with Pi's
    // current session; the callback rechecks this owner immediately before send.
    sessionProject = ctx.cwd;
    sessionGeneration += 1;
    clearCompactGeneration();
  });
  pi.on("session_before_compact", (event) => {
    // A new compaction attempt supersedes any prior arm. Manual /compact never
    // auto-continues; failed/aborted attempts never emit a successful compact.
    void event;
    clearCompactGeneration();
  });
  pi.on("session_compact", (event, ctx) => {
    const e = event as { reason?: "manual" | "threshold" | "overflow"; willRetry?: boolean; compactionEntry?: unknown };
    if (e.reason === "manual" || e.willRetry === true) {
      clearCompactGeneration();
      return;
    }
    if (e.reason !== "threshold" && e.reason !== "overflow") {
      clearCompactGeneration();
      return;
    }
    // Defensive: official SessionCompactEvent always carries compactionEntry, but
    // missing success evidence must never authorize continuation.
    if (e.compactionEntry === undefined || e.compactionEntry === null) {
      clearCompactGeneration();
      return;
    }
    // Compaction hooks can be the first event that needs the runtime (the
    // session may not have emitted session_start in embedded/test hosts).
    const active = (lease ??= dependencies.acquireRuntime(ctx)).value;
    if (!active.prepareCampaignContinuation) return;
    // Defer until agent_settled: Pi may still enqueue native or user work.
    const projectId = ctx.cwd;
    const candidate = active.currentCampaignContinuation?.(projectId);
    if (!candidate || (candidate.disposition !== undefined && candidate.disposition !== "active")) return;
    compactGeneration = { serial: ++compactionSerial, reason: e.reason, campaignId: candidate.campaignId, projectId, handled: false };
  });
  pi.on("agent_start", () => {
    // Agent lifecycle remains observable through the live context checks used by
    // settlement delivery; no message is sent while this turn is active.
    // Any turn that starts before Horsepower delivers its follow-up has won the
    // continuation race. A settlement context is a snapshot and cannot reveal
    // this later start, so invalidate the arm explicitly at the lifecycle edge.
    clearCompactGeneration();
  });
  pi.on("agent_settled", (_event, ctx) => {
    const pending = compactGeneration;
    if (!pending || pending.handled) return;
    if (ctx.cwd !== pending.projectId) {
      pending.handled = true;
      return;
    }
    // User/Pi/extension work that wins the settlement boundary owns continuation
    // for this generation. Consume the arm rather than retrying after that work.
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
      pending.handled = true;
      return;
    }
    const active = lease?.value;
    const prepare = active?.prepareCampaignContinuation;
    if (!prepare) return;
    pending.handled = true;
    void (async () => {
      const locale = dependencies.resolveOutputLocale ? await dependencies.resolveOutputLocale(pending.projectId).catch(() => "en" as const) : "en";
      // Any newer compaction attempt or session replacement invalidates this
      // in-flight closure before it may mint or deliver continuation authority.
      if (compactGeneration !== pending) return;
      // The runtime owns authorization and returns a bounded identity only.
      const result = await prepare({ campaignId: pending.campaignId, projectId: pending.projectId, generation: pending.serial });
      // Revalidation is asynchronous. Re-check the exact arm, project, idle,
      // and pending-message arbitration immediately before delivery so a switch,
      // user follow-up, or new active turn during I/O always takes precedence.
      if (compactGeneration !== pending || ctx.cwd !== pending.projectId || !ctx.isIdle() || ctx.hasPendingMessages()) return;
      if (!result) {
        // Eligible arm existed, but lease/OpenSpec revalidation failed closed.
        try { ctx.ui.notify(message(locale, "campaign.continuationStopped", { campaignId: pending.campaignId }), "info"); } catch { /* observational */ }
        return;
      }
      // Allowlisted private payload only: stable campaign identity + guidance.
      // Never copy compaction summaries, prompts, credentials, or private paths.
      const details = {
        campaignId: result.campaignId,
        changeId: result.changeId,
        selectedTaskIds: [...result.selectedTaskIds],
        mode: result.mode,
      };
      const content = message(locale, "campaign.continuationQueued", {
        campaignId: details.campaignId,
        changeId: details.changeId,
        taskIds: details.selectedTaskIds.join(","),
        mode: details.mode,
      });
      pi.sendMessage({
        customType: "horsepower-campaign-continuation",
        content,
        display: false,
        details,
      }, { deliverAs: "followUp", triggerTurn: true });
      try { ctx.ui.notify(message(locale, "campaign.continuationNotice", { campaignId: details.campaignId, changeId: details.changeId }), "info"); } catch { /* observational */ }
    })().catch(() => { /* fail closed without side effects */ });
  });

  pi.registerTool({
    name: "horsepower_subagent",
    label: "Horsepower Subagent",
    description: "Explicitly run or manage Horsepower one-shot and persistent workers.",
    parameters: horsepowerSubagentSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = { ...(params as Record<string, unknown>), cwd: ctx.cwd };
      const action = String((params as Record<string, unknown>).action ?? "operation");
      let outputLocale: "en" | "zh-CN" = "en";
      if (action === "parallel" && dependencies.resolveOutputLocale) {
        try { outputLocale = await dependencies.resolveOutputLocale(ctx.cwd); }
        catch { /* parallel delivery falls back to English */ }
      }
      const parallelCard = action === "parallel" ? createParallelCardProjection(outputLocale) : undefined;
      const progress = (event: OneShotProgress & { identity: WorkerIdentity }) => {
        if (action === "single" || action === "parallel" || action === "chain") {
          oneShotCards.set(event.identity.invocationId, modelFromOneShot(event));
        }
        if (parallelCard) {
          try {
            if (parallelCard.reduce(event) && onUpdate) onUpdate(parallelCard.snapshot());
          } catch { /* projection and rendering are observational */ }
        } else if (onUpdate) {
          try { onUpdate(progressResult(event)); } catch { /* rendering is observational */ }
        }
      };
      let data: unknown;
      try {
        data = await runtime(ctx).execute(input, runtimeContext(ctx, signal, action === "single" || action === "parallel" || action === "chain" ? progress : undefined));
      } catch (cause) {
        data = structuredFailure(action, cause);
      }
      if (parallelCard) {
        try {
          const snapshot = parallelCard.snapshot();
          return { content: snapshot.content, details: { data, ...snapshot.details } };
        } catch { return textResult(data); }
      }
      if (action === "single" || action === "chain" || action === "parallel") {
        for (const key of [...oneShotCards.keys()]) oneShotCards.delete(key);
      }
      if (!dependencies.resolveOutputLocale) return textResult(data);
      try { outputLocale = await dependencies.resolveOutputLocale(ctx.cwd); }
      catch { /* terminal delivery falls back to English */ }
      const status = data !== null && typeof data === "object" && "status" in data ? String((data as { status: unknown }).status) : "completed";
      const failureCode = data !== null && typeof data === "object" && "failure" in data && (data as { failure?: unknown }).failure !== null && typeof (data as { failure?: unknown }).failure === "object"
        ? String(((data as { failure: { code?: unknown } }).failure.code) ?? "") : "";
      const id = failureCode === "VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED" ? "error.verificationMigration"
        : failureCode.startsWith("VERIFICATION_") ? "error.verification"
          : failureCode.startsWith("REVIEW_") ? "error.reviewCampaign"
            : status === "failed" ? "dispatch.failed" : status === "canceled" ? "dispatch.canceled" : "dispatch.completed";
      return textResult({ data, outputLocale, summary: message(outputLocale, id, { action, code: failureCode }) });
    },
  });

  pi.registerEntryRenderer<WorkerListPresentation>(WORKER_LIST_ENTRY_TYPE, (entry, options, theme) =>
    renderWorkerListEntry(entry, options, theme),
  );

  pi.registerCommand("horsepower-workers", {
    description: "Show read-only Horsepower workers",
    handler: async (_args, ctx) => {
      let locale: OutputLocale = "en";
      try {
        if (dependencies.resolveOutputLocale) locale = await dependencies.resolveOutputLocale(ctx.cwd);
      } catch {
        locale = "en";
      }
      const labels = workerListLabels(locale);
      let result: unknown;
      try {
        result = await runtime(ctx).execute({ action: "list", cwd: ctx.cwd }, runtimeContext(ctx));
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        ctx.ui.notify(`${labels.listFailed} ${safeTitlePart(detail, 200)}`.trim(), "error");
        return;
      }
      if (!isWorkerListSourceArray(result)) {
        ctx.ui.notify(labels.listFailed, "error");
        return;
      }
      let presentation: WorkerListPresentation;
      try {
        presentation = projectWorkerList(result, { locale, observedAt: Date.now() });
      } catch {
        ctx.ui.notify(labels.listFailed, "error");
        return;
      }
      if (ctx.mode === "tui") {
        try {
          await new Promise<void>((resolve) => {
            void ctx.ui.custom((tui, theme, keys, done): Component => {
            let offset = 0;
            let lines = ["No workers."];
            const refresh = () => {
              const cards = [...oneShotCards.values(), ...presentation.workers.map((worker) => modelFromPersistent(worker as never))];
              lines = cards.length ? cards.flatMap((card) => [...workerCardLines(card, locale), ""]) : ["No workers."];
              offset = Math.min(offset, Math.max(0, lines.length - 1));
              tui.requestRender();
            };
            refresh();
            const component: Component = {
              render(width) {
                const innerWidth = Math.max(1, width - 2);
                const row = (content: string) => theme.fg("border", "│") + truncateToWidth(` ${content}`, innerWidth, "…", true) + theme.fg("border", "│");
                const title = " Horsepower Workers ";
                const borderWidth = Math.max(0, innerWidth - visibleWidth(title));
                const left = Math.floor(borderWidth / 2);
                const right = borderWidth - left;
                const bodyHeight = Math.max(3, Math.min(24, Math.floor(width / 3)));
                const visible = lines.slice(offset, offset + bodyHeight);
                const output = [
                  theme.fg("border", `╭${"─".repeat(left)}`) + theme.fg("accent", title) + theme.fg("border", `${"─".repeat(right)}╮`),
                  row(""),
                  ...visible.map(row),
                ];
                for (let index = visible.length; index < bodyHeight; index += 1) output.push(row(""));
                output.push(theme.fg("border", `├${"─".repeat(innerWidth)}┤`));
                output.push(row(locale === "zh-CN" ? "↑↓/j/k 滚动  r 刷新  q/esc/ctrl+c 关闭" : "↑↓/j/k scroll  r refresh  q/esc/ctrl+c close"));
                output.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
                return output;
              },
              invalidate() {},
              handleInput(data) {
                if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") { done(undefined); return; }
                if (keys.matches(data, "tui.select.up") || data === "k") offset = Math.max(0, offset - 1);
                else if (keys.matches(data, "tui.select.down") || data === "j") offset = Math.min(Math.max(0, lines.length - 1), offset + 1);
                else if (data === "\u001b[5~") offset = Math.max(0, offset - 10);
                else if (data === "\u001b[6~") offset = Math.min(Math.max(0, lines.length - 1), offset + 10);
                else if (data === "r") refresh();
                tui.requestRender();
              },
            };
              return component;
            }, { overlay: true, overlayOptions: { anchor: "center", width: 82 } }).then(() => resolve(), () => resolve());
          });
          return;
        } catch (cause) {
          ctx.ui.notify(`${labels.listFailed} ${safeTitlePart(cause instanceof Error ? cause.message : String(cause), 200)}`.trim(), "error");
        }
      }
      try {
        pi.appendEntry<WorkerListPresentation>(WORKER_LIST_ENTRY_TYPE, presentation);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        // Explicit failure fallback only — never claim durable output succeeded.
        const preview = safeTitlePart(formatWorkerListText(presentation, false), 500);
        ctx.ui.notify(`${labels.appendFailed} ${safeTitlePart(detail, 120)} ${preview}`.trim(), "error");
        return;
      }
      // Commands must provide visible acknowledgement in interactive TUI as well as RPC.
      if (presentation.workers.length === 0) {
        ctx.ui.notify(labels.empty, "info");
      } else if (ctx.mode !== "rpc") {
        ctx.ui.notify(`${labels.workers}: ${presentation.workers.length}`, "info");
      }
      if (ctx.mode === "rpc") ctx.ui.notify(labels.tuiUnavailable, "info");
    },
  });
  pi.registerCommand("horsepower-doctor", {
    description: "Show safe Horsepower diagnostics",
    handler: async (_args, ctx) => {
      const result = await runtime(ctx).execute({ action: "doctor", cwd: ctx.cwd }, runtimeContext(ctx));
      ctx.ui.notify(JSON.stringify(result), "info");
    },
  });
  pi.registerCommand("horsepower-campaign", {
    description: "Discover unfinished OpenSpec changes, select canonical tasks, and start an implementation campaign",
    handler: async (_args, ctx) => {
      const locale = dependencies.resolveOutputLocale ? await dependencies.resolveOutputLocale(ctx.cwd) : "en";
      const t = locale === "zh-CN" ? {
        changes: "选择未完成的 OpenSpec 变更", noChanges: "当前项目没有可用于 campaign 的未完成 apply-ready OpenSpec 变更。请先创建或推进有效变更，再重新运行 /horsepower-campaign。",
        progress: (complete: number, total: number) => `${complete}/${total} 个任务已完成`, inventory: "当前 OpenSpec 任务", scope: "选择任务范围",
        all: "全部未完成任务", sections: "按章节选择", manual: "手动输入精确任务 ID",
        sectionInput: "输入章节 ID（逗号分隔）", taskInput: "输入精确任务 ID（逗号分隔）",
        taskSummary: "已规范化任务范围", count: (value: number) => `${value} 个任务`, duplicates: "已移除重复任务 ID",
        mode: "选择实施模式", multi: "多智能体团队", main: "主智能体直接执行",
        planHeading: "当前 test-and-gate plan",
        invalid: "任务选择无效", empty: "没有可选择的未完成任务", kickoff: "立即开始已确认的 Horsepower 执行活动。",
      } : {
        changes: "Select an unfinished OpenSpec change", noChanges: "No eligible unfinished OpenSpec change is available in the current project for a campaign. Create or advance a valid apply-ready change, then run /horsepower-campaign again.",
        progress: (complete: number, total: number) => `${complete}/${total} tasks complete`, inventory: "Current OpenSpec tasks", scope: "Select task scope",
        all: "All unfinished tasks", sections: "Select by section", manual: "Enter exact task IDs",
        sectionInput: "Section IDs (comma-separated)", taskInput: "Exact task IDs (comma-separated)",
        taskSummary: "Normalized task scope", count: (value: number) => `${value} task(s)`, duplicates: "Removed duplicate task IDs",
        mode: "Choose implementation mode", multi: "Multi-Agent team", main: "Main Agent direct execution",
        planHeading: "Current test-and-gate plan",
        invalid: "Invalid task selection", empty: "No unfinished tasks are available", kickoff: "Begin the confirmed Horsepower campaign now.",
      };
      const active = runtime(ctx);
      if (!active.discoverImplementationChanges || !active.loadImplementationTaskInventory || !active.beginImplementationCampaign) {
        throw new Error("Implementation campaign runtime is unavailable");
      }
      const candidates = await active.discoverImplementationChanges({ projectId: ctx.cwd });
      if (!candidates.length) { ctx.ui.notify(t.noChanges, "info"); return; }
      const labels = candidates.map((candidate) => `${candidate.changeId} — ${t.progress(candidate.completedTasks, candidate.totalTasks)}`);
      const selectedLabel = await ctx.ui.select(t.changes, labels);
      if (!selectedLabel) return;
      const selectedIndex = labels.indexOf(selectedLabel);
      if (selectedIndex < 0) { ctx.ui.notify(t.invalid, "error"); return; }
      const changeId = candidates[selectedIndex]!.changeId;
      const inventory = await active.loadImplementationTaskInventory({ changeId, projectId: ctx.cwd });
      const allTasks = inventory.sections.flatMap((section) => section.tasks);
      const pending = allTasks.filter((task) => task.status === "pending");
      if (!pending.length) { ctx.ui.notify(t.empty, "info"); return; }
      const inventoryLines = inventory.sections.flatMap((section) => [
        `## ${section.id}. ${section.title}`,
        ...section.tasks.map((task) => `- [${task.status === "complete" ? "x" : " "}] ${task.id} ${task.description}`),
      ]);
      let inventoryChunk = t.inventory;
      for (const line of inventoryLines) {
        if (Buffer.byteLength(`${inventoryChunk}\n${line}`, "utf8") > 40 * 1024) {
          ctx.ui.notify(inventoryChunk, "info");
          inventoryChunk = line;
        } else inventoryChunk += `\n${line}`;
      }
      if (inventoryChunk) ctx.ui.notify(inventoryChunk, "info");
      const choices = [t.all, t.sections, t.manual];
      const scopeChoice = await ctx.ui.select(t.scope, choices);
      if (!scopeChoice) return;
      if (!choices.includes(scopeChoice)) { ctx.ui.notify(t.invalid, "error"); return; }
      let requested: string[];
      if (scopeChoice === t.all) requested = pending.map((task) => task.id);
      else if (scopeChoice === t.sections) {
        const sectionIds = (await ctx.ui.input(t.sectionInput))?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
        requested = pending.filter((task) => sectionIds.includes(task.sectionId)).map((task) => task.id);
        if (sectionIds.some((id) => !inventory.sections.some((section) => section.id === id))) { ctx.ui.notify(t.invalid, "error"); return; }
      } else {
        requested = (await ctx.ui.input(t.taskInput))?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
      }
      const duplicateIds = [...new Set(requested.filter((id, index) => requested.indexOf(id) !== index))];
      if (duplicateIds.length) ctx.ui.notify(`${t.duplicates}: ${duplicateIds.join(",")}`, "info");
      const requestedSet = new Set(requested);
      const invalid = requested.filter((id) => !pending.some((task) => task.id === id) || !/^\d+(?:\.\d+)+$/u.test(id));
      if (!requested.length || invalid.length) { ctx.ui.notify(`${t.invalid}: ${invalid.join(",")}`, "error"); return; }
      const selectedTasks = pending.filter((task) => requestedSet.has(task.id));
      const selectedTaskIds = selectedTasks.map((task) => task.id);
      if (!selectedTaskIds.length) { ctx.ui.notify(t.invalid, "error"); return; }
      let selectionChunk = "";
      for (const task of selectedTasks) {
        const line = `${task.id} ${task.description}`;
        if (Buffer.byteLength(`${selectionChunk}\n${line}`, "utf8") > 40 * 1024) {
          ctx.ui.notify(selectionChunk, "info");
          selectionChunk = line;
        } else selectionChunk += `${selectionChunk ? "\n" : ""}${line}`;
      }
      if (selectionChunk) ctx.ui.notify(`${t.taskSummary} (${t.count(selectedTaskIds.length)})\n${selectionChunk}`, "info");
      const modeChoices = [t.multi, t.main];
      const modeChoice = await ctx.ui.select(t.mode, modeChoices);
      if (!modeChoice) return;
      if (!modeChoices.includes(modeChoice)) { ctx.ui.notify(t.invalid, "error"); return; }
      const mode = modeChoice === t.multi ? "multi_agent" : "main_agent";
      const promptLabel = locale === "zh-CN"
        ? "描述本次 campaign 的测试强度（例如：仅运行相关测试；或覆盖单元、集成、失败路径与可用的 E2E）"
        : "Describe the testing intensity for this campaign (for example: only relevant tests; or unit, integration, failure paths, and available E2E)";
      const pollInput = await ctx.ui.input(locale === "zh-CN" ? "请输入 worker polling interval（秒，默认 30）" : "Worker polling interval in seconds (positive integer, default 30)");
      const pollIntervalSeconds = pollInput?.trim() === "" || pollInput === undefined ? 30 : Number(pollInput.trim());
      if (!Number.isSafeInteger(pollIntervalSeconds) || pollIntervalSeconds <= 0 || pollIntervalSeconds > 2_147_483) {
        ctx.ui.notify(locale === "zh-CN" ? "polling interval 无效；请输入正整数秒数，未创建 campaign。" : "Polling interval is invalid; enter a positive integer number of seconds. No campaign was created.", "error");
        return;
      }
      const rawTestingPrompt = await ctx.ui.input(promptLabel);
      const testingPrompt = rawTestingPrompt?.replace(/\s+/gu, " ").trim() ?? "";
      if (!testingPrompt || Buffer.byteLength(testingPrompt, "utf8") > 2_000 || /https?:\/\/|Authorization:|Bearer\s+|api[_-]?key|token[=:]/iu.test(testingPrompt)) {
        ctx.ui.notify(locale === "zh-CN" ? "测试强度提示词无效或已取消；未创建 campaign。" : "Testing-intensity prompt is invalid or canceled; no campaign was created.", "error");
        return;
      }
      const checkLines = selectedTasks.flatMap((task) => [
        `${task.id} ${task.description}`,
        ...((task.checks?.length ? task.checks : [locale === "zh-CN" ? "无" : "none"]).map((check) => `  ${locale === "zh-CN" ? "检查" : "Check"}: ${check}`)),
      ]);
      notifyChunks(ctx.ui, locale === "zh-CN" ? "当前任务检查与测试强度" : "Current task checks and testing intensity", [
        `changeId: ${changeId}`,
        `mode: ${mode}`,
        ...checkLines,
        `${locale === "zh-CN" ? "测试强度" : "Testing intensity"}: ${testingPrompt}`,
        `${locale === "zh-CN" ? "轮询间隔" : "Polling interval"}: ${pollIntervalSeconds}s`,
      ]);
      const confirmed = await ctx.ui.confirm(
        locale === "zh-CN" ? "确认这些精确任务、检查、实施模式和测试强度吗？" : "Confirm these exact tasks, checks, execution mode, and testing intensity?",
        `${t.count(selectedTaskIds.length)}; changeId=${changeId}; taskIds=${selectedTaskIds.join(",")}; mode=${mode}; pollIntervalSeconds=${pollIntervalSeconds}; testingIntensity=${testingPrompt}`,
      );
      if (!confirmed) {
        ctx.ui.notify(locale === "zh-CN" ? "已取消 campaign 确认；未创建 campaign。" : "Campaign confirmation canceled; no campaign was created.", "info");
        return;
      }
      let result: { campaignId: string; mode: "multi_agent" | "main_agent"; changeId: string; selectedTaskIds: string[]; testing?: { prompt: string } };
      try {
        result = await active.beginImplementationCampaign({
          changeId, projectId: ctx.cwd, selectedTaskIds,
          selectedTasks: selectedTasks.map((task) => ({ ...task, status: "pending" as const })),
          inventoryDigest: inventory.digest,
          testingPrompt,
          pollIntervalSeconds,
          mode,
        }) as typeof result;
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        ctx.ui.notify(`${locale === "zh-CN" ? "Campaign 创建失败" : "Campaign creation failed"}: ${utf8Prefix(detail.replace(/Authorization:\s*[^;]+|Bearer\s+\S+/giu, "[redacted]"), 300)}`, "error");
        return;
      }
      const campaignResult = {
        campaignId: result.campaignId, changeId: result.changeId, mode: result.mode,
        selectedTaskIds: result.selectedTaskIds, selectedTaskCount: result.selectedTaskIds.length,
        testingPrompt,
        pollIntervalSeconds,
        selectedTaskChecks: selectedTasks.map((task) => ({ taskId: task.id, checks: task.checks ?? [] })),
      };
      pi.sendMessage({
        customType: "horsepower-campaign",
        content: `${t.kickoff} campaignId=${campaignResult.campaignId}; changeId=${campaignResult.changeId}; taskIds=${campaignResult.selectedTaskIds.join(",")}; mode=${campaignResult.mode}; pollIntervalSeconds=${pollIntervalSeconds}; testingIntensity=${testingPrompt}.`,
        display: true,
        details: campaignResult,
      }, { deliverAs: "followUp", triggerTurn: true });
      ctx.ui.notify(JSON.stringify(campaignResult), "info");
    },
  });
  pi.registerCommand("horsepower-campaign-pause", {
    description: "Pause automatic continuation for the current implementation campaign",
    handler: async (_args, ctx) => {
      const active = runtime(ctx).pauseCampaignContinuation?.(ctx.cwd);
      const locale = dependencies.resolveOutputLocale ? await dependencies.resolveOutputLocale(ctx.cwd).catch(() => "en" as const) : "en";
      if (!active) {
        ctx.ui.notify(message(locale, "campaign.continuationPauseUnavailable", {}), "warning");
        return;
      }
      clearCompactGeneration();
      ctx.ui.notify(message(locale, "campaign.continuationPaused", { campaignId: active.campaignId, changeId: active.changeId }), "info");
    },
  });

  pi.registerCommand("horsepower-review-authorize", {
    description: "Authorize a bounded reviewer in a main-Agent implementation campaign",
    handler: async (_args, ctx) => {
      const campaignId = (await ctx.ui.input("Implementation campaign ID"))?.trim();
      const reviewCampaignId = (await ctx.ui.input("Review campaign ID"))?.trim();
      const acceptanceScope = (await ctx.ui.input("Review acceptance scope"))?.trim();
      const budgetText = (await ctx.ui.input("Reviewer dispatch budget", "1"))?.trim();
      const budget = Number(budgetText);
      if (!campaignId || !reviewCampaignId || !acceptanceScope || !Number.isSafeInteger(budget) || budget <= 0) {
        ctx.ui.notify("Campaign IDs, scope, and a positive integer budget are required.", "error"); return;
      }
      const active = runtime(ctx);
      if (!active.authorizeImplementationReviewer) throw new Error("Reviewer authorization runtime is unavailable");
      const result = await active.authorizeImplementationReviewer({ campaignId, projectId: ctx.cwd, reviewCampaignId, acceptanceScope, budget });
      ctx.ui.notify(JSON.stringify(result), "info");
    },
  });

  pi.on("session_shutdown", async (event) => {
    clearCompactGeneration();
    if ((event.reason === "new" || event.reason === "resume" || event.reason === "fork") && lease) {
      lease.value.clearCampaignContinuation?.();
    }
    oneShotCards.clear();
    if ((event.reason === "reload" || event.reason === "quit") && lease) {
      cleanup ??= lease.cleanup();
      await cleanup;
    }
  });
}

export function bundledAgentsDirectory(moduleUrl: string = import.meta.url): string {
  const extensionEntry = realpathSync.native(fileURLToPath(moduleUrl));
  return join(dirname(extensionEntry), "..", "..", "..", "resources", "agents");
}

function readSettings(path: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Unable to read Horsepower settings: ${path}`);
  }
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error(`Horsepower settings must be a JSON object: ${path}`);
    }
    return value as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof SyntaxError) throw new Error(`Malformed Horsepower settings JSON: ${path}`);
    throw cause;
  }
}

export function webhookOptions(homeDir: string, projectDir: string): CreateHorsepowerRuntimeOptions["webhook"] {
  const paths = resolveHorsepowerPaths({ homeDir, projectDir });
  return parseWebhookSettings(
    readSettings(paths.global.settings).webhook,
    readSettings(paths.project.settings).webhook,
  );
}

let currentDeliveryOwner: { cwd: string; generation: number; context: ExtensionContext; sendMessage: (message: { customType: string; content: string; display: boolean; details: Record<string, unknown> }, options: { deliverAs: "followUp"; triggerTurn: true }) => void } | undefined;

function defaultLease(ctx?: ExtensionContext): RuntimeLease<HorsepowerRuntime> {
  const homeDir = homedir();
  const bundledAgentsDir = bundledAgentsDirectory();
  return acquireGlobalRuntime({
    create: () => createHorsepowerRuntime({
      homeDir,
      bundledAgentsDir,
      readText: (path) => readFile(path, "utf8"),
      resolveWebhook: (cwd) => webhookOptions(homeDir, cwd),
      settlementDelivery: (notice) => {
        const owner = currentDeliveryOwner;
        if (!owner) return;
        deliverSettlementNotice({
          cwd: owner.context.cwd,
          isIdle: () => owner.context.isIdle(),
          hasPendingMessages: () => owner.context.hasPendingMessages(),
          sendMessage: owner.sendMessage,
        }, notice, { cwd: owner.cwd, generation: owner.generation }, () => {
          const active = currentDeliveryOwner;
          return active ? { cwd: active.cwd, generation: active.generation } : undefined;
        });
      },
    }),
  });
}

export default function horsepowerExtension(pi: ExtensionAPI): void {
  const homeDir = homedir();
  registerHorsepowerExtension(pi, {
    acquireRuntime: (ctx) => {
      if (ctx) currentDeliveryOwner = { cwd: ctx.cwd, generation: (currentDeliveryOwner?.generation ?? 0) + 1, context: ctx, sendMessage: pi.sendMessage.bind(pi) };
      return defaultLease(ctx);
    },
    resolveOutputLocale: async (cwd) => {
      const paths = resolveHorsepowerPaths({ homeDir, projectDir: cwd });
      return resolveOutputLocale(paths.global.settings, paths.project.settings);
    },
  });
}
