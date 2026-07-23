import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createPiModelCatalog } from "../../src/capabilities/model-catalog.js";
import { createCli } from "../../src/cli/app.js";
import type { SetupTerminal } from "../../src/cli/setup.js";
import { createHorsepowerRuntime } from "../../src/extension/runtime.js";
import { createOneShotExecutor } from "../../src/runtime/one-shot.js";
import { createPiJsonRunner } from "../../src/runtime/one-shot-runner.js";
import { PersistentWorkerManager } from "../../src/runtime/persistent-manager.js";
import { createPersistentWorkerStarter } from "../../src/runtime/persistent-worker-connection.js";
import { createPiCapabilityProbe } from "../../src/runtime/pi-capability-probe.js";

const fixtureExecutable = resolve(import.meta.dirname, "../fixtures/pi-local-capability.mjs");
const roots: string[] = [];
const genericId = ["provider", "model"].join("/");

interface FixtureState {
  acceptedThinking: string[];
  rejectNextOneShot?: boolean;
  rejectNextPersistent?: boolean;
}

interface FixtureEvent {
  kind: "probe" | "one-shot" | "persistent";
  thinking: string;
}

async function localFixture(state: FixtureState) {
  const root = await mkdtemp(join(tmpdir(), "horsepower-live-capability-"));
  roots.push(root);
  const statePath = join(root, "state.json");
  const logPath = join(root, "events.ndjson");
  await writeFile(statePath, JSON.stringify(state));
  await chmod(fixtureExecutable, 0o755);
  const environment = { ...process.env, HORSEPOWER_FIXTURE_STATE: statePath, HORSEPOWER_FIXTURE_LOG: logPath };
  const spawnFixture = (_command: string, args: readonly string[], options: SpawnOptionsWithoutStdio) =>
    spawn(process.execPath, [fixtureExecutable, ...args], options) as ChildProcessWithoutNullStreams;
  return {
    root,
    probe: createPiCapabilityProbe({ executable: fixtureExecutable, environment, spawnProcess: spawnFixture }),
    oneShot: createOneShotExecutor({ run: createPiJsonRunner({ executable: fixtureExecutable, environment, temporaryRoot: root, spawnProcess: spawnFixture }) }),
    manager: new PersistentWorkerManager({ startWorker: createPersistentWorkerStarter({ executable: fixtureExecutable, environment, temporaryRoot: root, spawnProcess: spawnFixture }) }),
    async set(patch: Partial<FixtureState>) {
      const current = JSON.parse(await readFile(statePath, "utf8")) as FixtureState;
      await writeFile(statePath, JSON.stringify({ ...current, ...patch }));
    },
    async events(): Promise<FixtureEvent[]> {
      const text = await readFile(logPath, "utf8").catch(() => "");
      return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line) as FixtureEvent) : [];
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("interactive setup accepts Pi-configured choices without probing upstream", async () => {
  const fixture = await localFixture({ acceptedThinking: ["high"] });
  const home = join(fixture.root, "home");
  const project = join(fixture.root, "project");
  await mkdir(project, { recursive: true });
  const choices = ["max", "high", "high"] as const;
  let choice = 0;
  const terminal: SetupTerminal = {
    showModels: async (ids) => expect(ids).toEqual([genericId]),
    chooseModel: async () => genericId,
    chooseThinking: async () => choices[choice++],
    chooseProbeAction: async () => { throw new Error("setup must not request probe remediation"); },
  };
  const registry = { getAll: () => [{ provider: genericId.split("/")[0]!, id: genericId.split("/")[1]!, reasoning: true }] };
  const cli = createCli({
    homeDir: home,
    cwd: project,
    platform: process.platform,
    modelCatalog: createPiModelCatalog(registry),
    capabilityProbe: fixture.probe,
    terminal,
    runOpenSpec: async () => ({ code: 0, stdout: "", stderr: "" }),
  });

  const result = await cli.run(["setup", "--interactive", "--json"]);

  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { status: "configured" } });
  const configured = JSON.parse(await readFile(join(home, ".pi", "agent", "horsepower", "model-slots.json"), "utf8"));
  expect(Object.values(configured.slots)).toEqual([
    { model: genericId, thinking: "max" },
    { model: genericId, thinking: "high" },
    { model: genericId, thinking: "high" },
  ]);
  expect(await fixture.events()).toEqual([]);
});

async function runtimeHarness() {
  const fixture = await localFixture({ acceptedThinking: ["high"] });
  const home = join(fixture.root, "home");
  const project = join(fixture.root, "project");
  const agents = join(fixture.root, "agents");
  await mkdir(join(home, ".pi", "agent", "horsepower"), { recursive: true });
  await mkdir(project, { recursive: true });
  await mkdir(agents, { recursive: true });
  const binding = { model: genericId, thinking: "high" };
  await writeFile(join(home, ".pi", "agent", "horsepower", "model-slots.json"), JSON.stringify({ slots: {
    judgment: binding, craft: binding, utility: binding,
  } }));
  await writeFile(join(agents, "coder.md"), "---\nname: coder\nrole: Code\ntools: []\nstandards: []\n---\nWork only.\n");
  const runOpenSpec = async (args: readonly string[]) => {
    if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "", truncated: false };
    if (args[0] === "doctor") return { code: 0, stdout: JSON.stringify({ root: { healthy: true, path: project } }), stderr: "", truncated: false };
    if (args[0] === "status") return { code: 0, stdout: JSON.stringify({ changeName: "change-a", isComplete: true }), stderr: "", truncated: false };
    return { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "", truncated: false };
  };
  const readText = async (path: string) => path.endsWith("SKILL.md")
    ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0\n"
    : path.endsWith("opsx-apply.md") ? "Implement tasks from an OpenSpec change" : readFile(path, "utf8");
  const runtime = createHorsepowerRuntime({
    homeDir: home,
    bundledAgentsDir: agents,
    manager: fixture.manager,
    oneShot: fixture.oneShot,
    capabilityProbe: fixture.probe,
    runOpenSpec,
    readText,
    loadTaskInventory: async () => ({
      changeId: "change-a", projectRoot: project, digest: "a".repeat(64),
      sections: [{ id: "1", title: "Capability", tasks: Array.from({ length: 7 }, (_, index) => ({ id: `1.${index + 1}`, description: `Capability ${index + 1}`, status: "pending" as const, sectionId: "1" })) }],
    }),
    loadTestAndGatePlan: async () => ({
      changeId: "change-a", testIntensity: "targeted", gateStrictness: "required", digest: "c".repeat(64), coverageRefs: [], nonApplicability: [],
      cases: Array.from({ length: 7 }, (_, index) => ({ id: `TC-${index + 1}`, title: `Capability ${index + 1}`, maps: [`task:1.${index + 1}`], level: "e2e" as const, purpose: "Exercise capability", preconditions: "Live model fixture", action: "Dispatch", expected: "Supported", failure: "Capability mismatch", disposition: "required" as const })),
      gates: [{ id: "G-1", title: "Live gate", maps: Array.from({ length: 7 }, (_, index) => `task:1.${index + 1}`), intent: "Run live capability acceptance", scope: "Selected capability tasks", pass: "All expected outcomes observed", disposition: "required", phase: "completion", waiver: "none", floor: "e2e" }],
    }),
  });
  const scopes = Array.from({ length: 7 }, (_, index) => `1.${index + 1}`);
  const campaign = await runtime.beginImplementationCampaign({
    changeId: "change-a", projectId: project, selectedTaskIds: scopes,
    selectedTasks: scopes.map((id) => ({ id, description: `Capability ${id.split(".")[1]}`, status: "pending" as const, sectionId: "1" })),
    inventoryDigest: "a".repeat(64), planDigest: "c".repeat(64), mode: "multi_agent",
  });
  let revisionFlag = false;
  const context = {
    captain: true,
    cwd: project,
    modelRegistry: { getAll: () => [{
      provider: genericId.split("/")[0]!, id: genericId.split("/")[1]!, reasoning: revisionFlag,
      thinkingLevelMap: { high: "high" },
    }] } as never,
  };
  const common = {
    changeId: "change-a", agent: "coder", modelSlot: "craft", handoffMode: "inline",
    implementationCampaignId: campaign.campaignId, workKind: "implementation",
  } as const;
  return { fixture, runtime, context, common, setRevision: () => { revisionFlag = true; } };
}

test("one-shot and persistent workers do not preflight upstream across revisions", async () => {
  const { fixture, runtime, context, common, setRevision } = await runtimeHarness();
  await runtime.execute({ action: "single", ...common, taskScope: "1.1", name: "first", task: "first" }, context);
  await runtime.execute({ action: "create", ...common, taskScope: "1.2", name: "persistent" }, context);
  setRevision();
  await runtime.execute({ action: "single", ...common, taskScope: "1.3", name: "second", task: "second" }, context);

  expect((await fixture.events()).map(({ kind, thinking }) => `${kind}:${thinking}`)).toEqual([
    "one-shot:high", "persistent:high", "one-shot:high",
  ]);
  await runtime.shutdown();
});

test("explicit worker rejections invalidate evidence and never retry with downgraded thinking", async () => {
  const { fixture, runtime, context, common } = await runtimeHarness();
  await runtime.execute({ action: "single", ...common, taskScope: "1.1", name: "fresh", task: "fresh" }, context);

  await fixture.set({ rejectNextOneShot: true });
  await expect(runtime.execute({ action: "single", ...common, taskScope: "1.4", name: "rejected", task: "reject" }, context))
    .resolves.toMatchObject({ status: "failed", failure: { code: "MODEL_CAPABILITY_FAILED" } });
  await runtime.execute({ action: "single", ...common, taskScope: "1.5", name: "after-one", task: "after" }, context);

  await fixture.set({ rejectNextPersistent: true });
  await expect(runtime.execute({ action: "create", ...common, taskScope: "1.6", name: "rpc-rejected" }, context))
    .resolves.toMatchObject({ status: "failed", failure: { code: "MODEL_CAPABILITY_FAILED" } });
  await runtime.execute({ action: "create", ...common, taskScope: "1.7", name: "rpc-after" }, context);

  const events = await fixture.events();
  expect(events.map(({ kind, thinking }) => `${kind}:${thinking}`)).toEqual([
    "one-shot:high",
    "one-shot:high", "one-shot:high",
    "persistent:high", "persistent:high",
  ]);
  expect(events.every(({ thinking }) => thinking === "high")).toBe(true);
  await runtime.shutdown();
});
