import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

interface FakePi {
  tools: Array<Record<string, unknown>>;
  commands: Array<{ name: string; options: Record<string, unknown> }>;
  handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
  registerTool(tool: Record<string, unknown>): void;
  registerCommand(name: string, options: Record<string, unknown>): void;
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
}

function fakePi(): FakePi {
  return {
    tools: [], commands: [], handlers: new Map(),
    registerTool(tool) { this.tools.push(tool); },
    registerCommand(name, options) { this.commands.push({ name, options }); },
    on(event, handler) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); },
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
    "team", "horsepower-workers", "horsepower-doctor",
  ]);
  expect(pi.tools.some((tool) => ["subagent", "team_create"].includes(String(tool.name)))).toBe(false);
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

test("safe commands remain usable while advancing actions retain runtime OpenSpec gating", async () => {
  const pi = fakePi();
  const execute = vi.fn(async (input: { action: string }) => {
    if (input.action === "create") throw new Error("OpenSpec project is not healthy");
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
  }, undefined, undefined, ctx)).rejects.toThrow("OpenSpec project is not healthy");
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
