import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
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

function campaignSelection(ids: readonly string[]) {
  return {
    selectedTaskIds: [...ids],
    selectedTasks: ids.map((id) => ({ id, description: `Task ${id}`, status: "pending" as const, sectionId: id.split(".")[0]! })),
    inventoryDigest: "a".repeat(64),
    planDigest: "c".repeat(64),
  };
}
function taskInventory(projectRoot: string, ids: readonly string[]) {
  return async ({ changeId }: { changeId: string }) => ({
    changeId, projectRoot, digest: "a".repeat(64),
    sections: [{ id: "1", title: "Tasks", tasks: ids.map((id) => ({ id, description: `Task ${id}`, status: "pending" as const, sectionId: id.split(".")[0]! })) }],
  });
}
function planFixture(ids: readonly string[], digest = "c".repeat(64)) {
  return {
    changeId: "change-a",
    testIntensity: "standard" as const,
    gateStrictness: "required" as const,
    cases: ids.map((id, index) => ({
      id: `TC-${index + 1}`,
      title: `Case for ${id}`,
      maps: [`task:${id}`],
      level: "unit" as const,
      purpose: `Prove task ${id}`,
      preconditions: "fixture",
      action: "exercise",
      expected: "pass",
      failure: "fail",
      disposition: "required" as const,
    })),
    gates: [{
      id: "G-1",
      title: "OpenSpec",
      maps: ids.map((id) => `task:${id}`),
      intent: "openspec validate --strict",
      scope: "selected change",
      pass: "exit 0",
      disposition: "required" as const,
      phase: "campaign" as const,
      waiver: "none",
      floor: "openspec" as const,
    }],
    nonApplicability: [] as Array<{ id: string; title: string; covers: string[]; reason: string }>,
    coverageRefs: ids.map((id) => `task:${id}`),
    digest,
  };
}
function loadPlan(ids: readonly string[], digest = "c".repeat(64)) {
  return async () => planFixture(ids, digest);
}

const modelRegistry = {
  getAll: () => [{
    provider: "provider", id: "model", reasoning: true,
    thinkingLevelMap: { off: "off", high: "high" },
  }],
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
    action: "create", handoffMode: "inline", changeId: "change-a", cwd: "/stale", name: "w", agent: "coder", modelSlot: "craft",
  }, { captain: true, cwd: "/active/project", modelRegistry: modelRegistry as never }))
    .rejects.toThrow("Official OpenSpec CLI was not found");
  expect(runOpenSpec).toHaveBeenCalledWith(["--version"], { cwd: "/active/project" });
});

test("campaign creation binds only to a resolved existing OpenSpec change", async () => {
  const runOpenSpec = vi.fn(async (args: readonly string[], options: { cwd: string }) => {
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: options.cwd } }), stderr: "", truncated: false };
    if (args[0] === "status" && args[2] === "real-change") return { code: 0, stdout: JSON.stringify({ changeName: "real-change", isComplete: true }), stderr: "", truncated: false };
    if (args[0] === "validate" && args[1] === "real-change") return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
    return { code: 1, stdout: "", stderr: "Change not found", truncated: false };
  });
  const readText = vi.fn(async (path: string) => path.endsWith("SKILL.md")
    ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n"
    : "Implement tasks from an OpenSpec change");
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: "/missing-home", bundledAgentsDir: "/missing-agents", runOpenSpec, readText,
    loadTaskInventory: taskInventory("/project", ["1.1"]),
    loadTestAndGatePlan: loadPlan(["1.1"]),
  });

  await expect(runtime.beginImplementationCampaign({
    changeId: "你来决定", projectId: "/project", ...campaignSelection(["1.1"]), mode: "multi_agent",
  })).rejects.toThrow();
  await expect(runtime.beginImplementationCampaign({
    changeId: "real-change", projectId: "/project", ...campaignSelection(["1.1"]), mode: "multi_agent",
  })).resolves.toMatchObject({ changeId: "real-change" });
});

test("shares process-local capability evidence across one-shot and persistent creation", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-capability-gate-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const agents = join(root, "agents");
  await mkdir(join(home, ".pi", "agent", "horsepower"), { recursive: true });
  await mkdir(agents, { recursive: true });
  await writeFile(join(home, ".pi", "agent", "horsepower", "model-slots.json"), JSON.stringify({ slots: {
    judgment: { model: "provider/model", thinking: "high" },
    craft: { model: "provider/model", thinking: "high" },
    utility: { model: "provider/model", thinking: "off" },
  } }));
  await writeFile(join(agents, "coder.md"), "---\nname: coder\nrole: Code\ntools: []\nstandards: []\n---\nCode only.\n");
  const manager = fakeManager();
  manager.create.mockResolvedValue({ workerId: "worker-1" });
  const oneShot = {
    single: vi.fn(async (input) => ({ name: input.name, text: "done" })),
    parallel: vi.fn(), chain: vi.fn(),
  };
  const capabilityProbe = { probe: vi.fn(async () => ({ status: "supported" as const, evidence: { code: "accepted" } })) };
  const runOpenSpec = vi.fn(async (args: readonly string[], options: { cwd: string }) => {
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: options.cwd } }), stderr: "", truncated: false };
    if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ changeName: "change-a", isComplete: true }), stderr: "", truncated: false };
    return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
  });
  const readText = vi.fn(async (path: string) => path.endsWith("SKILL.md")
    ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n"
    : path.endsWith("opsx-apply.md") ? "Implement tasks from an OpenSpec change" : (await import("node:fs/promises")).readFile(path, "utf8"));
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: home, bundledAgentsDir: agents, manager: manager as never, runOpenSpec, readText,
    oneShot: oneShot as never, capabilityProbe, loadTaskInventory: taskInventory(project, ["1.1", "1.2"]),
    loadTestAndGatePlan: loadPlan(["1.1", "1.2"]),
  });
  const campaign = await runtime.beginImplementationCampaign({ changeId: "change-a", projectId: project, ...campaignSelection(["1.1", "1.2"]), mode: "multi_agent" });
  const common = { changeId: "change-a", agent: "coder", modelSlot: "craft", implementationCampaignId: campaign.campaignId, workKind: "implementation" };
  const context = {
    captain: true,
    cwd: project,
    modelRegistry: modelRegistry as never,
  };

  await runtime.execute({ action: "single", handoffMode: "inline", ...common, taskScope: "1.1", name: "one", task: "work" }, context);
  await runtime.execute({ action: "create", handoffMode: "inline", ...common, taskScope: "1.2", name: "two" }, context);

  expect(capabilityProbe.probe).not.toHaveBeenCalled();
  expect(oneShot.single).toHaveBeenCalledTimes(1);
  expect(manager.create).toHaveBeenCalledTimes(1);
  await runtime.shutdown();
});

test("dispatch revalidates selected task snapshot before worker side effects while ignoring unselected drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-task-drift-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const agents = join(root, "agents");
  await mkdir(join(home, ".pi", "agent", "horsepower"), { recursive: true });
  await mkdir(agents, { recursive: true });
  await writeFile(join(home, ".pi", "agent", "horsepower", "model-slots.json"), JSON.stringify({ slots: {
    judgment: { model: "provider/model", thinking: "high" }, craft: { model: "provider/model", thinking: "high" }, utility: { model: "provider/model", thinking: "off" },
  } }));
  await writeFile(join(agents, "coder.md"), "---\nname: coder\nrole: Code\ntools: []\nstandards: []\n---\nCode only.\n");
  const runOpenSpec = vi.fn(async (args: readonly string[]) => args[0] === "--version"
    ? { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false }
    : args[0] === "doctor" ? { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: project } }), stderr: "", truncated: false }
      : args[0] === "status" ? { code: 0, stdout: JSON.stringify({ changeName: "change-a", isComplete: true }), stderr: "", truncated: false }
        : { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false });
  const readText = vi.fn(async (path: string) => path.endsWith("SKILL.md")
    ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n"
    : path.endsWith("opsx-apply.md") ? "Implement tasks from an OpenSpec change" : (await import("node:fs/promises")).readFile(path, "utf8"));
  let selected = { id: "1.1", description: "Task 1.1", status: "pending" as "pending" | "complete", sectionId: "1" };
  let unrelated = { id: "9.9", description: "Unrelated", status: "pending" as const, sectionId: "9" };
  const loadTaskInventory = async () => ({ changeId: "change-a", projectRoot: project, digest: "a".repeat(64), sections: [
    { id: "1", title: "Selected", tasks: [selected] }, { id: "9", title: "Other", tasks: [unrelated] },
  ] });
  const oneShot = { single: vi.fn(async (input) => ({ name: input.name, text: "done" })), parallel: vi.fn(), chain: vi.fn() };
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({ homeDir: home, bundledAgentsDir: agents, runOpenSpec, readText, loadTaskInventory, loadTestAndGatePlan: loadPlan(["1.1"]), oneShot: oneShot as never });
  const campaign = await runtime.beginImplementationCampaign({ changeId: "change-a", projectId: project, ...campaignSelection(["1.1"]), mode: "multi_agent" });
  const context = { captain: true, cwd: project, modelRegistry: modelRegistry as never };
  const input = { action: "single", handoffMode: "inline", changeId: "change-a", agent: "coder", modelSlot: "craft", task: "work", taskScope: "1.1", workKind: "implementation", implementationCampaignId: campaign.campaignId };

  unrelated = { ...unrelated, description: "Changed unrelated" };
  await expect(runtime.execute({ ...input, name: "allowed" }, context)).resolves.toMatchObject({ status: "completed" });
  selected = { ...selected, status: "complete" };
  await expect(runtime.execute({ ...input, name: "blocked" }, context)).rejects.toThrow("Selected OpenSpec task drifted: 1.1");
  expect(oneShot.single).toHaveBeenCalledTimes(1);
  await runtime.shutdown();
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
  await writeFile(join(agents, "coder.md"), "---\nname: coder\nrole: Code\ntools: [read]\nstandards: []\n---\nCode only.\n");
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
    loadTaskInventory: taskInventory(project, ["1.1"]),
    loadTestAndGatePlan: loadPlan(["1.1"]),
  });

  const campaign = await runtime.beginImplementationCampaign({ changeId: "change-a", projectId: project, ...campaignSelection(["1.1"]), mode: "multi_agent" });
  await runtime.execute({
    action: "create", handoffMode: "inline", changeId: "change-a", name: "w", agent: "coder", modelSlot: "craft",
    implementationCampaignId: campaign.campaignId, taskScope: "1.1", workKind: "implementation",
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
  const snapshotRuns: string[] = [];
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: "/home", bundledAgentsDir: "/agents", manager: manager as never, runOpenSpec, readText,
    loadTaskInventory: taskInventory("/project", ["1.1", "1.2"]),
    loadTestAndGatePlan: loadPlan(["1.1", "1.2"]),
    acceptanceSnapshot: async ({ runId }) => {
      snapshotRuns.push(runId);
      return { digest: "scope-digest", refs: ["task:1.1"], plannedChecks: [] };
    },
  });
  await runtime.beginImplementationCampaign({
    changeId: "change-a", projectId: "/project", ...campaignSelection(["1.1"]), mode: "multi_agent",
  });
  const ctx = { captain: true, cwd: "/project", modelRegistry: modelRegistry as never };

  const begun = await runtime.execute({ action: "begin_change", changeId: "change-a" }, ctx) as { runId: string; startedAt: string };
  await expect(runtime.execute({
    action: "report_terminal", changeId: "change-b", runId: begun.runId,
    status: "failed", summary: "wrong change",
  }, ctx)).rejects.toThrow(`Run ${begun.runId} belongs to change change-a, not change-b`);
  await expect(runtime.execute({
    action: "report_terminal", changeId: "change-a", runId: begun.runId,
    status: "completed", summary: "complete",
    verification: {
      observedAt: begun.startedAt,
      commands: [{ id: "focused-1", kind: "e2e", command: "npm test", exitCode: 0, summary: "focused integration test", acceptanceRefs: ["task:1.1"] }],
      acceptance: [{ ref: "task:1.1", evidenceIds: ["focused-1"] }],
      plannedChecks: [
        { ref: "TC-1", evidenceIds: ["focused-1"] },
        { ref: "G-1", evidenceIds: ["focused-1"] },
      ],
    },
  }, ctx)).resolves.toMatchObject({ run: { runId: begun.runId, changeId: "change-a", status: "completed", verification: { scopeDigest: "scope-digest" } } });
  expect(snapshotRuns).toEqual([begun.runId]);
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

test("shutdown waits for an admitted one-shot, terminal notification, then destroys resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-shutdown-order-"));
  const home = join(root, "home");
  const project = join(root, "project");
  const agents = join(root, "agents");
  await mkdir(agents, { recursive: true });
  await writeFile(join(agents, "coder.md"), "---\nname: coder\nrole: Code\ntools: [read]\nstandards: []\n---\nCode only.\n");
  const manager = fakeManager();
  let finishRun!: () => void;
  const run = new Promise<void>((resolve) => { finishRun = resolve; });
  const oneShot = {
    single: vi.fn(async () => {
      await run;
      return { name: "task", text: "done" };
    }),
    parallel: vi.fn(),
    chain: vi.fn(),
  };
  let finishDelivery!: () => void;
  const delivery = new Promise<Response>((resolve) => {
    finishDelivery = () => resolve(new Response("ok", { status: 200 }));
  });
  const fetch = vi.fn(async () => delivery);
  const runOpenSpec = vi.fn(async (args: readonly string[], options: { cwd: string }) => {
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: options.cwd } }), stderr: "", truncated: false };
    if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ changeName: "change-a", isComplete: true }), stderr: "", truncated: false };
    return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
  });
  const readText = vi.fn(async (path: string) => {
    if (path.endsWith("model-slots.json")) return JSON.stringify({ slots: {
      judgment: { model: "provider/model", thinking: "high" },
      craft: { model: "provider/model", thinking: "high" },
      utility: { model: "provider/model", thinking: "off" },
    } });
    if (path.endsWith("SKILL.md")) return "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n";
    if (path.endsWith("opsx-apply.md")) return "Implement tasks from an OpenSpec change";
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  });
  const { createHorsepowerRuntime } = await import("../../src/extension/runtime.js");
  const runtime = createHorsepowerRuntime({
    homeDir: home,
    bundledAgentsDir: agents,
    manager: manager as never,
    runOpenSpec,
    readText,
    oneShot,
    webhook: {
      config: { url: "https://example.invalid/hook", auth: { mode: "none" } },
      notifications: { dispatch: true },
      fetch: fetch as never,
    },
    loadTaskInventory: taskInventory(project, ["1.1"]),
    loadTestAndGatePlan: loadPlan(["1.1"]),
  });
  const ctx = { captain: true, cwd: project, modelRegistry: modelRegistry as never };

  const campaign = await runtime.beginImplementationCampaign({ changeId: "change-a", projectId: project, ...campaignSelection(["1.1"]), mode: "multi_agent" });
  const execution = runtime.execute({
    action: "single", handoffMode: "inline", changeId: "change-a", name: "task", agent: "coder", modelSlot: "craft", task: "work",
    implementationCampaignId: campaign.campaignId, taskScope: "1.1", workKind: "implementation",
  }, ctx);
  await vi.waitFor(() => expect(oneShot.single).toHaveBeenCalledTimes(1));
  const shutdown = runtime.shutdown();
  let shutdownSettled = false;
  void shutdown.then(() => { shutdownSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));

  expect(shutdownSettled).toBe(false);
  expect(manager.destroyAll).not.toHaveBeenCalled();
  await expect(runtime.execute({ action: "list" }, ctx)).rejects.toThrow("Horsepower runtime is closed");

  finishRun();
  await expect(execution).resolves.toMatchObject({ result: { text: "done" } });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  expect(manager.destroyAll).not.toHaveBeenCalled();

  finishDelivery();
  await shutdown;
  expect(manager.destroyAll).toHaveBeenCalledTimes(1);
});

test("shutdown closes new admission but lets an admitted authorization register and settle its run", async () => {
  let releaseVersion!: () => void;
  const versionGate = new Promise<void>((resolve) => { releaseVersion = resolve; });
  const manager = fakeManager();
  const runOpenSpec = vi.fn(async (args: readonly string[], options: { cwd: string }) => {
    if (args[0] === "--version") {
      await versionGate;
      return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    }
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
  });
  const ctx = { captain: true, cwd: "/project", modelRegistry: modelRegistry as never };

  const advancing = runtime.execute({ action: "begin_change", changeId: "change-a" }, ctx);
  await vi.waitFor(() => expect(runOpenSpec).toHaveBeenCalledWith(["--version"], { cwd: "/project" }));
  const firstShutdown = runtime.shutdown();
  const secondShutdown = runtime.shutdown();
  let shutdownSettled = false;
  void firstShutdown.then(() => { shutdownSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  expect(shutdownSettled).toBe(false);
  releaseVersion();

  await expect(advancing).resolves.toMatchObject({ runId: expect.any(String) });
  await Promise.all([firstShutdown, secondShutdown]);
  expect(manager.destroyAll).toHaveBeenCalledTimes(1);
  expect(manager.create).not.toHaveBeenCalled();
  await expect(runtime.execute({ action: "begin_change", changeId: "late" }, ctx))
    .rejects.toThrow("Horsepower runtime is closed");
});

test("change terminal correlation canonicalizes existing symlink project aliases without leaking paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-project-identity-"));
  const project = join(root, "project-a");
  const alias = join(root, "project-alias");
  await mkdir(project);
  await symlink(project, alias);
  const manager = fakeManager();
  const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("ok", { status: 200 }));
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
      config: { url: `https://${cwd === alias ? "alias" : "project"}.example/hook`, auth: { mode: "none" } },
      notifications: { change: true },
      fetch: fetch as never,
    }),
  });
  const ctx = (cwd: string) => ({ captain: true, cwd, modelRegistry: modelRegistry as never });

  const begun = await runtime.execute({ action: "begin_change", changeId: "change-a" }, ctx(alias)) as { runId: string };
  await expect(runtime.execute({
    action: "report_terminal", changeId: "change-a", runId: begun.runId,
    status: "failed", summary: "same project",
  }, ctx(project))).resolves.toMatchObject({ run: { runId: begun.runId, status: "failed" } });
  await runtime.shutdown();

  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]![0]).toBe("https://alias.example/hook");
  expect(JSON.stringify(fetch.mock.calls[0]![1])).not.toContain(project);
  expect(JSON.stringify(fetch.mock.calls[0]![1])).not.toContain(alias);
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
  await writeFile(join(agents, "coder.md"), "---\nname: coder\nrole: Code\ntools: [read]\nstandards: []\n---\nCode only.\n");
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
  const runtime = createHorsepowerRuntime({ homeDir: home, bundledAgentsDir: agents, manager: manager as never, runOpenSpec, readText, loadTaskInventory: taskInventory(project, ["1.1"]),
    loadTestAndGatePlan: loadPlan(["1.1"]) });

  const campaign = await runtime.beginImplementationCampaign({ changeId: "change-a", projectId: project, ...campaignSelection(["1.1"]), mode: "multi_agent" });
  await runtime.execute({
    action: "create", handoffMode: "inline", changeId: "change-a", cwd: "/stale", name: "w", agent: "coder", modelSlot: "craft",
    implementationCampaignId: campaign.campaignId, taskScope: "1.1", workKind: "implementation",
  }, { captain: true, cwd: project, modelRegistry: modelRegistry as never });

  expect(calls.map((call) => call.args[0])).toEqual([
    "--version", "doctor", "status", "validate",
    "--version", "doctor", "status", "validate",
  ]);
  expect(calls.every((call) => call.cwd === project)).toBe(true);
  expect(manager.create).toHaveBeenCalledWith(expect.objectContaining({ cwd: project, name: "w" }));
});
