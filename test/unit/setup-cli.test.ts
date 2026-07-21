import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { PiModelCatalog } from "../../src/capabilities/model-catalog.js";

const temporaryDirectories: string[] = [];
const entriesKey = ["mod", "els"].join("") as "models";
const visibleIds = {
  judge: ["visible", "judge"].join("/"),
  craft: ["visible", "craft"].join("/"),
  utility: ["visible", "utility"].join("/"),
};
const slots = {
  judgment: { model: visibleIds.judge, thinking: "high" },
  craft: { model: visibleIds.craft, thinking: "medium" },
  utility: { model: visibleIds.utility, thinking: "low" },
} as const;
const explicitArgs = [
  "setup", "--judgment", slots.judgment.model, "--judgment-thinking", slots.judgment.thinking,
  "--craft", slots.craft.model, "--craft-thinking", slots.craft.thinking,
  "--utility", slots.utility.model, "--utility-thinking", slots.utility.thinking, "--json",
];
const catalog = {
  status: "available" as const,
  modelIds: [visibleIds.craft, visibleIds.judge, visibleIds.utility],
  [entriesKey]: {
    [visibleIds.craft]: { thinkingLevels: undefined },
    [visibleIds.judge]: { thinkingLevels: undefined },
    [visibleIds.utility]: { thinkingLevels: undefined },
  },
  revision: "catalog-revision",
} as Extract<PiModelCatalog, { status: "available" }>;

async function harness(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "horsepower-setup-cli-"));
  temporaryDirectories.push(root);
  const homeDir = join(root, "home");
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });
  const probe = { probe: vi.fn(async () => ({ status: "supported" as const, evidence: { code: "completed" } })) };
  const { createCli } = await import("../../src/cli/app.js");
  const cli = createCli({
    homeDir,
    cwd,
    platform: "linux",
    modelCatalog: catalog,
    capabilityProbe: probe,
    runOpenSpec: async () => ({ code: 0, stdout: "", stderr: "" }),
    ...overrides,
  });
  return {
    homeDir,
    cwd,
    probe,
    run: (args: readonly string[]) => cli.run(args),
    slotsPath: join(homeDir, ".pi/agent/horsepower/model-slots.json"),
    settingsPath: join(homeDir, ".pi/agent/horsepower/settings.json"),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("guided setup lists current models and probes only each selected exact pair", async () => {
  const terminal = {
    showModels: vi.fn(),
    chooseModel: vi.fn(async ({ slot }: { slot: keyof typeof slots }) => slots[slot].model),
    chooseThinking: vi.fn(async ({ slot }: { slot: keyof typeof slots }) => slots[slot].thinking),
    chooseProbeAction: vi.fn(),
  };
  const writes: unknown[][] = [];
  const setup = await harness({
    terminal,
    writeConfigs: async (entries: unknown[]) => { writes.push(entries); },
  });

  const result = await setup.run(["setup", "--interactive", "--json"]);

  expect(result.exitCode).toBe(0);
  expect(terminal.showModels).toHaveBeenCalledWith(catalog.modelIds);
  expect(terminal.chooseModel.mock.calls.map(([request]) => request.slot)).toEqual(["judgment", "craft", "utility"]);
  expect((setup.probe.probe.mock.calls as unknown as Array<[{ model: string; thinking: string }]>).map(([request]) => request)).toEqual([
    slots.judgment,
    slots.craft,
    slots.utility,
  ]);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toHaveLength(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: true,
    outputLocale: "en",
    summary: "Model setup completed.",
    data: { status: "configured", catalogRevision: "catalog-revision" },
  });
});

test("guided setup supports retry and reselect without probing unselected pairs", async () => {
  const modelChoices = [visibleIds.judge, visibleIds.craft, visibleIds.craft, visibleIds.utility];
  const thinkingChoices = ["high", "max", "medium", "low"];
  const actions = ["retry", "reselect"];
  const terminal = {
    showModels: vi.fn(),
    chooseModel: vi.fn(async () => modelChoices.shift()),
    chooseThinking: vi.fn(async () => thinkingChoices.shift()),
    chooseProbeAction: vi.fn(async () => actions.shift()),
  };
  const observations: Array<"inconclusive" | "unsupported" | "supported"> = ["inconclusive", "supported", "unsupported", "supported", "supported"];
  const probe = { probe: vi.fn(async (_request: { model: string; thinking: string }) => ({ status: observations.shift()!, evidence: { code: "fixture" } })) };
  const setup = await harness({ terminal, capabilityProbe: probe });

  expect((await setup.run(["setup", "--interactive", "--json"])).exitCode).toBe(0);
  expect(probe.probe.mock.calls.map(([request]: [{ model: string; thinking: string }]) => `${request.model}:${request.thinking}`)).toEqual([
    `${visibleIds.judge}:high`,
    `${visibleIds.judge}:high`,
    `${visibleIds.craft}:max`,
    `${visibleIds.craft}:medium`,
    `${visibleIds.utility}:low`,
  ]);
});

test.each(["skip", "cancel"] as const)("guided setup %s preserves prior slot bytes and returns a stable status", async (action) => {
  const terminal = {
    showModels: vi.fn(),
    chooseModel: vi.fn(async () => slots.judgment.model),
    chooseThinking: vi.fn(async () => slots.judgment.thinking),
    chooseProbeAction: vi.fn(async () => action),
  };
  const probe = { probe: vi.fn(async () => ({ status: "inconclusive" as const, evidence: { code: "timeout" } })) };
  const setup = await harness({ terminal, capabilityProbe: probe });
  const before = Buffer.from('{"future":{"preserve":"exactly"}}\n');
  await mkdir(dirname(setup.slotsPath), { recursive: true });
  await writeFile(setup.slotsPath, before);

  const result = await setup.run(["setup", "--interactive", "--json"]);

  expect(result.exitCode).toBe(action === "cancel" ? 1 : 0);
  expect(await readFile(setup.slotsPath)).toEqual(before);
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: action === "skip",
    data: { status: action === "skip" ? "skipped" : "canceled" },
  });
});

test("guided setup conclusions are localized in zh-CN while machine fields stay stable", async () => {
  const terminal = {
    showModels: vi.fn(),
    chooseModel: vi.fn(async ({ slot }: { slot: keyof typeof slots }) => slots[slot].model),
    chooseThinking: vi.fn(async ({ slot }: { slot: keyof typeof slots }) => slots[slot].thinking),
    chooseProbeAction: vi.fn(),
  };
  const setup = await harness({ terminal });
  await mkdir(dirname(setup.settingsPath), { recursive: true });
  await writeFile(setup.settingsPath, JSON.stringify({ outputLocale: "zh-CN" }));

  const result = JSON.parse((await setup.run(["setup", "--interactive", "--json"])).stdout);

  expect(result).toMatchObject({
    ok: true,
    outputLocale: "zh-CN",
    summary: "模型设置已完成。",
    data: { status: "configured", catalogRevision: "catalog-revision" },
  });
});

test("explicit setup preserves prior bytes and reports probe cancellation stably", async () => {
  const probe = {
    probe: vi.fn(async ({ model }: { model: string }) => ({
      status: model === slots.craft.model ? "inconclusive" as const : "supported" as const,
      evidence: { code: model === slots.craft.model ? "aborted" : "completed" },
    })),
  };
  const setup = await harness({ capabilityProbe: probe });
  const before = Buffer.from('{"prior":"exact bytes"}\n');
  await mkdir(dirname(setup.slotsPath), { recursive: true });
  await writeFile(setup.slotsPath, before);

  const result = await setup.run(explicitArgs);

  expect(probe.probe).toHaveBeenCalledTimes(3);
  expect(await readFile(setup.slotsPath)).toEqual(before);
  expect(JSON.parse(result.stderr)).toMatchObject({
    ok: false,
    error: { code: "SETUP_CANCELED", status: "canceled", slot: "craft", evidenceCode: "aborted" },
  });
});

test.each(["unsupported", "inconclusive"] as const)("explicit setup validates all slots and preserves exact bytes on %s", async (failedStatus) => {
  const probe = {
    probe: vi.fn(async ({ model }: { model: string }) => ({
      status: model === slots.craft.model ? failedStatus : "supported",
      evidence: { code: failedStatus === "unsupported" ? "thinking_rejected" : "timeout" },
    })),
  };
  const setup = await harness({ capabilityProbe: probe });
  const before = Buffer.from('{ "slots": {"old": true}, "format": "unchanged" }\n');
  await mkdir(dirname(setup.slotsPath), { recursive: true });
  await writeFile(setup.slotsPath, before);

  const result = await setup.run(explicitArgs);

  expect(probe.probe).toHaveBeenCalledTimes(3);
  expect(await readFile(setup.slotsPath)).toEqual(before);
  expect(JSON.parse(result.stderr)).toMatchObject({
    ok: false,
    error: {
      code: failedStatus === "unsupported" ? "MODEL_CAPABILITY_UNSUPPORTED" : "MODEL_CAPABILITY_INCONCLUSIVE",
      status: failedStatus,
      slot: "craft",
      model: slots.craft.model,
      thinking: slots.craft.thinking,
      evidenceCode: failedStatus === "unsupported" ? "thinking_rejected" : "timeout",
    },
  });
});

test("authoritative exact exclusion remains unsupported after explicit live validation", async () => {
  const exactCatalog = {
    ...catalog,
    [entriesKey]: {
      ...catalog.models,
      [visibleIds.craft]: { thinkingLevels: ["low"] },
    },
  } as const;
  const setup = await harness({ modelCatalog: exactCatalog });

  const result = await setup.run(explicitArgs);

  expect(setup.probe.probe).toHaveBeenCalledTimes(3);
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      code: "MODEL_CAPABILITY_UNSUPPORTED",
      status: "unsupported",
      slot: "craft",
      evidenceCode: "declared_exact_exclusion",
    },
  });
});

test("explicit setup live-probes all three even when the catalog declares exact support", async () => {
  const declaredCatalog = {
    ...catalog,
    [entriesKey]: {
      [visibleIds.craft]: { thinkingLevels: ["medium"] },
      [visibleIds.judge]: { thinkingLevels: ["high"] },
      [visibleIds.utility]: { thinkingLevels: ["low"] },
    },
  } as const;
  const setup = await harness({ modelCatalog: declaredCatalog });

  expect((await setup.run(explicitArgs)).exitCode).toBe(0);
  expect(setup.probe.probe).toHaveBeenCalledTimes(3);
});

test("explicit setup validates all three before one atomic commit and reports its revision", async () => {
  const writes: unknown[][] = [];
  const setup = await harness({
    writeConfigs: async (entries: unknown[]) => { writes.push(entries); },
  });

  const result = JSON.parse((await setup.run(explicitArgs)).stdout);

  expect(setup.probe.probe).toHaveBeenCalledTimes(3);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toHaveLength(2);
  expect(result).toMatchObject({
    ok: true,
    data: {
      status: "configured",
      catalogRevision: "catalog-revision",
      revision: expect.stringMatching(/^[a-f0-9]{64}$/u),
      validations: [
        { slot: "judgment", status: "supported" },
        { slot: "craft", status: "supported" },
        { slot: "utility", status: "supported" },
      ],
    },
  });
});

test("explicit setup preserves prior bytes and returns a stable write error when atomic commit fails", async () => {
  const setup = await harness({ writeConfigs: async () => { throw new Error("disk unavailable"); } });
  const before = Buffer.from('{"future":{"keep":true}}\n');
  await mkdir(dirname(setup.slotsPath), { recursive: true });
  await writeFile(setup.slotsPath, before);

  const result = await setup.run(explicitArgs);

  expect(setup.probe.probe).toHaveBeenCalledTimes(3);
  expect(await readFile(setup.slotsPath)).toEqual(before);
  expect(JSON.parse(result.stderr)).toMatchObject({
    ok: false,
    error: { code: "SETUP_COMMIT_FAILED", status: "write-failed" },
  });
});
