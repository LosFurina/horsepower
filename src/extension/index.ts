import { readFileSync } from "node:fs";
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
import type { CreateHorsepowerRuntimeOptions, HorsepowerRuntime, HorsepowerRuntimeContext } from "./runtime.js";
import { createHorsepowerRuntime } from "./runtime.js";

interface ExtensionRuntime {
  execute(input: unknown, context: HorsepowerRuntimeContext): Promise<unknown>;
  beginImplementationCampaign?(input: { changeId: string; projectId: string; taskScopes: string[]; mode: "multi_agent" | "main_agent" }): Promise<unknown>;
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

function runtimeContext(ctx: ExtensionContext): HorsepowerRuntimeContext {
  return { captain: true, cwd: ctx.cwd, modelRegistry: ctx.modelRegistry };
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = { ...(params as Record<string, unknown>), cwd: ctx.cwd };
      const data = await runtime(ctx).execute(input, runtimeContext(ctx));
      if (!dependencies.resolveOutputLocale) return textResult(data);
      const outputLocale = await dependencies.resolveOutputLocale(ctx.cwd);
      const action = String((params as Record<string, unknown>).action ?? "operation");
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
    description: "Choose multi-Agent or main-Agent execution for a scoped implementation campaign",
    handler: async (_args, ctx) => {
      const modeChoice = await ctx.ui.select("Choose implementation mode / 选择实施模式", ["多 Agent 团队", "主 Agent 直接执行"]);
      if (!modeChoice) return;
      const changeId = (await ctx.ui.input("OpenSpec change ID", "horsepower-alpha1"))?.trim();
      const scopes = (await ctx.ui.input("Task scopes / 任务范围（逗号分隔）", "4.6,4.7"))?.split(",").map((item) => item.trim()).filter(Boolean);
      if (!changeId || !scopes?.length) { ctx.ui.notify("Change ID and task scopes are required.", "error"); return; }
      const active = runtime(ctx);
      if (!active.beginImplementationCampaign) throw new Error("Implementation campaign runtime is unavailable");
      const result = await active.beginImplementationCampaign({
        changeId, projectId: ctx.cwd, taskScopes: scopes,
        mode: modeChoice === "多 Agent 团队" ? "multi_agent" : "main_agent",
      }) as { campaignId: string; mode: "multi_agent" | "main_agent"; changeId: string; taskScopes: string[] };
      pi.sendMessage({
        customType: "horsepower-campaign",
        content: `User selected Horsepower implementation campaign ${result.campaignId}: mode=${result.mode}, change=${result.changeId}, scopes=${result.taskScopes.join(",")}.`,
        display: true,
        details: result,
      }, { deliverAs: "nextTurn" });
      ctx.ui.notify(JSON.stringify(result), "info");
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
  const bundledAgentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "resources", "agents");
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
