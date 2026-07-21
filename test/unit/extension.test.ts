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

test("new resume and fork preserve runtime while reload and quit cleanup idempotently", async () => {
  const pi = fakePi();
  const cleanup = vi.fn(async () => undefined);
  const { registerHorsepowerExtension } = await import("../../src/extension/index.js");
  registerHorsepowerExtension(pi as never, {
    acquireRuntime: () => ({ value: { execute: vi.fn() }, cleanup, abandon: vi.fn() }),
  });
  const shutdown = pi.handlers.get("session_shutdown")![0]!;

  for (const reason of ["new", "resume", "fork"]) await shutdown({ reason }, context());
  expect(cleanup).not.toHaveBeenCalled();
  await Promise.all([
    shutdown({ reason: "reload" }, context()),
    shutdown({ reason: "reload" }, context()),
    shutdown({ reason: "quit" }, context()),
  ]);
  expect(cleanup).toHaveBeenCalledTimes(1);
});
