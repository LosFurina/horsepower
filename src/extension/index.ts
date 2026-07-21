import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveHorsepowerPaths } from "../config/paths.js";
import type { WebhookNotifierOptions } from "../lifecycle/webhook-notifier.js";
import { horsepowerSubagentSchema } from "../orchestration/schema.js";
import { acquireGlobalRuntime, type RuntimeLease } from "../runtime/global-runtime.js";
import type { CreateHorsepowerRuntimeOptions, HorsepowerRuntime, HorsepowerRuntimeContext } from "./runtime.js";
import { createHorsepowerRuntime } from "./runtime.js";

interface ExtensionRuntime {
  execute(input: unknown, context: HorsepowerRuntimeContext): Promise<unknown>;
}

interface ExtensionLease {
  value: ExtensionRuntime;
  cleanup(): Promise<void>;
  abandon(): void;
}

export interface HorsepowerExtensionDependencies {
  acquireRuntime(ctx?: ExtensionContext): ExtensionLease;
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
      return textResult(await runtime(ctx).execute(input, runtimeContext(ctx)));
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
  const rawGlobal = readSettings(paths.global.settings).webhook;
  const rawProject = readSettings(paths.project.settings).webhook;
  const objectSetting = (value: unknown, label: string): Record<string, unknown> => {
    if (value === undefined) return {};
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error(`Invalid Horsepower webhook configuration: ${label} must be an object`);
    }
    return value as Record<string, unknown>;
  };
  const global = objectSetting(rawGlobal, "webhook");
  const project = objectSetting(rawProject, "webhook");
  if (Object.keys(global).length === 0 && Object.keys(project).length === 0) return undefined;
  const globalNotifications = objectSetting(global.notifications, "notifications");
  const projectNotifications = objectSetting(project.notifications, "notifications");
  const merged = {
    ...global,
    ...project,
    notifications: { ...globalNotifications, ...projectNotifications },
  } as Record<string, unknown>;
  if (typeof merged.url !== "string" || !merged.url) throw new Error("Invalid Horsepower webhook configuration: url is required");
  const auth = merged.auth;
  if (auth === null || Array.isArray(auth) || typeof auth !== "object") {
    throw new Error("Invalid Horsepower webhook configuration: auth is required");
  }
  const rawAuth = auth as Record<string, unknown>;
  const validAuth = rawAuth.mode === "none" ||
    (rawAuth.mode === "hmac" && typeof rawAuth.secret === "string" && rawAuth.secret.length > 0) ||
    (rawAuth.mode === "bearer" && typeof rawAuth.token === "string" && rawAuth.token.length > 0);
  if (!validAuth) throw new Error("Invalid Horsepower webhook configuration: auth credentials are missing or invalid");
  const notifications = merged.notifications;
  const rawNotifications = notifications !== null && !Array.isArray(notifications) && typeof notifications === "object"
    ? notifications as Record<string, unknown>
    : {};
  return {
    config: { url: merged.url, auth: rawAuth as WebhookNotifierOptions["config"]["auth"] },
    notifications: {
      ...(typeof rawNotifications.change === "boolean" ? { change: rawNotifications.change } : {}),
      ...(typeof rawNotifications.dispatch === "boolean" ? { dispatch: rawNotifications.dispatch } : {}),
    },
  };
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
  registerHorsepowerExtension(pi, { acquireRuntime: defaultLease });
}
