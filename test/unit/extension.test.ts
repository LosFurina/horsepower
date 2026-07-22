import { mkdtemp, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test, vi } from "vitest";
import type { HorsepowerRuntimeContext } from "../../src/extension/runtime.js";

interface FakePi {
  tools: Array<Record<string, unknown>>;
  commands: Array<{ name: string; options: Record<string, unknown> }>;
  handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
  messages: Array<{ message: unknown; options?: unknown }>;
  registerTool(tool: Record<string, unknown>): void;
  registerCommand(name: string, options: Record<string, unknown>): void;
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  sendMessage(message: unknown, options?: unknown): void;
}

function fakePi(): FakePi {
  return {
    tools: [], commands: [], handlers: new Map(), messages: [],
    registerTool(tool) { this.tools.push(tool); },
    registerCommand(name, options) { this.commands.push({ name, options }); },
    on(event, handler) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); },
    sendMessage(message, options) { this.messages.push({ message, options }); },
  };
}

function context(cwd = "/active/project") {
  return { cwd, modelRegistry: { marker: "registry" }, ui: { notify: vi.fn() } };
}

test("registers only Horsepower-namespaced tools and commands without altering coexistence", async () => {
  const pi = fakePi();
  pi.tools.push({ name: "other_tool" });
  pi.commands.push({ name: "team", options: {} });
  const execute = vi.fn();
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");

  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute }, cleanup: vi.fn(), abandon: vi.fn() }),
  });

  expect(pi.tools.map((tool) => tool.name)).toEqual(["other_tool", "horsepower_subagent"]);
  expect(pi.commands.map((command) => command.name)).toEqual([
    "team", "horsepower-workers", "horsepower-doctor", "horsepower-campaign", "horsepower-review-authorize",
  ]);
  expect(pi.tools.some((tool) => ["subagent", "team_create"].includes(String(tool.name)))).toBe(false);
});

test("user commands create implementation mode and bounded reviewer authorization", async () => {
  const pi = fakePi();
  const inventory = { changeId: "horsepower-alpha1", projectRoot: "/active/project", digest: "a".repeat(64), sections: [{ id: "4", title: "Work", tasks: [
    { id: "4.7", description: "Do work", status: "pending" as const, sectionId: "4" },
    { id: "4.8", description: "Already done", status: "complete" as const, sectionId: "4" },
  ] }] };
  const loadImplementationTaskInventory = vi.fn(async () => inventory);
  const beginImplementationCampaign = vi.fn(async (input) => ({ campaignId: "implementation-1", ...input }));
  const authorizeImplementationReviewer = vi.fn(async (input) => ({ remaining: input.budget }));
  const runtime = { execute: vi.fn(), loadImplementationTaskInventory, beginImplementationCampaign, authorizeImplementationReviewer };
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: runtime, cleanup: vi.fn(), abandon: vi.fn() }),
  });
  const ctx = context() as ReturnType<typeof context> & { ui: ReturnType<typeof context>["ui"] & { select: ReturnType<typeof vi.fn>; input: ReturnType<typeof vi.fn>; confirm: ReturnType<typeof vi.fn> } };
  ctx.ui.select = vi.fn()
    .mockResolvedValueOnce("All unfinished tasks")
    .mockResolvedValueOnce("Main Agent direct execution");
  ctx.ui.input = vi.fn().mockResolvedValueOnce("horsepower-alpha1");
  ctx.ui.confirm = vi.fn(async () => true);
  const campaign = pi.commands.find((command) => command.name === "horsepower-campaign")!.options.handler as (args: string, ctx: unknown) => Promise<void>;
  await campaign("", ctx);
  expect(loadImplementationTaskInventory).toHaveBeenCalledWith({ changeId: "horsepower-alpha1", projectId: "/active/project" });
  expect(beginImplementationCampaign).toHaveBeenCalledWith({
    changeId: "horsepower-alpha1", projectId: "/active/project", selectedTaskIds: ["4.7"],
    selectedTasks: [{ id: "4.7", description: "Do work", status: "pending", sectionId: "4" }],
    inventoryDigest: "a".repeat(64), mode: "main_agent",
  });
  expect(pi.messages).toEqual([{ message: expect.objectContaining({ customType: "horsepower-campaign", details: expect.objectContaining({ campaignId: "implementation-1", mode: "main_agent" }) }), options: { deliverAs: "followUp", triggerTurn: true } }]);

  ctx.ui.input = vi.fn()
    .mockResolvedValueOnce("implementation-1")
    .mockResolvedValueOnce("review-1")
    .mockResolvedValueOnce("OpenSpec 4.8")
    .mockResolvedValueOnce("1");
  const authorize = pi.commands.find((command) => command.name === "horsepower-review-authorize")!.options.handler as (args: string, ctx: unknown) => Promise<void>;
  await authorize("", ctx);
  expect(authorizeImplementationReviewer).toHaveBeenCalledWith({ campaignId: "implementation-1", projectId: "/active/project", reviewCampaignId: "review-1", acceptanceScope: "OpenSpec 4.8", budget: 1 });
});

test.each([
  { locale: "en" as const, scope: "Select by section", entry: "2", expected: ["2.1"], mode: "Multi-Agent team" },
  { locale: "zh-CN" as const, scope: "手动输入精确任务 ID", entry: "2.1,1.1,2.1", expected: ["1.1", "2.1"], mode: "多智能体团队" },
])("campaign $locale $scope selection normalizes canonical pending IDs", async ({ locale, scope, entry, expected, mode }) => {
  const pi = fakePi();
  const inventory = { changeId: "change-a", projectRoot: "/active/project", digest: "c".repeat(64), sections: [
    { id: "1", title: "One", tasks: [{ id: "1.1", description: "First", status: "pending" as const, sectionId: "1" }] },
    { id: "2", title: "Two", tasks: [{ id: "2.1", description: "Second", status: "pending" as const, sectionId: "2" }, { id: "2.2", description: "Done", status: "complete" as const, sectionId: "2" }] },
  ] };
  const beginImplementationCampaign = vi.fn(async (input) => ({ campaignId: "campaign", ...input }));
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute: vi.fn(), loadImplementationTaskInventory: vi.fn(async () => inventory), beginImplementationCampaign }, cleanup: vi.fn(), abandon: vi.fn() }),
    resolveOutputLocale: async () => locale,
  });
  const ctx = context() as any;
  ctx.ui.input = vi.fn().mockResolvedValueOnce("change-a").mockResolvedValueOnce(entry);
  ctx.ui.select = vi.fn().mockResolvedValueOnce(scope).mockResolvedValueOnce(mode);
  ctx.ui.confirm = vi.fn(async () => true);
  await (pi.commands.find((item) => item.name === "horsepower-campaign")!.options.handler as any)("", ctx);
  expect(beginImplementationCampaign).toHaveBeenCalledWith(expect.objectContaining({ selectedTaskIds: expected, mode: "multi_agent" }));
  const prompts = [...ctx.ui.input.mock.calls, ...ctx.ui.select.mock.calls, ...ctx.ui.confirm.mock.calls].flat().join(" ");
  expect(prompts).toContain(locale === "zh-CN" ? "确认" : "Confirm");
  expect(prompts).not.toContain("选择实施模式 / Choose");
  if (locale === "zh-CN") expect(ctx.ui.notify).toHaveBeenCalledWith("已移除重复任务 ID: 2.1", "info");
});

test("large campaign inventory preserves every selectable task ID in bounded UI output", async () => {
  const tasks = Array.from({ length: 1_000 }, (_, index) => ({
    id: `1.${index + 1}`, description: `Task ${index + 1} ${"x".repeat(450)}`, status: "pending" as const, sectionId: "1",
  }));
  const inventory = { changeId: "change-large", projectRoot: "/active/project", digest: "d".repeat(64), sections: [{ id: "1", title: "Large", tasks }] };
  const pi = fakePi();
  const beginImplementationCampaign = vi.fn(async (input) => ({ campaignId: "campaign-large", ...input }));
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, { acquireRuntime: () => ({ value: {
    execute: vi.fn(), loadImplementationTaskInventory: vi.fn(async () => inventory), beginImplementationCampaign,
  }, cleanup: vi.fn(), abandon: vi.fn() }) });
  const ctx = context() as any;
  ctx.ui.input = vi.fn(async () => "change-large");
  ctx.ui.select = vi.fn().mockResolvedValueOnce("All unfinished tasks").mockResolvedValueOnce("Multi-Agent team");
  ctx.ui.confirm = vi.fn(async () => true);

  await (pi.commands.find((item) => item.name === "horsepower-campaign")!.options.handler as any)("", ctx);

  const expectedIds = tasks.map(({ id }) => id);
  expect(beginImplementationCampaign).toHaveBeenCalledWith(expect.objectContaining({ selectedTaskIds: expectedIds }));
  expect(ctx.ui.notify.mock.calls.every(([message]: [string]) => Buffer.byteLength(message, "utf8") <= 40 * 1024)).toBe(true);
  expect(ctx.ui.confirm).toHaveBeenCalledWith("Confirm this normalized task scope?", "1000 task(s)");
  expect(pi.messages).toHaveLength(1);
  expect((pi.messages[0]!.message as any).details.selectedTaskIds).toEqual(expectedIds);
  expect(Buffer.byteLength((pi.messages[0]!.message as any).content, "utf8")).toBeLessThan(40 * 1024);
});

test("campaign with no unfinished tasks returns an actionable outcome without creating state", async () => {
  const inventory = { changeId: "change-done", projectRoot: "/active/project", digest: "e".repeat(64), sections: [{ id: "1", title: "Done", tasks: [
    { id: "1.1", description: "Complete", status: "complete" as const, sectionId: "1" },
  ] }] };
  const pi = fakePi();
  const beginImplementationCampaign = vi.fn();
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, { acquireRuntime: () => ({ value: {
    execute: vi.fn(), loadImplementationTaskInventory: vi.fn(async () => inventory), beginImplementationCampaign,
  }, cleanup: vi.fn(), abandon: vi.fn() }) });
  const ctx = context() as any;
  ctx.ui.input = vi.fn(async () => "change-done");
  ctx.ui.select = vi.fn(); ctx.ui.confirm = vi.fn();

  await (pi.commands.find((item) => item.name === "horsepower-campaign")!.options.handler as any)("", ctx);

  expect(ctx.ui.notify).toHaveBeenCalledWith("No unfinished tasks are available", "info");
  expect(ctx.ui.select).not.toHaveBeenCalled();
  expect(beginImplementationCampaign).not.toHaveBeenCalled();
  expect(pi.messages).toEqual([]);
});

test("campaign cancellation and creation failure never kick off while repeated confirmed commands kick off once each", async () => {
  const inventory = { changeId: "change-a", projectRoot: "/active/project", digest: "b".repeat(64), sections: [{ id: "1", title: "Work", tasks: [
    { id: "1.1", description: "Work", status: "pending" as const, sectionId: "1" },
  ] }] };
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");

  const canceledPi = fakePi();
  const canceledBegin = vi.fn();
  registerHorsepowerExtension(canceledPi as never, { acquireRuntime: () => ({ value: {
    execute: vi.fn(), loadImplementationTaskInventory: vi.fn(async () => inventory), beginImplementationCampaign: canceledBegin,
  }, cleanup: vi.fn(), abandon: vi.fn() }) });
  const canceledCtx = context() as any;
  canceledCtx.ui.input = vi.fn(async () => "change-a");
  canceledCtx.ui.select = vi.fn(async () => "All unfinished tasks");
  canceledCtx.ui.confirm = vi.fn(async () => false);
  await (canceledPi.commands.find((item) => item.name === "horsepower-campaign")!.options.handler as any)("", canceledCtx);
  expect(canceledBegin).not.toHaveBeenCalled();
  expect(canceledPi.messages).toEqual([]);

  const repeatedPi = fakePi();
  let id = 0;
  const repeatedBegin = vi.fn(async (input) => ({ campaignId: `campaign-${++id}`, ...input }));
  registerHorsepowerExtension(repeatedPi as never, { acquireRuntime: () => ({ value: {
    execute: vi.fn(), loadImplementationTaskInventory: vi.fn(async () => inventory), beginImplementationCampaign: repeatedBegin,
  }, cleanup: vi.fn(), abandon: vi.fn() }) });
  const repeatedCtx = context() as any;
  repeatedCtx.ui.input = vi.fn().mockResolvedValueOnce("change-a").mockResolvedValueOnce("change-a");
  repeatedCtx.ui.select = vi.fn()
    .mockResolvedValueOnce("All unfinished tasks").mockResolvedValueOnce("Multi-Agent team")
    .mockResolvedValueOnce("All unfinished tasks").mockResolvedValueOnce("Multi-Agent team");
  repeatedCtx.ui.confirm = vi.fn(async () => true);
  const handler = repeatedPi.commands.find((item) => item.name === "horsepower-campaign")!.options.handler as any;
  await handler("", repeatedCtx);
  await handler("", repeatedCtx);
  expect(repeatedPi.messages).toHaveLength(2);
  expect(repeatedPi.messages.map(({ options }) => options)).toEqual([
    { deliverAs: "followUp", triggerTurn: true }, { deliverAs: "followUp", triggerTurn: true },
  ]);
  expect(JSON.stringify(repeatedPi.messages[0])).toContain("campaign-1");
  expect(JSON.stringify(repeatedPi.messages[1])).toContain("campaign-2");

  const failedPi = fakePi();
  registerHorsepowerExtension(failedPi as never, { acquireRuntime: () => ({ value: {
    execute: vi.fn(), loadImplementationTaskInventory: vi.fn(async () => inventory), beginImplementationCampaign: vi.fn(async () => { throw new Error("creation failed"); }),
  }, cleanup: vi.fn(), abandon: vi.fn() }) });
  const failedCtx = context() as any;
  failedCtx.ui.input = vi.fn(async () => "change-a"); failedCtx.ui.select = vi.fn().mockResolvedValueOnce("All unfinished tasks").mockResolvedValueOnce("Multi-Agent team"); failedCtx.ui.confirm = vi.fn(async () => true);
  await expect((failedPi.commands.find((item) => item.name === "horsepower-campaign")!.options.handler as any)("", failedCtx)).rejects.toThrow("creation failed");
  expect(failedPi.messages).toEqual([]);
});

test("tool localizes principal conclusions while preserving English evidence and machine fields", async () => {
  const pi = fakePi();
  const execute = vi.fn(async () => ({ status: "completed", runId: "run-1", rawEvidence: "English worker report" }));
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute }, cleanup: vi.fn(), abandon: vi.fn() }),
    resolveOutputLocale: async () => "zh-CN",
  });
  const tool = pi.tools[0] as { execute(...args: unknown[]): Promise<{ details: Record<string, unknown>; content: Array<{ text: string }> }> };
  const result = await tool.execute("call", { action: "status", workerId: "w" }, undefined, undefined, context());
  expect(result.details).toEqual({ data: { status: "completed", runId: "run-1", rawEvidence: "English worker report" }, outputLocale: "zh-CN", summary: "status 已完成。" });
  expect(result.content[0]!.text).toContain("status 已完成");
  expect(JSON.stringify(result.details)).toContain("English worker report");
});

test("tool passes explicit Captain capability, active cwd, and model registry", async () => {
  const pi = fakePi();
  const execute = vi.fn(async () => ({ ok: true }));
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute }, cleanup: vi.fn(), abandon: vi.fn() }),
  });
  const tool = pi.tools[0] as { execute(...args: unknown[]): Promise<unknown> };

  await tool.execute("call", { action: "list", cwd: "/stale" }, undefined, undefined, context());

  expect(execute).toHaveBeenCalledWith(
    { action: "list", cwd: "/active/project" },
    { captain: true, cwd: "/active/project", modelRegistry: { marker: "registry" } },
  );
});

test("safe commands remain usable while advancing failures return structured actionable results", async () => {
  const pi = fakePi();
  const execute = vi.fn(async (input: { action: string }) => {
    if (input.action === "create") throw Object.assign(new Error("OpenSpec project is not healthy"), {
      horsepowerFailure: { code: "OPENSPEC_BOUNDARY_FAILED", boundary: "openspec", remediation: "Run openspec doctor and resolve the reported project problem before retrying." },
    });
    return [{ workerId: "worker-1" }];
  });
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute }, cleanup: vi.fn(), abandon: vi.fn() }),
  });
  const tool = pi.tools[0] as { execute(...args: unknown[]): Promise<unknown> };
  const ctx = context();

  await expect(tool.execute("safe", { action: "list", cwd: "/wrong" }, undefined, undefined, ctx))
    .resolves.toMatchObject({ details: [{ workerId: "worker-1" }] });
  await expect(tool.execute("advance", {
    action: "create", cwd: "/wrong", changeId: "x", name: "w", agent: "coder", modelSlot: "craft",
  }, undefined, undefined, ctx)).resolves.toMatchObject({
    details: {
      status: "failed",
      action: "create",
      failure: {
        code: "OPENSPEC_BOUNDARY_FAILED",
        boundary: "openspec",
        message: "OpenSpec project is not healthy",
        remediation: "Run openspec doctor and resolve the reported project problem before retrying.",
      },
    },
  });
});

test("forwards the Pi abort signal and observable progress as non-empty partial tool results", async () => {
  const pi = fakePi();
  let progress: HorsepowerRuntimeContext["onProgress"];
  let receivedSignal: AbortSignal | undefined;
  const execute = vi.fn(async (_input: unknown, runtime: HorsepowerRuntimeContext) => {
    receivedSignal = runtime.signal;
    progress = runtime.onProgress;
    runtime.onProgress?.({ type: "tool_start", identity: { name: "inventory", agent: "coder", role: "Implement", requestedSlot: "craft", resolvedSlot: "craft", model: "provider/model", thinking: "high", handoffMode: "managed", invocationId: "inv-1" }, toolName: "read", toolCallId: "call-1", operation: "read", target: "src/index.ts" });
    return { status: "completed" };
  });
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute }, cleanup: vi.fn(), abandon: vi.fn() }),
  });
  const tool = pi.tools[0] as { execute(...args: unknown[]): Promise<unknown> };
  const controller = new AbortController();
  const updates: unknown[] = [];

  await tool.execute("call-1", { action: "single" }, controller.signal, (update: unknown) => { updates.push(update); }, context());

  expect(receivedSignal).toBe(controller.signal);
  expect(progress).toBeTypeOf("function");
  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({ details: { progress: { type: "tool_start", toolName: "read", operation: "read", target: "src/index.ts" } } });
  expect(JSON.stringify(updates[0])).toContain("inventory · coder (Implement) · craft→craft · provider/model · thinking=high · managed");
  expect(JSON.stringify(updates[0])).toContain("operation: read\\ntarget: src/index.ts\\nstatus: started");
});

test("one-shot process failures never collapse to an empty tool result", async () => {
  const pi = fakePi();
  const execute = vi.fn(async () => { throw Object.assign(new Error("Pi JSON worker exited without an assistant result"), {
    horsepowerFailure: { code: "WORKER_PROCESS_FAILED", boundary: "process", remediation: "Run horsepower doctor --json, inspect the process evidence, and retry the dispatch." },
  }); });
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute }, cleanup: vi.fn(), abandon: vi.fn() }),
    resolveOutputLocale: async () => "en",
  });
  const tool = pi.tools[0] as { execute(...args: unknown[]): Promise<{ details: Record<string, unknown>; content: Array<{ text: string }> }> };

  const result = await tool.execute("dispatch", { action: "single" }, undefined, undefined, context());

  expect(result.details).toMatchObject({
    data: {
      status: "failed", action: "single",
      failure: {
        code: "WORKER_PROCESS_FAILED", boundary: "process",
        remediation: "Run horsepower doctor --json, inspect the process evidence, and retry the dispatch.",
      },
    },
    outputLocale: "en",
  });
  expect(result.content[0]!.text).toContain("Pi JSON worker exited without an assistant result");
  expect(result.content[0]!.text.trim()).not.toBe("");
});

test("resolves bundled agents beside the immutable release root", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-extension-path-"));
  const releaseRoot = join(root, "release");
  const extensionRoot = join(releaseRoot, "pi/extensions/horsepower");
  const agentsRoot = join(releaseRoot, "resources/agents");
  await mkdir(extensionRoot, { recursive: true });
  await mkdir(agentsRoot, { recursive: true });
  await writeFile(join(extensionRoot, "index.js"), "export default {};");

  const { bundledAgentsDirectory } = await import("../../src/extension/index.js");
  expect(bundledAgentsDirectory(pathToFileURL(join(extensionRoot, "index.js")).href)).toBe(await realpath(agentsRoot));
});

test("resolves bundled agents when Pi loads the extension through its integration symlink", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-extension-symlink-"));
  const releaseRoot = join(root, "horsepower/versions/v1");
  const extensionRoot = join(releaseRoot, "pi/extensions/horsepower");
  const agentsRoot = join(releaseRoot, "resources/agents");
  const integrationRoot = join(root, "agent/extensions");
  await mkdir(extensionRoot, { recursive: true });
  await mkdir(agentsRoot, { recursive: true });
  await mkdir(integrationRoot, { recursive: true });
  await writeFile(join(extensionRoot, "index.js"), "export default {};");
  await writeFile(join(agentsRoot, "coder.md"), "---\nname: coder\n---\n");
  await symlink(extensionRoot, join(integrationRoot, "horsepower"), "dir");

  const { bundledAgentsDirectory } = await import("../../src/extension/index.js");
  const linkedEntry = join(integrationRoot, "horsepower/index.js");
  expect(bundledAgentsDirectory(pathToFileURL(linkedEntry).href)).toBe(await realpath(agentsRoot));
});

test("acquires lazily and two extension instances reuse the process-global runtime", async () => {
  const firstPi = fakePi();
  const secondPi = fakePi();
  const host = {};
  const events = { on: vi.fn(), off: vi.fn() };
  const runtime = { execute: vi.fn(async () => []), shutdown: vi.fn(async () => undefined), abandon: vi.fn() };
  const create = vi.fn(() => runtime);
  const { acquireGlobalRuntime } = await import("../../src/runtime/global-runtime.js");
  const acquireRuntime = vi.fn(() => acquireGlobalRuntime({ host, events, create }));
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");

  registerHorsepowerExtension(firstPi as never, { acquireRuntime });
  registerHorsepowerExtension(secondPi as never, { acquireRuntime });
  expect(acquireRuntime).not.toHaveBeenCalled();

  const sessionStart = firstPi.handlers.get("session_start")![0]!;
  await sessionStart({ reason: "startup" }, context());
  const secondTool = secondPi.tools[0] as { execute(...args: unknown[]): Promise<unknown> };
  await secondTool.execute("call", { action: "list", cwd: "/wrong" }, undefined, undefined, context());

  expect(acquireRuntime).toHaveBeenCalledTimes(2);
  expect(create).toHaveBeenCalledTimes(1);
  expect(runtime.execute).toHaveBeenCalledTimes(1);
});

test("bounds LLM-facing tool content by UTF-8 bytes and lines while retaining details", async () => {
  const pi = fakePi();
  const byteResult = { output: `${"🙂".repeat(16_000)}tail` };
  const lineResult = Array.from({ length: 2_100 }, (_, index) => ({ index, value: "x" }));
  const results = [byteResult, lineResult];
  const execute = vi.fn(async () => results.shift());
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute }, cleanup: vi.fn(), abandon: vi.fn() }),
  });
  const tool = pi.tools[0] as { execute(...args: unknown[]): Promise<{ content: Array<{ text: string }>; details: unknown }> };

  const bytes = await tool.execute("bytes", { action: "list", cwd: "/wrong" }, undefined, undefined, context());
  expect(Buffer.byteLength(bytes.content[0]!.text, "utf8")).toBeLessThanOrEqual(50 * 1024);
  expect(bytes.content[0]!.text).toContain("omitted");
  expect(bytes.content[0]!.text).not.toContain("�");
  expect(bytes.details).toEqual(byteResult);

  const lines = await tool.execute("lines", { action: "list", cwd: "/wrong" }, undefined, undefined, context());
  expect(lines.content[0]!.text.split("\n")).toHaveLength(2_000);
  expect(lines.content[0]!.text).toContain("omitted");
  expect(lines.details).toEqual(lineResult);
});

test("malformed webhook settings are observable without exposing credential contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-settings-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const globalDir = join(home, ".pi", "agent", "horsepower");
  await mkdir(globalDir, { recursive: true });
  await writeFile(join(globalDir, "settings.json"), "{\"webhook\": {\"token\": \"do-not-print\"");
  const { webhookOptions } = await import("../../src/extension/index.js");

  expect(() => webhookOptions(home, project)).toThrow(`Malformed Horsepower settings JSON: ${join(globalDir, "settings.json")}`);
  try {
    webhookOptions(home, project);
  } catch (cause) {
    expect(String(cause)).not.toContain("do-not-print");
  }
});

test("rejects invalid webhook shapes and deep-merges notification overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-webhook-settings-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const globalDir = join(home, ".pi", "agent", "horsepower");
  const projectDir = join(project, ".pi", "horsepower");
  await mkdir(globalDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });
  const { webhookOptions } = await import("../../src/extension/index.js");

  await writeFile(join(globalDir, "settings.json"), JSON.stringify({ webhook: "disabled" }));
  expect(() => webhookOptions(home, project)).toThrow("webhook must be an object");

  await writeFile(join(globalDir, "settings.json"), JSON.stringify({
    webhook: {
      url: "https://example.invalid/hook",
      auth: { mode: "none" },
      notifications: { change: false, dispatch: false },
    },
  }));
  await writeFile(join(projectDir, "settings.json"), JSON.stringify({
    webhook: { notifications: { dispatch: true } },
  }));
  expect(webhookOptions(home, project)?.notifications).toEqual({ change: false, dispatch: true });

  await writeFile(join(projectDir, "settings.json"), JSON.stringify({ webhook: { notifications: [] } }));
  expect(() => webhookOptions(home, project)).toThrow("notifications must be an object");
});

test("new resume and fork preserve runtime while reload and quit cleanup idempotently", async () => {
  const pi = fakePi();
  const cleanup = vi.fn(async () => undefined);
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute: vi.fn() }, cleanup, abandon: vi.fn() }),
  });
  const start = pi.handlers.get("session_start")![0]!;
  const shutdown = pi.handlers.get("session_shutdown")![0]!;
  await start({ reason: "startup" }, context());

  for (const reason of ["new", "resume", "fork"]) await shutdown({ reason }, context());
  expect(cleanup).not.toHaveBeenCalled();
  await Promise.all([
    shutdown({ reason: "reload" }, context()),
    shutdown({ reason: "reload" }, context()),
    shutdown({ reason: "quit" }, context()),
  ]);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
