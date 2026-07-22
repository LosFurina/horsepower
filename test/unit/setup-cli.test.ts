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

test("guided setup trusts Pi-configured models without probing upstream", async () => {
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
  expect(setup.probe.probe).not.toHaveBeenCalled();
  expect(terminal.chooseProbeAction).not.toHaveBeenCalled();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toHaveLength(2);
  expect(JSON.parse(result.stdout)).toMatchObject({
    ok: true,
    outputLocale: "en",
    summary: "Model setup completed.",
    data: { status: "configured", catalogRevision: "catalog-revision" },
  });
});

test("guided setup cancellation before selection preserves prior slot bytes", async () => {
  const terminal = {
    showModels: vi.fn(),
    chooseModel: vi.fn(async () => undefined),
    chooseThinking: vi.fn(),
    chooseProbeAction: vi.fn(),
  };
  const setup = await harness({ terminal });
  const before = Buffer.from('{"future":{"preserve":"exactly"}}\n');
  await mkdir(dirname(setup.slotsPath), { recursive: true });
  await writeFile(setup.slotsPath, before);

  const result = await setup.run(["setup", "--interactive", "--json"]);

  expect(result.exitCode).toBe(1);
  expect(await readFile(setup.slotsPath)).toEqual(before);
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, data: { status: "canceled" } });
  expect(terminal.chooseProbeAction).not.toHaveBeenCalled();
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

test("authoritative exact exclusion remains unsupported without an upstream probe", async () => {
  const exactCatalog = {
    ...catalog,
    [entriesKey]: {
      ...catalog.models,
      [visibleIds.craft]: { thinkingLevels: ["low"] },
    },
  } as const;
  const setup = await harness({ modelCatalog: exactCatalog });

  const result = await setup.run(explicitArgs);

  expect(setup.probe.probe).not.toHaveBeenCalled();
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: {
      code: "MODEL_CAPABILITY_UNSUPPORTED",
      status: "unsupported",
      slot: "craft",
      evidenceCode: "declared_exact_exclusion",
    },
  });
});

test("explicit setup accepts exact declared support without an upstream probe", async () => {
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
  expect(setup.probe.probe).not.toHaveBeenCalled();
});

test("explicit setup validates all three before one atomic commit and reports its revision", async () => {
  const writes: unknown[][] = [];
  const setup = await harness({
    writeConfigs: async (entries: unknown[]) => { writes.push(entries); },
  });

  const result = JSON.parse((await setup.run(explicitArgs)).stdout);

  expect(setup.probe.probe).not.toHaveBeenCalled();
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

  expect(setup.probe.probe).not.toHaveBeenCalled();
  expect(await readFile(setup.slotsPath)).toEqual(before);
  expect(JSON.parse(result.stderr)).toMatchObject({
    ok: false,
    error: { code: "SETUP_COMMIT_FAILED", status: "write-failed" },
  });
});
