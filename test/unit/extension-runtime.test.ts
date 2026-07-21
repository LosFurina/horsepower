import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

function fakeManager() {
  return {
    list: vi.fn(() => [{ workerId: "worker-1" }]),
    status: vi.fn(), read: vi.fn(), abort: vi.fn(), destroy: vi.fn(), create: vi.fn(),
    send: vi.fn(), waitForMessage: vi.fn(), messageStatus: vi.fn(),
    destroyAll: vi.fn(async () => undefined), abandonAll: vi.fn(),
  };
}

const modelRegistry = {
  getAll: () => [{ provider: "provider", id: "model", reasoning: true }],
};

test("safe actions work without OpenSpec, slot files, or agent discovery", async () => {
  const manager = fakeManager();
  const runOpenSpec = vi.fn(async () => ({ code: 127, stdout: "", stderr: "missing", truncated: false }));
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: "/missing-home", bundledAgentsDir: "/missing-agents", manager: manager as never, runOpenSpec,
  });

  await expect(runtime.execute({ action: "list", cwd: "/stale" }, {
    captain: true, cwd: "/active/project", modelRegistry: modelRegistry as never,
  })).resolves.toEqual([{ workerId: "worker-1" }]);
  expect(runOpenSpec).not.toHaveBeenCalled();
});

test("advancing actions report official OpenSpec gating before dispatch configuration", async () => {
  const manager = fakeManager();
  const runOpenSpec = vi.fn(async () => ({ code: 127, stdout: "", stderr: "missing", truncated: false }));
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: "/missing-home", bundledAgentsDir: "/missing-agents", manager: manager as never, runOpenSpec,
  });

  await expect(runtime.execute({
    action: "create", changeId: "change-a", cwd: "/stale", name: "w", agent: "coder", modelSlot: "craft",
  }, { captain: true, cwd: "/active/project", modelRegistry: modelRegistry as never }))
    .rejects.toThrow("Official OpenSpec CLI was not found");
  expect(runOpenSpec).toHaveBeenCalledWith(["--version"], { cwd: "/active/project" });
});

test("configured dispatch notification uses injected transport and shutdown abandons retries", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-webhook-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const agents = join(root, "agents");
  await mkdir(join(home, ".pi", "agent", "horsepower"), { recursive: true });
  await mkdir(join(project, ".pi", "horsepower"), { recursive: true });
  await mkdir(agents, { recursive: true });
  await writeFile(join(home, ".pi", "agent", "horsepower", "model-slots.json"), JSON.stringify({ slots: {
    judgment: { model: "provider/model", thinking: "high" },
    craft: { model: "provider/model", thinking: "high" },
    utility: { model: "provider/model", thinking: "off" },
  } }));
  await writeFile(join(agents, "coder.md"), "---\nname: coder\nrole: Code\nrecommendedSlots: [craft]\ntools: [read]\nstandards: []\n---\nCode only.\n");
  const manager = fakeManager();
  manager.create.mockResolvedValue({ workerId: "worker-1" });
  const fetch = vi.fn(async () => new Response("unavailable", { status: 503 }));
  const sleep = vi.fn(() => new Promise<void>(() => undefined));
  const runOpenSpec = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: project } }), stderr: "", truncated: false };
    if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ changeName: "change-a", isComplete: true }), stderr: "", truncated: false };
    return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
  });
  const readText = vi.fn(async (path: string) => {
    if (path.endsWith("SKILL.md")) return "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n";
    if (path.endsWith("opsx-apply.md")) return "Implement tasks from an OpenSpec change";
    return (await import("node:fs/promises")).readFile(path, "utf8");
  });
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: home, bundledAgentsDir: agents, manager: manager as never, runOpenSpec, readText,
    webhook: {
      config: { url: "https://example.invalid/hook", auth: { mode: "none" } },
      notifications: { dispatch: true }, fetch: fetch as never, sleep, retryDelaysMs: [0, 1_000],
    },
  });

  await runtime.execute({
    action: "create", changeId: "change-a", name: "w", agent: "coder", modelSlot: "craft",
  }, { captain: true, cwd: project, modelRegistry: modelRegistry as never });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(sleep).toHaveBeenCalledTimes(1));
  await runtime.shutdown();

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(manager.destroyAll).toHaveBeenCalledTimes(1);
});

test("explicit change run permits valid terminal report and rejects invalid correlation", async () => {
  const manager = fakeManager();
  const runOpenSpec = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: "/project" } }), stderr: "", truncated: false };
    if (args[0] === "status") {
      const changeId = args[2]!;
      return { code: 0, stdout: JSON.stringify({ changeName: changeId, isComplete: true }), stderr: "", truncated: false };
    }
    return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
  });
  const readText = vi.fn(async (path: string) => path.endsWith("SKILL.md")
    ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n"
    : "Implement tasks from an OpenSpec change");
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({ homeDir: "/home", bundledAgentsDir: "/agents", manager: manager as never, runOpenSpec, readText });
  const ctx = { captain: true, cwd: "/project", modelRegistry: modelRegistry as never };

  const begun = await runtime.execute({ action: "begin_change", changeId: "change-a" }, ctx) as { runId: string };
  await expect(runtime.execute({
    action: "report_terminal", changeId: "change-b", runId: begun.runId,
    status: "failed", summary: "wrong change",
  }, ctx)).rejects.toThrow(`Run ${begun.runId} belongs to change change-a, not change-b`);
  await expect(runtime.execute({
    action: "report_terminal", changeId: "change-a", runId: begun.runId,
    status: "completed", summary: "complete",
    e2eWaiver: { reason: "No external interface", alternativeEvidence: ["focused integration test"] },
  }, ctx)).resolves.toMatchObject({ run: { runId: begun.runId, changeId: "change-a", status: "completed" } });
});

test("process-global notification retries bind disabled and enabled settings to each project run", async () => {
  const manager = fakeManager();
  const fetch = vi.fn(async (_input: string | URL | Request) => new Response("ok", { status: 200 }));
  const runOpenSpec = vi.fn(async (args: readonly string[], options: { cwd: string }) => {
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: options.cwd } }), stderr: "", truncated: false };
    if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ changeName: "change-a", isComplete: true }), stderr: "", truncated: false };
    return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
  });
  const readText = vi.fn(async (path: string) => path.endsWith("SKILL.md")
    ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n"
    : "Implement tasks from an OpenSpec change");
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: "/home", bundledAgentsDir: "/agents", manager: manager as never, runOpenSpec, readText,
    resolveWebhook: (cwd) => ({
      config: { url: `https://${cwd.slice(1)}.example/hook`, auth: { mode: "none" } },
      notifications: { change: cwd !== "/project-a" },
      fetch: fetch as never,
    }),
  });
  const ctx = (cwd: string) => ({ captain: true, cwd, modelRegistry: modelRegistry as never });

  const a = await runtime.execute({ action: "begin_change", changeId: "change-a" }, ctx("/project-a")) as { runId: string };
  const b = await runtime.execute({ action: "begin_change", changeId: "change-a" }, ctx("/project-b")) as { runId: string };
  await runtime.execute({ action: "report_terminal", changeId: "change-a", runId: a.runId, status: "failed", summary: "A" }, ctx("/project-a"));
  await runtime.execute({ action: "report_terminal", changeId: "change-a", runId: b.runId, status: "failed", summary: "B" }, ctx("/project-b"));
  await runtime.shutdown();

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe("https://project-b.example/hook");
});

test("concurrent project runs retain distinct webhook URLs instead of using the last cwd", async () => {
  const manager = fakeManager();
  const fetch = vi.fn(async (_input: string | URL | Request) => new Response("ok", { status: 200 }));
  const runOpenSpec = vi.fn(async (args: readonly string[], options: { cwd: string }) => {
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: options.cwd } }), stderr: "", truncated: false };
    if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ changeName: "change-a", isComplete: true }), stderr: "", truncated: false };
    return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
  });
  const readText = vi.fn(async (path: string) => path.endsWith("SKILL.md")
    ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n"
    : "Implement tasks from an OpenSpec change");
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: "/home", bundledAgentsDir: "/agents", manager: manager as never, runOpenSpec, readText,
    resolveWebhook: (cwd) => ({
      config: { url: `https://${cwd.slice(1)}.example/hook`, auth: { mode: "none" } },
      notifications: { change: true },
      fetch: fetch as never,
    }),
  });
  const ctx = (cwd: string) => ({ captain: true, cwd, modelRegistry: modelRegistry as never });

  const a = await runtime.execute({ action: "begin_change", changeId: "change-a" }, ctx("/project-a")) as { runId: string };
  const b = await runtime.execute({ action: "begin_change", changeId: "change-a" }, ctx("/project-b")) as { runId: string };
  await Promise.all([
    runtime.execute({ action: "report_terminal", changeId: "change-a", runId: b.runId, status: "failed", summary: "B" }, ctx("/project-b")),
    runtime.execute({ action: "report_terminal", changeId: "change-a", runId: a.runId, status: "failed", summary: "A" }, ctx("/project-a")),
  ]);
  await runtime.shutdown();

  expect(fetch.mock.calls.map((call) => call[0]).sort()).toEqual([
    "https://project-a.example/hook",
    "https://project-b.example/hook",
  ]);
});

test("advancing actions use official OpenSpec checks in the active cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-extension-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const agents = join(root, "agents");
  await mkdir(join(home, ".pi", "agent", "horsepower"), { recursive: true });
  await mkdir(join(project, ".pi", "horsepower"), { recursive: true });
  await mkdir(agents, { recursive: true });
  const slots = JSON.stringify({ slots: {
    judgment: { model: "provider/model", thinking: "high" },
    craft: { model: "provider/model", thinking: "high" },
    utility: { model: "provider/model", thinking: "off" },
  } });
  await writeFile(join(home, ".pi", "agent", "horsepower", "model-slots.json"), slots);
  await writeFile(join(agents, "coder.md"), "---\nname: coder\nrole: Code\nrecommendedSlots: [craft]\ntools: [read]\nstandards: []\n---\nCode only.\n");
  const manager = fakeManager();
  manager.create.mockResolvedValue({ workerId: "worker-1" });
  const calls: Array<{ args: readonly string[]; cwd: string }> = [];
  const runOpenSpec = vi.fn(async (args: readonly string[], options: { cwd: string }) => {
    calls.push({ args, cwd: options.cwd });
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: project } }), stderr: "", truncated: false };
    if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ changeName: "change-a", isComplete: true }), stderr: "", truncated: false };
    return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
  });
  const readText = vi.fn(async (path: string) => {
    if (path.endsWith("SKILL.md")) return "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n";
    if (path.endsWith("opsx-apply.md")) return "Implement tasks from an OpenSpec change";
    return (await import("node:fs/promises")).readFile(path, "utf8");
  });
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({ homeDir: home, bundledAgentsDir: agents, manager: manager as never, runOpenSpec, readText });

  await runtime.execute({ action: "create", changeId: "change-a", cwd: "/stale", name: "w", agent: "coder", modelSlot: "craft" }, {
    captain: true, cwd: project, modelRegistry: modelRegistry as never,
  });

  expect(calls.map((call) => call.args[0])).toEqual(["--version", "doctor", "status", "validate"]);
  expect(calls.every((call) => call.cwd === project)).toBe(true);
  expect(manager.create).toHaveBeenCalledWith(expect.objectContaining({ cwd: project, name: "w" }));
});
