import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveHorsepowerPaths } from "../config/paths.js";
import { parseWebhookSettings } from "../config/webhook.js";
import { horsepowerSubagentSchema } from "../orchestration/schema.js";
import { message, resolveOutputLocale, type OutputLocale } from "../localization/index.js";
import { acquireGlobalRuntime, type RuntimeLease } from "../runtime/global-runtime.js";
import type { OneShotProgress, WorkerIdentity } from "../runtime/one-shot.js";
import type { CreateHorsepowerRuntimeOptions, HorsepowerRuntime, HorsepowerRuntimeContext } from "./runtime.js";
import { createHorsepowerRuntime } from "./runtime.js";

interface CampaignInventory {
  changeId: string;
  projectRoot: string;
  digest: string;
  sections: Array<{ id: string; title: string; tasks: Array<{ id: string; description: string; status: "pending" | "complete"; sectionId: string }> }>;
}

interface ExtensionRuntime {
  execute(input: unknown, context: HorsepowerRuntimeContext): Promise<unknown>;
  loadImplementationTaskInventory?(input: { changeId: string; projectId: string }): Promise<CampaignInventory>;
  beginImplementationCampaign?(input: {
    changeId: string; projectId: string; selectedTaskIds: string[];
    selectedTasks: Array<{ id: string; description: string; status: "pending"; sectionId: string }>;
    inventoryDigest: string; mode: "multi_agent" | "main_agent";
  } | { changeId: string; projectId: string; taskScopes: string[]; mode: "multi_agent" | "main_agent" }): Promise<unknown>;
  authorizeImplementationReviewer?(input: { campaignId: string; projectId: string; reviewCampaignId: string; acceptanceScope: string; budget: number }): Promise<unknown>;
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
  const classified = typed !== null && typeof typed === "object"
    && typeof (typed as { code?: unknown }).code === "string"
    && typeof (typed as { boundary?: unknown }).boundary === "string"
    && typeof (typed as { remediation?: unknown }).remediation === "string"
    ? typed as { code: string; boundary: string; remediation: string }
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
  if (event.type === "tool_start" || event.type === "tool_update" || event.type === "tool_end") {
    const status = event.type === "tool_end" ? (event.isError ? "failed" : "completed") : event.type === "tool_start" ? "started" : "running";
    body = [
      `operation: ${event.operation}`,
      ...(event.target ? [`target: ${event.target}`] : []),
      `status: ${status}`,
    ].join("\n");
  } else if (event.type === "assistant") {
    body = `operation: assistant\nsummary: ${event.summary}\nstatus: completed`;
  } else {
    body = [`operation: ${event.type}`, ...("summary" in event ? [`summary: ${event.summary}`] : []), `status: ${event.type}`].join("\n");
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
  const runtime = (ctx: ExtensionContext) => (lease ??= dependencies.acquireRuntime(ctx)).value;

  pi.on("session_start", (_event, ctx) => {
    lease ??= dependencies.acquireRuntime(ctx);
  });

  pi.registerTool({
    name: "horsepower_subagent",
    label: "Horsepower Subagent",
    description: "Explicitly run or manage Horsepower one-shot and persistent workers.",
    parameters: horsepowerSubagentSchema,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = { ...(params as Record<string, unknown>), cwd: ctx.cwd };
      const action = String((params as Record<string, unknown>).action ?? "operation");
      const progress = onUpdate ? (event: OneShotProgress & { identity: WorkerIdentity }) => {
        try { onUpdate(progressResult(event)); } catch { /* rendering is observational */ }
      } : undefined;
      let data: unknown;
      try {
        data = await runtime(ctx).execute(input, runtimeContext(ctx, signal, progress));
      } catch (cause) {
        data = structuredFailure(action, cause);
      }
      if (!dependencies.resolveOutputLocale) return textResult(data);
      let outputLocale: "en" | "zh-CN" = "en";
      try { outputLocale = await dependencies.resolveOutputLocale(ctx.cwd); }
      catch { /* terminal delivery falls back to English */ }
      const status = data !== null && typeof data === "object" && "status" in data ? String((data as { status: unknown }).status) : "completed";
      const id = status === "failed" ? "dispatch.failed" : status === "canceled" ? "dispatch.canceled" : "dispatch.completed";
      return textResult({ data, outputLocale, summary: message(outputLocale, id, { action }) });
    },
  });

  pi.registerCommand("horsepower-workers", {
    description: "List process-lifetime Horsepower workers",
    handler: async (_args, ctx) => {
      const result = await runtime(ctx).execute({ action: "list", cwd: ctx.cwd }, runtimeContext(ctx));
      ctx.ui.notify(JSON.stringify(result), "info");
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
    description: "Select canonical unfinished OpenSpec tasks and start an implementation campaign",
    handler: async (_args, ctx) => {
      const locale = dependencies.resolveOutputLocale ? await dependencies.resolveOutputLocale(ctx.cwd) : "en";
      const t = locale === "zh-CN" ? {
        change: "OpenSpec 变更 ID", inventory: "当前 OpenSpec 任务", scope: "选择任务范围",
        all: "全部未完成任务", sections: "按章节选择", manual: "手动输入精确任务 ID",
        sectionInput: "输入章节 ID（逗号分隔）", taskInput: "输入精确任务 ID（逗号分隔）",
        confirm: "确认以下规范化任务范围？", count: (value: number) => `${value} 个任务`, duplicates: "已移除重复任务 ID",
        mode: "选择实施模式", multi: "多智能体团队", main: "主智能体直接执行",
        invalid: "任务选择无效", empty: "没有可选择的未完成任务", kickoff: "立即开始已确认的 Horsepower 执行活动。",
      } : {
        change: "OpenSpec change ID", inventory: "Current OpenSpec tasks", scope: "Select task scope",
        all: "All unfinished tasks", sections: "Select by section", manual: "Enter exact task IDs",
        sectionInput: "Section IDs (comma-separated)", taskInput: "Exact task IDs (comma-separated)",
        confirm: "Confirm this normalized task scope?", count: (value: number) => `${value} task(s)`, duplicates: "Removed duplicate task IDs",
        mode: "Choose implementation mode", multi: "Multi-Agent team", main: "Main Agent direct execution",
        invalid: "Invalid task selection", empty: "No unfinished tasks are available", kickoff: "Begin the confirmed Horsepower campaign now.",
      };
      const changeId = (await ctx.ui.input(t.change))?.trim();
      if (!changeId) return;
      const active = runtime(ctx);
      if (!active.loadImplementationTaskInventory || !active.beginImplementationCampaign) throw new Error("Implementation campaign runtime is unavailable");
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
      if (selectionChunk) ctx.ui.notify(selectionChunk, "info");
      const confirmed = await ctx.ui.confirm(t.confirm, t.count(selectedTaskIds.length));
      if (!confirmed) return;
      const modeChoice = await ctx.ui.select(t.mode, [t.multi, t.main]);
      if (!modeChoice) return;
      const result = await active.beginImplementationCampaign({
        changeId, projectId: ctx.cwd, selectedTaskIds,
        selectedTasks: selectedTasks.map((task) => ({ ...task, status: "pending" as const })),
        inventoryDigest: inventory.digest,
        mode: modeChoice === t.multi ? "multi_agent" : "main_agent",
      }) as { campaignId: string; mode: "multi_agent" | "main_agent"; changeId: string; selectedTaskIds: string[] };
      const campaignResult = {
        campaignId: result.campaignId, changeId: result.changeId, mode: result.mode,
        selectedTaskIds: result.selectedTaskIds, selectedTaskCount: result.selectedTaskIds.length,
      };
      pi.sendMessage({
        customType: "horsepower-campaign",
        content: `${t.kickoff} campaignId=${campaignResult.campaignId}; changeId=${campaignResult.changeId}; taskIds=${campaignResult.selectedTaskIds.join(",")}; mode=${campaignResult.mode}.`,
        display: true,
        details: campaignResult,
      }, { deliverAs: "followUp", triggerTurn: true });
      ctx.ui.notify(JSON.stringify(campaignResult), "info");
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

function defaultLease(ctx?: ExtensionContext): RuntimeLease<HorsepowerRuntime> {
  const homeDir = homedir();
  const bundledAgentsDir = bundledAgentsDirectory();
  return acquireGlobalRuntime({
    create: () => createHorsepowerRuntime({
      homeDir,
      bundledAgentsDir,
      readText: (path) => readFile(path, "utf8"),
      resolveWebhook: (cwd) => webhookOptions(homeDir, cwd),
    }),
  });
}

export default function horsepowerExtension(pi: ExtensionAPI): void {
  const homeDir = homedir();
  registerHorsepowerExtension(pi, {
    acquireRuntime: defaultLease,
    resolveOutputLocale: async (cwd) => {
      const paths = resolveHorsepowerPaths({ homeDir, projectDir: cwd });
      return resolveOutputLocale(paths.global.settings, paths.project.settings);
    },
  });
}
