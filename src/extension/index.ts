import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { horsepowerSubagentSchema } from "../orchestration/schema.js";
import { acquireGlobalRuntime, type RuntimeLease } from "../runtime/global-runtime.js";
import type { HorsepowerRuntime, HorsepowerRuntimeContext } from "./runtime.js";
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
  acquireRuntime(): ExtensionLease;
}

function textResult(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, undefined, 2) }],
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
  const lease = dependencies.acquireRuntime();
  let cleanup: Promise<void> | undefined;

  pi.registerTool({
    name: "horsepower_subagent",
    label: "Horsepower Subagent",
    description: "Explicitly run or manage Horsepower one-shot and persistent workers.",
    parameters: horsepowerSubagentSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = { ...(params as Record<string, unknown>), cwd: ctx.cwd };
      return textResult(await lease.value.execute(input, runtimeContext(ctx)));
    },
  });

  pi.registerCommand("horsepower-workers", {
    description: "List process-lifetime Horsepower workers",
    handler: async (_args, ctx) => {
      const result = await lease.value.execute({ action: "list", cwd: ctx.cwd }, runtimeContext(ctx));
      ctx.ui.notify(JSON.stringify(result), "info");
    },
  });
  pi.registerCommand("horsepower-doctor", {
    description: "Show safe Horsepower diagnostics",
    handler: async (_args, ctx) => {
      const result = await lease.value.execute({ action: "doctor", cwd: ctx.cwd }, runtimeContext(ctx));
      ctx.ui.notify(JSON.stringify(result), "info");
    },
  });

  pi.on("session_shutdown", async (event) => {
    if (event.reason === "reload" || event.reason === "quit") {
      cleanup ??= lease.cleanup();
      await cleanup;
    }
  });
}

function defaultLease(): RuntimeLease<HorsepowerRuntime> {
  const bundledAgentsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "resources", "agents");
  return acquireGlobalRuntime({
    create: () => createHorsepowerRuntime({
      homeDir: homedir(),
      bundledAgentsDir,
      readText: (path) => readFile(path, "utf8"),
    }),
  });
}

export default function horsepowerExtension(pi: ExtensionAPI): void {
  registerHorsepowerExtension(pi, { acquireRuntime: defaultLease });
}
