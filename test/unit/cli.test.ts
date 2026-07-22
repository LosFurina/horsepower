import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";
import { fixtureReleaseEntryPoints as releaseEntryPoints, installManagedFixture, writeFixtureRelease as writeRelease } from "../fixtures/managed-installation.js";

const execFileAsync = promisify(execFile);

const temporaryDirectories: string[] = [];
async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "horsepower-cli-"));
  temporaryDirectories.push(path);
  return path;
}
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const models = {
  "provider/judge": { thinkingLevels: ["high"] },
  "provider/craft": { thinkingLevels: ["medium"] },
  "provider/util": { thinkingLevels: ["low"] },
  "project/craft": { thinkingLevels: ["max"] },
} as const;

async function harness(options: Record<string, unknown> = {}) {
  const root = await temp();
  const homeDir = join(root, "home");
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });
  const { createCli } = await import("../../src/cli/app.js");
  const cli = createCli({
    homeDir,
    cwd,
    platform: "linux",
    models,
    capabilityProbe: { probe: async () => ({ status: "supported", evidence: { code: "fixture_supported" } }) },
    runOpenSpec: async (args: readonly string[]) => {
      if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "" };
      return { code: 0, stdout: JSON.stringify({ root: { path: cwd, healthy: true } }), stderr: "" };
    },
    fetch: async () => new Response(null, { status: 204 }),
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    ...options,
  });
  return { root, homeDir, cwd, run: (args: string[]) => cli.run(args) };
}

const setupArgs = [
  "setup", "--judgment", "provider/judge", "--judgment-thinking", "high",
  "--craft", "provider/craft", "--craft-thinking", "medium",
  "--utility", "provider/util", "--utility-thinking", "low", "--json",
];


test("every command uses its metadata-owned localized completion summary", async () => {
  const { run } = await harness();
  await run(setupArgs);
  const slots = JSON.parse((await run(["slots", "--json"])).stdout);
  expect(slots).toMatchObject({ outputLocale: "en", summary: "slots completed." });
  const configured = JSON.parse((await run(["configure", "--locale", "zh-CN", "--json"])).stdout);
  expect(configured).toMatchObject({ outputLocale: "zh-CN", summary: "输出语言已设置为 zh-CN。" });
});

test("configure --interactive runs the complete ordered journey while locale-only remains compatible", async () => {
  const calls: string[] = [];
  const setupTerminal = {
    chooseLocale: vi.fn(async () => "zh-CN" as const), setLocale: vi.fn((locale: string) => calls.push(`locale:${locale}`)),
    showSkillBoundary: vi.fn(() => calls.push("boundary")), showSkillAudit: vi.fn(() => calls.push("audit")),
    confirmSkillRisk: vi.fn(async () => true), chooseWebhookAction: vi.fn(async () => "skip" as const), readWebhookConfiguration: vi.fn(),
    chooseModelAction: vi.fn(async () => "skip" as const), showConfigurationSummary: vi.fn(() => calls.push("summary")),
    showModels: vi.fn(), chooseModel: vi.fn(), chooseThinking: vi.fn(), chooseProbeAction: vi.fn(),
  };
  const { homeDir, cwd, run } = await harness({
    terminal: setupTerminal, configurationTerminal: setupTerminal,
    resolveSkills: async () => ({ skills: [] }), openSpecVersion: "1.6.0",
  });
  await mkdir(join(cwd, ".pi/horsepower"), { recursive: true });
  await writeFile(join(cwd, ".pi/horsepower/settings.json"), JSON.stringify({ outputLocale: "en" }));

  const complete = JSON.parse((await run(["configure", "--interactive", "--json"])).stdout);

  expect(complete).toMatchObject({
    ok: true, outputLocale: "zh-CN",
    data: { status: "incomplete", locale: { status: "configured", value: "zh-CN" }, webhook: { status: "skipped" } },
  });
  expect(complete.data.modelSetup).toMatchObject({ status: "skipped", followUp: "horsepower setup --interactive" });
  expect(calls).toEqual(["locale:zh-CN", "boundary", "audit", "summary"]);
  expect(JSON.parse(await readFile(join(homeDir, ".pi/agent/horsepower/settings.json"), "utf8"))).toMatchObject({ outputLocale: "zh-CN" });
  expect(await run(["configure", "--locale", "en", "--json"])).toMatchObject({ exitCode: 0 });
});

test("configure --interactive without a terminal changes no configuration", async () => {
  const { homeDir, run } = await harness();
  const result = await run(["configure", "--interactive", "--json"]);
  expect(result).toMatchObject({ exitCode: 2, stdout: "" });
  await expect(readFile(join(homeDir, ".pi/agent/horsepower/settings.json"))).rejects.toThrow();
});

test("unavailable controlling terminal returns localized stable machine evidence", async () => {
  const unavailable = {
    isAvailable: vi.fn(async () => false), chooseLocale: vi.fn(), setLocale: vi.fn(), showSkillBoundary: vi.fn(), showSkillAudit: vi.fn(),
    confirmSkillRisk: vi.fn(), chooseWebhookAction: vi.fn(), readWebhookConfiguration: vi.fn(), chooseModelAction: vi.fn(), showConfigurationSummary: vi.fn(),
    showModels: vi.fn(), chooseModel: vi.fn(), chooseThinking: vi.fn(), chooseProbeAction: vi.fn(),
  };
  const { run } = await harness({ terminal: unavailable, configurationTerminal: unavailable });
  const result = await run(["configure", "--interactive", "--json"]);
  expect(result).toMatchObject({ exitCode: 1, stdout: "" });
  expect(JSON.parse(result.stderr)).toMatchObject({
    error: { code: "CONTROLLING_TERMINAL_UNAVAILABLE", status: "unavailable", evidenceCode: "no_controlling_terminal" },
    outputLocale: "en",
  });
});

test("skill-audit is observation-only with stable JSON, localized human output, and strict options", async () => {
  const writes: unknown[] = [];
  const { cwd, run } = await harness({
    writeConfigs: async (entries: unknown[]) => { writes.push(entries); },
    resolveSkills: async () => ({ skills: [{ path: join(cwd, ".pi/skills/external/SKILL.md"), enabled: true, metadata: { source: "settings", scope: "project", origin: "top-level" } }] }),
  });
  await mkdir(join(cwd, ".pi/skills/external"), { recursive: true });
  await writeFile(join(cwd, ".pi/skills/external/SKILL.md"), "---\nname: external\ndescription: fixture\n---\nprivate body");
  const machine = JSON.parse((await run(["skill-audit", "--json"])).stdout);
  expect(machine).toMatchObject({ ok: true, outputLocale: "en", data: { status: "complete", externalCount: 1, dynamicExtensionsEnumerated: false, skills: [{ name: "external", scope: "project", source: "settings", evidence: "resolved" }] } });
  expect(JSON.stringify(machine)).not.toContain("private body");
  const humanAudit = (await run(["skill-audit"])).stdout;
  expect(humanAudit).toContain("Skill exposure audit: complete");
  expect(humanAudit).toContain("- project/settings: external");
  expect(humanAudit).toContain("Full paths and evidence: horsepower skill-audit --json");
  expect(humanAudit).not.toContain("$PROJECT/.pi/skills/external/SKILL.md");
  let officialPath = "";
  const officialHarness = await harness({ resolveSkills: async () => ({ skills: [{ path: officialPath, enabled: true, metadata: { source: "settings", scope: "project", origin: "top-level" } }] }) });
  officialPath = join(officialHarness.cwd, ".pi/skills/openspec-apply-change/SKILL.md");
  await mkdir(dirname(officialPath), { recursive: true });
  await writeFile(officialPath, '---\nname: openspec-apply-change\ndescription: fixture\nauthor: openspec\ngeneratedBy: "1.6.0"\nallowed-tools: Bash(openspec:*)\n---\n');
  const officialAudit = JSON.parse((await officialHarness.run(["skill-audit", "--json"])).stdout).data;
  expect(officialAudit).toMatchObject({ externalCount: 0, excludedCount: 1 });
  expect((await run(["skill-audit", "--locale", "zh-CN"])).stdout).toContain("技能暴露审计：complete");
  expect((await run(["skill-audit", "--locale", "fr"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["skill-audit", "extra"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["skill-audit", "--bogus"]))).toMatchObject({ exitCode: 2 });
  expect(writes).toEqual([]);

  const zh = await harness({ resolveSkills: async () => ({ skills: [] }) });
  await zh.run(["configure", "--locale", "zh-CN", "--json"]);
  expect((await zh.run(["skill-audit"])).stdout).toContain("技能暴露审计：complete");
});

test("skill-audit does not initialize the extension-backed model catalog", async () => {
  const loadModelCatalog = vi.fn(async () => ({ status: "unavailable" as const, reason: "registry-error" as const }));
  const { run } = await harness({ models: undefined, loadModelCatalog });

  expect((await run(["skill-audit", "--json"])).exitCode).toBe(0);
  expect(loadModelCatalog).not.toHaveBeenCalled();
});

test("strictly parses commands and emits deterministic JSON with stable exit codes", async () => {
  const { run } = await harness();
  expect(await run(["unknown", "--json"])).toEqual({
    exitCode: 2,
    stdout: "",
    stderr: '{"error":{"code":"USAGE","message":"Unknown command: unknown"},"ok":false,"outputLocale":"en","summary":"Unknown command: unknown"}\n',
  });
  expect((await run(setupArgs)).stdout).toBe((await run(setupArgs)).stdout);
  expect((await run(["slots", "--bogus"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["slots", "--json", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["--json", "slots"]))).toMatchObject({ exitCode: 0, stderr: "" });
  expect((await run(["webhook", "--json", "configure", "--url", "https://example.test", "--auth", "none"]))).toMatchObject({ exitCode: 0, stderr: "" });
  expect((await run(["webhook", "configure", "--url", "https://example.test", "--auth", "none", "--change", "--no-change", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["webhook", "configure", "--url", "https://example.test", "--auth", "none", "--dispatch", "--no-dispatch", "--json"]))).toMatchObject({ exitCode: 2 });
  for (const incompatible of [
    ["--auth", "none", "--secret", "secret-byte"],
    ["--auth", "none", "--token", "token-byte"],
    ["--auth", "hmac", "--secret", "secret-byte", "--token", "token-byte"],
    ["--auth", "bearer", "--token", "token-byte", "--secret", "secret-byte"],
  ]) {
    expect((await run(["webhook", "configure", "--url", "https://example.test", ...incompatible, "--json"]))).toMatchObject({ exitCode: 2 });
  }
});

test("CLI help distinguishes complete configuration from model-only setup", async () => {
  const { run } = await harness();
  for (const args of [["--help"], ["configure", "--help"]]) {
    const result = await run(args);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("horsepower configure --interactive");
    expect(result.stdout).toContain("complete locale, Skill, webhook, and model journey");
    expect(result.stdout).toContain("horsepower setup --interactive  # model slots only");
  }
});

test("invalid webhook auth argv never appears in text or JSON diagnostics", async () => {
  const { run } = await harness();
  const supplied = "attacker-secret-auth-bytes";
  for (const argv of [
    ["webhook", "configure", "--url", "https://example.test", "--auth", supplied],
    ["webhook", "configure", "--url", "https://example.test", "--auth", supplied, "--json"],
  ]) {
    const result = await run(argv);
    expect(result.exitCode).toBe(2);
    expect(result.stdout + result.stderr).not.toContain(supplied);
    expect(result.stderr).toContain("Invalid webhook auth mode");
  }
});

test("setup initializes missing private files and later writes preserve unknown fields", async () => {
  const { homeDir, run } = await harness();
  const result = await run(setupArgs);
  expect(result.exitCode).toBe(0);
  const root = join(homeDir, ".pi/agent/horsepower");
  expect((await stat(join(root, "model-slots.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(join(root, "settings.json"))).mode & 0o777).toBe(0o600);
  await writeFile(join(root, "model-slots.json"), JSON.stringify({ future: { keep: true }, slots: JSON.parse(await readFile(join(root, "model-slots.json"), "utf8")).slots }));
  expect((await run(["set", "vision", "--fallback", "utility", "--json"])).exitCode).toBe(0);
  expect(JSON.parse(await readFile(join(root, "model-slots.json"), "utf8"))).toMatchObject({ future: { keep: true }, slots: { vision: { fallback: "utility" } } });
});

test("configure sets global or project output locale with localized structured conclusions", async () => {
  const { run, homeDir: home, cwd } = await harness();
  const chinese = await run(["configure", "--locale", "zh-CN", "--json"]);
  expect(JSON.parse(chinese.stdout)).toMatchObject({ ok: true, outputLocale: "zh-CN", summary: "输出语言已设置为 zh-CN。" });
  expect(JSON.parse(await readFile(join(home, ".pi", "agent", "horsepower", "settings.json"), "utf8"))).toMatchObject({ outputLocale: "zh-CN" });
  const project = await run(["configure", "--locale", "en", "--scope", "project", "--json"]);
  expect(JSON.parse(project.stdout)).toMatchObject({ ok: true, outputLocale: "en", summary: "Output language set to en." });
  expect(JSON.parse(await readFile(join(cwd, ".pi", "horsepower", "settings.json"), "utf8"))).toMatchObject({ outputLocale: "en" });
  const before = await readFile(join(cwd, ".pi", "horsepower", "settings.json"), "utf8");
  expect((await run(["configure", "--locale", "fr", "--scope", "project", "--json"])).exitCode).toBe(2);
  expect(await readFile(join(cwd, ".pi", "horsepower", "settings.json"), "utf8")).toBe(before);
});

test("Chinese doctor localizes every finding and remediation while preserving English raw evidence", async () => {
  const { cwd, run } = await harness();
  await mkdir(join(cwd, ".pi/skills/openspec-apply-change"), { recursive: true });
  await mkdir(join(cwd, ".pi/prompts"), { recursive: true });
  await writeFile(join(cwd, ".pi/skills/openspec-apply-change/SKILL.md"), 'name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: "1.6.0"');
  await writeFile(join(cwd, ".pi/prompts/opsx-apply.md"), "Implement tasks from an OpenSpec change.");
  await run(setupArgs);
  await run(["configure", "--locale", "zh-CN", "--json"]);

  const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;

  expect(checks).toEqual([
    expect.objectContaining({ id: "configuration", status: "ok", message: "模型能力 slot 配置有效。", rawEvidence: expect.stringContaining("Slots revision") }),
    expect.objectContaining({ id: "notification", status: "skipped", message: "Webhook 已禁用。" }),
    expect.objectContaining({ id: "openspec", status: "ok", message: "官方 OpenSpec 运行正常。", rawEvidence: "Official OpenSpec 1.6.0 healthy" }),
    expect.objectContaining({ id: "model-registry", status: "ok", message: "Slot 模型验证通过。" }),
    expect.objectContaining({ id: "installation", status: "error", message: "Horsepower 安装无效。", action: "从官方 release 安装或修复 Horsepower。", rawEvidence: expect.any(String) }),
  ]);
  expect(JSON.stringify(checks)).not.toContain("Run horsepower");
});

test("Chinese CLI doctor and errors use Chinese principal conclusions with stable evidence", async () => {
  const { run } = await harness();
  await run(["configure", "--locale", "zh-CN", "--json"]);
  const doctor = JSON.parse((await run(["doctor", "--json"])).stdout);
  expect(doctor).toMatchObject({ outputLocale: "zh-CN", summary: "Horsepower 诊断已完成。" });
  const failed = JSON.parse((await run(["unknown", "--json"])).stderr);
  expect(failed).toMatchObject({ outputLocale: "zh-CN", summary: "unknown 命令执行失败。", error: { code: "USAGE", rawEvidence: "Unknown command: unknown" } });
});

test("configure transactionally updates selected global bindings", async () => {
  const { run } = await harness();
  await run(setupArgs);
  const changed = await run(["configure", "--craft", "project/craft", "--craft-thinking", "max", "--json"]);
  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout).data.effective).toMatchObject({
    judgment: { model: "provider/judge", thinking: "high" },
    craft: { model: "project/craft", thinking: "max" },
    utility: { model: "provider/util", thinking: "low" },
  });
  expect((await run(["configure", "--craft", "project/craft", "--json"])).exitCode).toBe(2);
});

test("slot mutations validate prospective effective state before one target write", async () => {
  const writes: Array<readonly { path: string; value: Record<string, unknown> }[]> = [];
  const { homeDir, cwd, run } = await harness({
    writeConfigs: async (entries: readonly { path: string; value: Record<string, unknown> }[]) => {
      writes.push(entries);
      const { writeJsonObjects } = await import("../../src/config/json-store.js");
      await writeJsonObjects(entries);
    },
  });
  await run(setupArgs);
  writes.length = 0;
  const globalPath = join(homeDir, ".pi/agent/horsepower/model-slots.json");
  const projectPath = join(cwd, ".pi/horsepower/model-slots.json");
  await mkdir(dirname(projectPath), { recursive: true });
  await writeFile(projectPath, JSON.stringify({ slots: { craft: { fallback: "missing" } } }));
  const before = await readFile(globalPath);

  for (const argv of [
    ["set", "vision", "--fallback", "utility", "--json"],
    ["unset", "utility", "--json"],
    ["configure", "--craft", "project/craft", "--craft-thinking", "max", "--json"],
  ]) {
    expect(await run(argv), argv[0]).toMatchObject({ exitCode: 2 });
    expect(await readFile(globalPath), argv[0]).toEqual(before);
  }
  expect(writes).toEqual([]);

  await writeFile(projectPath, JSON.stringify({ slots: {} }));
  expect(await run(["set", "vision", "--fallback", "utility", "--json"])).toMatchObject({ exitCode: 0 });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toHaveLength(1);
  expect(writes[0]![0]!.path).toBe(globalPath);
});

test("slot set/unset validates through the registry and reports deterministic precedence/revision", async () => {
  const { run } = await harness();
  await run(setupArgs);
  expect((await run(["set", "craft", "--model", "project/craft", "--thinking", "max", "--scope", "project", "--json"])).exitCode).toBe(0);
  const listed = JSON.parse((await run(["slots", "--json"])).stdout);
  expect(listed.data.effective.craft).toEqual({ model: "project/craft", thinking: "max" });
  expect(listed.data.resolved.craft).toMatchObject({ requestedSlot: "craft", resolvedSlot: "craft", model: "project/craft", thinking: "max" });
  expect(listed.data.revision).toMatch(/^[a-f0-9]{64}$/u);
  expect((await run(["set", "Bad Slot", "--fallback", "utility", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["set", "vision", "--model", "missing/model", "--thinking", "low", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["set", "vision", "--model", "provider/util", "--thinking", "extreme", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["configure", "--utility", "missing/model", "--utility-thinking", "low", "--json"]))).toMatchObject({ exitCode: 2 });
  const invalidSetup = [...setupArgs];
  invalidSetup[invalidSetup.indexOf("high")] = "extreme";
  expect((await run(invalidSetup)).exitCode).toBe(2);
  expect((await run(["unset", "craft", "--scope", "project", "--json"]))).toMatchObject({ exitCode: 0 });
  expect(JSON.parse((await run(["slots", "--json"])).stdout).data.effective.craft.model).toBe("provider/craft");
  expect((await run(["unset", "utility", "--json"]))).toMatchObject({ exitCode: 2 });
});

test("webhook configure validates the complete prospective runtime settings before writing", async () => {
  const writes: Array<readonly { path: string; value: Record<string, unknown> }[]> = [];
  const { homeDir, run } = await harness({ writeConfigs: async (entries: readonly { path: string; value: Record<string, unknown> }[]) => { writes.push(entries); } });
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  await mkdir(dirname(settingsPath), { recursive: true });
  for (const [knownInvalid, expected] of [
    [{ notifications: { change: "invalid", dispatch: false, future: { keep: true } } }, "notifications.change must be boolean"],
    [{ enabled: "invalid", notifications: { change: true } }, "enabled must be boolean"],
  ] as const) {
    const bytes = Buffer.from(JSON.stringify({
      futureTopLevel: { keep: true },
      webhook: {
        enabled: true,
        url: "https://old.example/hook",
        auth: { mode: "none", future: { keep: true } },
        ...knownInvalid,
      },
    }));
    await writeFile(settingsPath, bytes);

    const result = await run(["webhook", "configure", "--url", "https://new.example/hook", "--auth", "none", "--json"]);
    expect(result).toMatchObject({ exitCode: 2, stdout: "" });
    expect(result.stderr).toContain(expected);
    expect(await readFile(settingsPath)).toEqual(bytes);
    expect(writes).toEqual([]);
  }
});

test.each([
  ["auth", { enabled: true, url: "https://global.test/hook", auth: { mode: "bearer", token: [] } }],
  ["url", { enabled: true, url: "ftp://global.test/hook", auth: { mode: "none" } }],
  ["notifications", { enabled: true, url: "https://global.test/hook", auth: { mode: "none" }, notifications: { change: "invalid" } }],
] as const)("project disabled override ignores malformed global %s", async (_field, globalWebhook) => {
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  expect(parseWebhookSettings(globalWebhook, { enabled: false })).toBeUndefined();
});

test.each([
  [
    "auth",
    { enabled: true, url: "https://global.test/hook", auth: { mode: "bearer", token: [] } },
    { auth: { mode: "none" } },
  ],
  [
    "url",
    { enabled: true, url: "ftp://global.test/hook", auth: { mode: "none" } },
    { url: "https://project.test/hook" },
  ],
  [
    "notifications",
    { enabled: true, url: "https://global.test/hook", auth: { mode: "none" }, notifications: { change: "invalid", dispatch: false } },
    { notifications: { change: true } },
  ],
] as const)("project %s override prevents validation of the shadowed global field", async (_field, globalWebhook, projectWebhook) => {
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  expect(parseWebhookSettings(globalWebhook, projectWebhook)).toMatchObject({
    config: { auth: { mode: "none" } },
  });
});

test("webhook configure and runtime parser accept only HTTPS or local HTTP", async () => {
  const { homeDir, run } = await harness();
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  for (const url of [
    "ftp://localhost/hook",
    "file://localhost/hook",
    "ws://localhost/hook",
    "ftp://127.0.0.1/hook",
  ]) {
    expect(await run(["webhook", "configure", "--url", url, "--auth", "none", "--json"]), url).toMatchObject({ exitCode: 2 });
    expect(() => parseWebhookSettings({ enabled: true, url, auth: { mode: "none" } }), url).toThrow("HTTPS or local HTTP");
  }
  for (const url of ["http://localhost/hook", "http://127.0.0.1/hook", "https://example.test/hook"]) {
    expect(await run(["webhook", "configure", "--url", url, "--auth", "none", "--json"]), url).toMatchObject({ exitCode: 0 });
  }
  expect(JSON.parse(await readFile(join(homeDir, ".pi/agent/horsepower/settings.json"), "utf8")).webhook.url).toBe("https://example.test/hook");
});

test("webhook configure and disable deep-patch unknown nested settings", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  await writeFile(settingsPath, JSON.stringify({
    futureTopLevel: { keep: true },
    webhook: {
      future: { metadata: { keep: true } },
      notifications: { change: false, dispatch: false, futurePolicy: { retries: 7 } },
      auth: { mode: "none", futureMetadata: { keep: true } },
      headers: { authorization: "remove-this-credential", futureHeaderMetadata: { keep: true } },
    },
  }));

  expect(await run(["webhook", "configure", "--url", "https://example.test/hook", "--auth", "none", "--dispatch", "--json"])).toMatchObject({ exitCode: 0 });
  const configuredBytes = await readFile(settingsPath, "utf8");
  expect(configuredBytes).not.toContain("remove-this-credential");
  const configured = JSON.parse(configuredBytes);
  expect(configured).toMatchObject({
    futureTopLevel: { keep: true },
    webhook: {
      future: { metadata: { keep: true } },
      notifications: { change: false, dispatch: true, futurePolicy: { retries: 7 } },
      auth: { mode: "none", futureMetadata: { keep: true } },
      headers: { futureHeaderMetadata: { keep: true } },
    },
  });

  expect(await run(["webhook", "disable", "--json"])).toMatchObject({ exitCode: 0 });
  const disabled = JSON.parse(await readFile(settingsPath, "utf8"));
  expect(disabled).toMatchObject({
    futureTopLevel: { keep: true },
    webhook: {
      enabled: false,
      future: { metadata: { keep: true } },
      headers: { futureHeaderMetadata: { keep: true } },
    },
  });
  expect(disabled.webhook).not.toHaveProperty("auth");
  expect(JSON.stringify(disabled)).not.toContain("remove-this-credential");
});

test("webhook disable removes credentials nested in unknown arrays while preserving safe metadata", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const credentialBytes = ["nested-token-bytes", "nested-auth-bytes", "nested-password-bytes"];
  await writeFile(settingsPath, JSON.stringify({
    webhook: {
      enabled: true,
      url: "https://example.test/hook",
      unknown: [
        "safe-label",
        { safe: "keep", token: credentialBytes[0] },
        [{ authentication: credentialBytes[1], nested: { password: credentialBytes[2], safe: 7 } }],
      ],
    },
  }));

  expect(await run(["webhook", "disable", "--json"])).toMatchObject({ exitCode: 0 });
  const persistedBytes = await readFile(settingsPath, "utf8");
  for (const credential of credentialBytes) expect(persistedBytes).not.toContain(credential);
  expect(JSON.parse(persistedBytes).webhook.unknown).toEqual([
    "safe-label",
    { safe: "keep" },
    [{ nested: { safe: 7 } }],
  ]);
});

test("CLI webhook settings exactly match runtime parsing and disabled settings remove credentials", async () => {
  const secret = "never-print-this";
  const { homeDir, cwd, run } = await harness();
  await run(setupArgs);
  const configured = await run([
    "webhook", "configure", "--url", "https://example.test/hook", "--auth", "hmac", "--secret", secret,
    "--change", "--dispatch", "--json",
  ]);
  expect(configured.exitCode).toBe(0);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
    webhook: { url: "https://example.test/hook", notifications: { change: true, dispatch: true }, auth: { mode: "hmac", secret } },
  });
  const { webhookOptions } = await import("../../src/extension/index.js");
  expect(webhookOptions(homeDir, cwd)).toEqual({
    config: { url: "https://example.test/hook", auth: { mode: "hmac", secret } },
    notifications: { change: true, dispatch: true },
  });

  const withFuture = JSON.parse(await readFile(settingsPath, "utf8"));
  withFuture.webhook.future = { keep: true };
  withFuture.webhook.headers = { authorization: "stale-credential" };
  await writeFile(settingsPath, JSON.stringify(withFuture));
  expect(await run(["webhook", "skip", "--json"])).toMatchObject({ exitCode: 0 });
  expect(webhookOptions(homeDir, cwd)).toBeUndefined();
  const disabled = JSON.parse(await readFile(settingsPath, "utf8")).webhook;
  expect(disabled).toMatchObject({ enabled: false, future: { keep: true } });
  expect(JSON.stringify(disabled)).not.toContain(secret);
  expect(JSON.stringify(disabled)).not.toContain("stale-credential");
  expect(disabled).not.toHaveProperty("url");
  expect(disabled).not.toHaveProperty("auth");
});

test("compound credential names share one classifier across output, removal, and URL queries", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const credentialKeys = ["signing_secret", "webhookToken", "webhook_token", "clientSecretValue", "apiCredential"];
  const safeFields = {
    apiVersion: "v2",
    clientName: "captain",
    refreshInterval: 30,
    signingAlgorithm: "sha256",
    webhookUrl: "https://safe.example/hook",
  };
  const credentialBytes = credentialKeys.map((_, index) => `compound-credential-byte-${index}`);
  const query = [
    ...credentialKeys.map((key, index) => `${key}=${credentialBytes[index]}`),
    "refreshInterval=30",
    "webhookUrl=visible",
  ].join("&");
  await writeFile(settingsPath, JSON.stringify({
    webhook: {
      enabled: true,
      url: `https://example.test/hook?${query}`,
      auth: { mode: "none" },
      future: {
        ...safeFields,
        ...Object.fromEntries(credentialKeys.map((key, index) => [key, credentialBytes[index]])),
      },
    },
  }));

  const shown = await run(["configure", "--json"]);
  expect(shown).toMatchObject({ exitCode: 0, stderr: "" });
  for (const credential of credentialBytes) expect(shown.stdout).not.toContain(credential);
  for (const value of ["v2", "captain", "sha256", "safe.example", "visible"]) expect(shown.stdout).toContain(value);
  expect(shown.stdout.match(/REDACTED/gu)).toHaveLength(credentialKeys.length * 2);

  expect(await run(["webhook", "disable", "--json"])).toMatchObject({ exitCode: 0, stderr: "" });
  const persistedBytes = await readFile(settingsPath, "utf8");
  for (const credential of credentialBytes) expect(persistedBytes).not.toContain(credential);
  expect(JSON.parse(persistedBytes).webhook.future).toEqual(safeFields);
});

test("CLI output redacts every credential-key URL query value while preserving safe parameters", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const credentialKeys = [
    "secret", "ToKeN", "password", "credential", "key", "api_key", "api-key", "apiKey",
    "%61ccess_token", "access-token", "accessToken", "refresh_token", "refresh-token", "refreshToken",
    "client_secret", "client-secret", "clientSecret", "authorization", "authentication",
  ];
  const secrets = credentialKeys.map((_, index) => `credential-byte-${index}`);
  const query = ["region=us", ...credentialKeys.map((key, index) => `${key}=${secrets[index]}`), "note=keep"].join("&");
  const receiver = `https://example.test/hooks/team?${query}#delivery`;

  const configured = await run(["webhook", "configure", "--url", receiver, "--auth", "none", "--json"]);
  expect(configured).toMatchObject({ exitCode: 0, stderr: "" });
  for (const secret of secrets) expect(configured.stdout).not.toContain(secret);
  expect(configured.stdout).toContain("https://example.test/hooks/team?");
  expect(configured.stdout).toContain("region=us");
  expect(configured.stdout).toContain("note=keep");
  expect(configured.stdout).toContain("#delivery");
  expect(configured.stdout.match(/REDACTED/gu)).toHaveLength(credentialKeys.length);

  const persisted = JSON.parse(await readFile(join(homeDir, ".pi/agent/horsepower/settings.json"), "utf8"));
  expect(persisted.webhook.url).toBe(receiver);

  for (const [index, key] of credentialKeys.entries()) {
    const errorUrl = `https://example.test/hook?${key}=${secrets[index]}&safe=visible`;
    for (const argv of [[errorUrl], [errorUrl, "--json"]]) {
      const result = await run(argv);
      expect(result.stderr, key).not.toContain(secrets[index]);
      expect(result.stderr, key).toContain("https://example.test/hook?");
      expect(result.stderr, key).toContain("safe=visible");
      expect(result.stderr, key).toContain("REDACTED");
    }
  }
});

test("CLI settings output and disable use the same credential-key classification", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const credentialKeys = [
    "secret", "token", "password", "credential", "key", "api_key", "api-key", "apiKey",
    "access_token", "access-token", "accessToken", "refresh_token", "refresh-token", "refreshToken",
    "client_secret", "client-secret", "clientSecret", "authorization", "authentication",
  ];
  const secrets = credentialKeys.map((_, index) => `field-credential-byte-${index}`);
  await writeFile(settingsPath, JSON.stringify({
    webhook: {
      enabled: true,
      url: "https://example.test/hook?safe=visible",
      auth: { mode: "none" },
      future: Object.fromEntries(credentialKeys.map((key, index) => [key, secrets[index]])),
      safe: { label: "keep" },
    },
  }));

  const shown = await run(["configure", "--json"]);
  for (const secret of secrets) expect(shown.stdout + shown.stderr).not.toContain(secret);
  expect(shown.stdout).toContain("keep");

  expect(await run(["webhook", "disable", "--json"])).toMatchObject({ exitCode: 0 });
  const persisted = await readFile(settingsPath, "utf8");
  for (const secret of secrets) expect(persisted).not.toContain(secret);
  expect(JSON.parse(persisted).webhook.safe).toEqual({ label: "keep" });
});

test("webhook diagnostics recursively redact malformed and future credential fields", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const credentials = ["deep-secret", "future-token", "raw-authorization", "auth-value", "future-value"];
  await writeFile(settingsPath, JSON.stringify({
    webhook: {
      enabled: true,
      url: "https://example.test/hook",
      auth: { mode: "future", secret: credentials[0], value: credentials[4], nested: { refreshToken: credentials[1] } },
      headers: { Authorization: credentials[2], authentication: credentials[3] },
      notifications: { change: true, dispatch: false },
    },
  }));
  for (const args of [["configure", "--json"], ["doctor", "--json"]]) {
    const output = await run(args);
    for (const credential of credentials) expect(output.stdout + output.stderr).not.toContain(credential);
  }
  const shown = JSON.parse((await run(["configure", "--json"])).stdout).data;
  expect(shown.webhook.auth.secret).toBe("[REDACTED]");
  expect(shown.webhook.auth.value).toBe("[REDACTED]");
  expect(shown.webhook.auth.nested.refreshToken).toBe("[REDACTED]");
  expect(shown.webhook.headers.Authorization).toBe("[REDACTED]");
  expect(shown.webhook.headers.authentication).toBe("[REDACTED]");
  const notification = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks.find((check: { id: string }) => check.id === "notification");
  expect(notification).toMatchObject({ status: "error", action: expect.stringContaining("webhook configure") });
});

test("webhook diagnostics redact every primitive in malformed authentication structures and URL userinfo", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const secrets = ["array-secret", "object-secret", "bad-mode-secret", "url-user", "url-password"];
  await writeFile(settingsPath, JSON.stringify({
    webhook: {
      enabled: true,
      url: `https://${secrets[3]}:${secrets[4]}@example.test/hook`,
      authentication: {
        mode: secrets[2],
        unknown: [secrets[0], { future: secrets[1] }],
      },
    },
  }));
  for (const args of [["configure", "--json"], ["doctor", "--json"], ["webhook", "test", "--json"]]) {
    const output = await run(args);
    for (const secret of secrets) expect(output.stdout + output.stderr).not.toContain(secret);
  }

  const attempted = await run(["webhook", "configure", "--url", "https://url-user:url-password@example.test/hook", "--auth", "none", "--json"]);
  expect(attempted).toMatchObject({ exitCode: 2 });
  expect(attempted.stderr).not.toContain("url-user");
  expect(attempted.stderr).not.toContain("url-password");
});

test("doctor and webhook test use effective project-over-global webhook settings", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
    return new Response(null, { status: 204 });
  });
  const { homeDir, cwd, run } = await harness({ fetch });
  await run(setupArgs);
  const globalPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const projectPath = join(cwd, ".pi/horsepower/settings.json");
  await mkdir(dirname(projectPath), { recursive: true });
  await writeFile(globalPath, JSON.stringify({ webhook: { enabled: true, url: "https://global.test/hook", auth: { mode: "bearer", token: "global-token" }, future: { safe: true } } }));
  await writeFile(projectPath, JSON.stringify({ webhook: { url: "https://project.test/hook", auth: { mode: "bearer", token: "project-token" }, unknown: ["safe-label"] } }));

  expect((await run(["webhook", "test", "--json"])).exitCode).toBe(0);
  expect(requests).toEqual([{ url: "https://project.test/hook", authorization: "Bearer project-token" }]);

  await writeFile(projectPath, JSON.stringify({ webhook: { enabled: false, unknown: { keep: true } } }));
  const disabledChecks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
  expect(disabledChecks.find((check: { id: string }) => check.id === "notification")).toMatchObject({ status: "skipped" });

  for (const auth of [
    { mode: "hmac", secret: ["malformed-project-secret"] },
    { mode: "none", secret: "incompatible-project-secret" },
    { mode: "hmac", secret: "valid-secret", token: "incompatible-project-token" },
  ]) {
    await writeFile(projectPath, JSON.stringify({ webhook: { enabled: true, auth } }));
    const invalid = await run(["doctor", "--json"]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stdout + invalid.stderr).not.toContain("malformed-project-secret");
    expect(invalid.stdout + invalid.stderr).not.toContain("incompatible-project-secret");
    expect(invalid.stdout + invalid.stderr).not.toContain("incompatible-project-token");
    expect(JSON.parse(invalid.stdout).data.checks.find((check: { id: string }) => check.id === "notification")).toMatchObject({ status: "error" });
  }
});

test.each([
  ["disabled project override", { enabled: false, unknown: { keep: "disabled-project" } }],
  ["different project endpoint", {
    enabled: true,
    url: "https://old-project.test/hook",
    auth: { mode: "bearer", token: "stale-project-token" },
    notifications: { change: false, dispatch: false },
    unknown: { keep: "project-endpoint" },
  }],
] as const)("webhook configure updates the effective layer for %s", async (_label, projectWebhook) => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
    return new Response(null, { status: 204 });
  });
  const { homeDir, cwd, run } = await harness({ fetch });
  await run(setupArgs);
  const globalPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const projectPath = join(cwd, ".pi/horsepower/settings.json");
  await mkdir(dirname(projectPath), { recursive: true });
  const global = {
    globalSafe: { keep: true },
    webhook: {
      enabled: true,
      url: "https://global.test/hook",
      auth: { mode: "hmac", secret: "global-secret" },
      notifications: { change: false, dispatch: false },
      unknown: { global: true },
    },
  };
  await writeFile(globalPath, JSON.stringify(global));
  await writeFile(projectPath, JSON.stringify({ projectSafe: { keep: true }, webhook: projectWebhook }));

  const result = await run([
    "webhook", "configure", "--url", "https://requested.test/hook", "--auth", "bearer",
    "--token", "requested-token", "--change", "--dispatch", "--json",
  ]);
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(await readFile(globalPath, "utf8")).toBe(JSON.stringify(global));
  const persisted = JSON.parse(await readFile(projectPath, "utf8"));
  expect(persisted).toMatchObject({
    projectSafe: { keep: true },
    webhook: {
      enabled: true,
      url: "https://requested.test/hook",
      auth: { mode: "bearer", token: "requested-token" },
      notifications: { change: true, dispatch: true },
      unknown: projectWebhook.unknown,
    },
  });
  expect(JSON.stringify(persisted)).not.toContain("stale-project-token");
  expect(persisted.webhook.auth).not.toHaveProperty("secret");

  const { webhookOptions } = await import("../../src/extension/index.js");
  expect(webhookOptions(homeDir, cwd)).toEqual({
    config: { url: "https://requested.test/hook", auth: { mode: "bearer", token: "requested-token" } },
    notifications: { change: true, dispatch: true },
  });
  expect(await run(["webhook", "test", "--json"])).toMatchObject({ exitCode: 0 });
  expect(requests).toEqual([{ url: "https://requested.test/hook", authorization: "Bearer requested-token" }]);
});

test.each([
  ["malformed notifications", {
    enabled: true,
    url: "https://project.test/hook",
    auth: { mode: "none" },
    notifications: { change: "invalid", token: "notification-credential" },
    metadata: { keep: "notifications" },
  }],
  ["malformed auth", {
    enabled: true,
    url: "https://project.test/hook",
    auth: { mode: "bearer", token: ["auth-credential"] },
    metadata: { keep: "auth" },
  }],
  ["array webhook", ["safe-array-value", { token: "array-credential" }]],
  ["scalar webhook", "scalar-credential"],
] as const)("webhook disable replaces %s project state with a runtime-safe disabled override", async (_label, malformedWebhook) => {
  const { homeDir, cwd, run } = await harness();
  await run(setupArgs);
  const globalPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const projectPath = join(cwd, ".pi/horsepower/settings.json");
  await mkdir(dirname(projectPath), { recursive: true });
  const global = { webhook: { enabled: true, url: "https://global.test/hook", auth: { mode: "bearer", token: "global-credential" } } };
  await writeFile(globalPath, JSON.stringify(global));
  await writeFile(projectPath, JSON.stringify({ projectTopLevel: { keep: true }, webhook: malformedWebhook }));

  const result = await run(["webhook", "disable", "--json"]);

  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(await readFile(globalPath, "utf8")).toBe(JSON.stringify(global));
  const persistedBytes = await readFile(projectPath, "utf8");
  for (const credential of ["notification-credential", "auth-credential", "array-credential", "scalar-credential"]) {
    expect(persistedBytes).not.toContain(credential);
  }
  const persisted = JSON.parse(persistedBytes);
  expect(persisted.projectTopLevel).toEqual({ keep: true });
  expect(persisted.webhook).toEqual({
    ...(_label === "malformed notifications" || _label === "malformed auth" ? { metadata: { keep: _label === "malformed notifications" ? "notifications" : "auth" } } : {}),
    enabled: false,
  });
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  expect(parseWebhookSettings(global.webhook, persisted.webhook)).toBeUndefined();
});

test("webhook disable commits a project override despite malformed shadowed global fields", async () => {
  const { homeDir, cwd, run } = await harness();
  await run(setupArgs);
  const globalPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const projectPath = join(cwd, ".pi/horsepower/settings.json");
  await mkdir(dirname(projectPath), { recursive: true });
  const global = {
    webhook: {
      enabled: true,
      url: "ftp://global.test/hook",
      auth: { mode: "bearer", token: [] },
      notifications: { change: "invalid" },
    },
  };
  await writeFile(globalPath, JSON.stringify(global));
  await writeFile(projectPath, JSON.stringify({ webhook: { enabled: true, metadata: { keep: true } } }));

  const result = await run(["webhook", "disable", "--json"]);

  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(await readFile(globalPath, "utf8")).toBe(JSON.stringify(global));
  const persisted = JSON.parse(await readFile(projectPath, "utf8"));
  expect(persisted.webhook).toEqual({ enabled: false, metadata: { keep: true } });
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  expect(parseWebhookSettings(global.webhook, persisted.webhook)).toBeUndefined();
});

test("webhook disable defaults to the effective active project and removes project credentials", async () => {
  const { homeDir, cwd, run } = await harness();
  await run(setupArgs);
  const globalPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const projectPath = join(cwd, ".pi/horsepower/settings.json");
  await mkdir(dirname(projectPath), { recursive: true });
  const global = { webhook: { enabled: true, url: "https://global.test/hook", auth: { mode: "none" }, future: { global: true } } };
  await writeFile(globalPath, JSON.stringify(global));
  await writeFile(projectPath, JSON.stringify({
    projectTopLevel: { keep: true },
    webhook: {
      enabled: true,
      url: "https://project.test/hook",
      auth: { mode: "bearer", token: "project-secret-token" },
      headers: { Authorization: "project-secret-header", safe: "keep" },
      future: { project: true },
    },
  }));

  const result = await run(["webhook", "disable", "--json"]);
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(await readFile(globalPath, "utf8")).toBe(JSON.stringify(global));
  const persistedBytes = await readFile(projectPath, "utf8");
  expect(persistedBytes).not.toContain("project-secret-token");
  expect(persistedBytes).not.toContain("project-secret-header");
  expect(JSON.parse(persistedBytes)).toMatchObject({
    projectTopLevel: { keep: true },
    webhook: { enabled: false, headers: { safe: "keep" }, future: { project: true } },
  });
  expect(JSON.parse(persistedBytes).webhook).not.toHaveProperty("url");
  expect(JSON.parse(persistedBytes).webhook).not.toHaveProperty("auth");

  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  expect(parseWebhookSettings(global.webhook, JSON.parse(persistedBytes).webhook)).toBeUndefined();
});

test("webhook test sends HMAC and Bearer authentication headers", async () => {
  const requests: RequestInit[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { requests.push(init ?? {}); return new Response(null, { status: 204 }); });
  const { run } = await harness({ fetch });
  await run(setupArgs);
  await run(["webhook", "configure", "--url", "https://example.test/hook", "--auth", "hmac", "--secret", "hmac-value", "--json"]);
  expect((await run(["webhook", "test", "--json"])).exitCode).toBe(0);
  expect(new Headers(requests[0]!.headers).get("x-horsepower-signature")).toMatch(/^[a-f0-9]{64}$/u);
  expect(new Headers(requests[0]!.headers).get("authorization")).toBeNull();
  await run(["webhook", "configure", "--url", "https://example.test/hook", "--auth", "bearer", "--token", "bearer-value", "--json"]);
  expect((await run(["webhook", "test", "--json"])).exitCode).toBe(0);
  expect(new Headers(requests[1]!.headers).get("authorization")).toBe("Bearer bearer-value");
});

test("setup validates all existing config and settings before any write", async () => {
  for (const invalid of ["malformed-settings", "settings-directory", "settings-symlink", "project-slots"] as const) {
    const writes: Array<readonly { path: string; value: Record<string, unknown> }[]> = [];
    const { homeDir, cwd, root, run } = await harness({ writeConfigs: async (entries: readonly { path: string; value: Record<string, unknown> }[]) => { writes.push(entries); } });
    const slotsPath = join(homeDir, ".pi/agent/horsepower/model-slots.json");
    const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
    await mkdir(dirname(slotsPath), { recursive: true });
    const originalSlots = Buffer.from('{"future":{"keep":true}}\n');
    await writeFile(slotsPath, originalSlots);
    if (invalid === "malformed-settings") await writeFile(settingsPath, '{"webhook":');
    if (invalid === "settings-directory") await mkdir(settingsPath);
    if (invalid === "settings-symlink") {
      const external = join(root, "external-settings.json");
      await writeFile(external, "{}\n");
      await symlink(external, settingsPath);
    }
    if (invalid === "project-slots") {
      const projectSlots = join(cwd, ".pi/horsepower/model-slots.json");
      await mkdir(dirname(projectSlots), { recursive: true });
      await writeFile(projectSlots, JSON.stringify({ slots: { craft: { fallback: "missing" } } }));
    }

    expect(await run(setupArgs), invalid).toMatchObject({ exitCode: 2 });
    expect(await readFile(slotsPath), invalid).toEqual(originalSlots);
    expect(writes, invalid).toEqual([]);
  }
});

test("setup commits both initialized files in one configuration transaction", async () => {
  const writes: Array<readonly { path: string; value: Record<string, unknown> }[]> = [];
  const { run } = await harness({
    writeConfigs: async (entries: readonly { path: string; value: Record<string, unknown> }[]) => { writes.push(entries); },
  });
  expect(await run(setupArgs)).toMatchObject({ exitCode: 0 });
  expect(writes).toHaveLength(1);
  expect(writes[0]).toHaveLength(2);
});

test("installation-only doctor verifies owned active topology without requiring project configuration", async () => {
  const { homeDir, run } = await harness({ runOpenSpec: async () => ({ code: 1, stdout: "", stderr: "must not run" }) });
  await installManagedFixture(homeDir, "enabled");
  const result = JSON.parse((await run(["doctor", "--installation-only", "--json"])).stdout);
  expect(result).toMatchObject({ ok: true, data: { checks: [{ id: "installation", status: "ok" }] } });
});

test("doctor reports a missing bundled agent catalog before the first dispatch", async () => {
  const { homeDir, run } = await harness();
  const { managed } = await installManagedFixture(homeDir, "enabled");
  await rm(join(managed, "versions/v0.1.0/resources/agents"), { recursive: true });

  const result = JSON.parse((await run(["doctor", "--installation-only", "--json"])).stdout);

  expect(result).toMatchObject({
    ok: false,
    data: { checks: [{
      id: "installation", status: "error",
      message: "Horsepower installation is invalid.",
      action: "Install or repair Horsepower from an official release.",
      rawEvidence: expect.stringContaining("Bundled agent catalog"),
    }] },
  });
});

test("Chinese doctor localizes integration findings while preserving status and commands", async () => {
  const { homeDir, run } = await harness();
  await installManagedFixture(homeDir);
  await run(["configure", "--locale", "zh-CN", "--json"]);
  const result = JSON.parse((await run(["doctor", "--installation-only", "--json"])).stdout);
  expect(result.data.checks[0]).toMatchObject({ id: "installation", status: "ok", integrationStatus: "disabled", message: "Horsepower Pi 集成已禁用。", action: "运行 horsepower enable。" });
});

test("installation-only doctor distinguishes disabled Pi integration from installation failure", async () => {
  const { homeDir, run } = await harness();
  await installManagedFixture(homeDir);
  const result = JSON.parse((await run(["doctor", "--installation-only", "--json"])).stdout);
  expect(result).toMatchObject({ ok: true, data: { checks: [{ id: "installation", status: "ok", integrationStatus: "disabled", action: "Run horsepower enable." }] } });
});

test("doctor derives unverified and unsupported capability findings from current catalog metadata", async () => {
  const modelCatalog = {
    status: "available" as const,
    modelIds: ["provider/judge", "provider/craft", "provider/util"],
    models: {
      "provider/judge": { thinkingLevels: undefined },
      "provider/craft": { thinkingLevels: ["low"] },
      "provider/util": { thinkingLevels: ["low"] },
    },
    revision: "catalog-revision",
  };
  const { homeDir, run } = await harness({ models: undefined, modelCatalog });
  const slotsPath = join(homeDir, ".pi/agent/horsepower/model-slots.json");
  await mkdir(dirname(slotsPath), { recursive: true });
  await writeFile(slotsPath, JSON.stringify({ slots: {
    judgment: { model: "provider/judge", thinking: "high" },
    craft: { model: "provider/craft", thinking: "medium" },
    utility: { model: "provider/util", thinking: "low" },
  } }));

  const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
  expect(checks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: "model-capability:provider/judge:high", capabilityStatus: "unverified",
      rawEvidence: "provider/judge thinking=high code=missing_evidence catalogRevision=catalog-revision",
    }),
    expect.objectContaining({
      id: "model-capability:provider/craft:medium", capabilityStatus: "unsupported",
      rawEvidence: "provider/craft thinking=medium code=declared_exact_exclusion catalogRevision=catalog-revision",
    }),
  ]));
});

test("doctor localizes capability diagnostics while preserving status IDs and raw evidence", async () => {
  const diagnostics = [
    { id: "provider/judge:high", status: "unverified", rawEvidence: "provider/judge thinking=high code=missing_evidence" },
    { id: "provider/craft:medium", status: "unsupported", rawEvidence: "provider/craft thinking=medium code=INVALID_THINKING" },
    { id: "provider/util:low", status: "inconclusive", rawEvidence: "provider/util thinking=low code=timeout" },
    { id: "project/craft:max", status: "stale", rawEvidence: "project/craft thinking=max code=ttl_expired" },
  ] as const;
  for (const locale of ["en", "zh-CN"] as const) {
    const { run } = await harness({ modelCapabilityDiagnostics: diagnostics });
    await run(setupArgs);
    if (locale === "zh-CN") await run(["configure", "--locale", locale, "--json"]);

    const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
    const capability = checks.filter((check: { id: string }) => check.id.startsWith("model-capability:"));
    expect(capability.map((check: { id: string; capabilityStatus: string; rawEvidence: string }) => ({
      id: check.id, capabilityStatus: check.capabilityStatus, rawEvidence: check.rawEvidence,
    }))).toEqual(diagnostics.map((diagnostic) => ({
      id: `model-capability:${diagnostic.id}`, capabilityStatus: diagnostic.status, rawEvidence: diagnostic.rawEvidence,
    })));
    expect(capability.map((check: { action: string }) => check.action)).toEqual([
      locale === "zh-CN" ? "运行 horsepower setup --interactive 重新验证或配置模型。" : "Run horsepower setup --interactive to revalidate or reconfigure models.",
      locale === "zh-CN" ? "运行 horsepower setup --interactive 选择受支持的模型与 thinking 组合。" : "Run horsepower setup --interactive to choose a supported model and thinking combination.",
      locale === "zh-CN" ? "解决 rawEvidence 中的问题，然后运行 horsepower setup --interactive 重试。" : "Resolve the issue in rawEvidence, then retry with horsepower setup --interactive.",
      locale === "zh-CN" ? "运行 horsepower setup --interactive 刷新过期的能力证据。" : "Run horsepower setup --interactive to refresh stale capability evidence.",
    ]);
    expect(capability.map((check: { message: string }) => check.message).join(" ")).toContain(locale === "zh-CN" ? "未验证" : "unverified");
  }
});

test("doctor reports an unavailable current model catalog with localized remediation", async () => {
  for (const locale of ["en", "zh-CN"] as const) {
    const { homeDir, run } = await harness({ models: undefined, modelCatalog: { status: "unavailable", reason: "registry-error" } });
    const slotsPath = join(homeDir, ".pi/agent/horsepower/model-slots.json");
    await mkdir(dirname(slotsPath), { recursive: true });
    await writeFile(slotsPath, JSON.stringify({ slots: {
      judgment: { model: "provider/judge", thinking: "high" },
      craft: { model: "provider/craft", thinking: "medium" },
      utility: { model: "provider/util", thinking: "low" },
    } }));
    if (locale === "zh-CN") await run(["configure", "--locale", locale, "--json"]);

    const check = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks.find((candidate: { id: string }) => candidate.id === "model-catalog");
    expect(check).toMatchObject({
      status: "skipped",
      catalogStatus: "unavailable",
      rawEvidence: "registry-error",
      message: locale === "zh-CN" ? "Pi 模型目录不可用；无法验证模型能力。" : "The Pi model catalog is unavailable; model capabilities could not be verified.",
      action: locale === "zh-CN" ? "恢复 Pi 模型目录后运行 horsepower setup --interactive。" : "Restore the Pi model catalog, then run horsepower setup --interactive.",
    });
  }
});

test("doctor reports configuration, notifications, OpenSpec, skipped models, and ownership actionably", async () => {
  const { run } = await harness({ models: undefined, runOpenSpec: async (args: readonly string[]) => args[0] === "--version"
    ? { code: 127, stdout: "", stderr: "not found" }
    : { code: 1, stdout: "", stderr: "" } });
  const result = JSON.parse((await run(["doctor", "--json"])).stdout);
  expect(result.ok).toBe(false);
  expect(result.data.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "configuration", status: "error" }),
    expect.objectContaining({ id: "notification", status: "skipped" }),
    expect.objectContaining({ id: "openspec", status: "error", action: expect.stringContaining("official") }),
    expect.objectContaining({ id: "model-registry", status: "skipped" }),
    expect.objectContaining({ id: "installation", status: "error" }),
  ]));
});

test("doctor absorbs malformed global and project settings into stable redacted checks", async () => {
  for (const scope of ["global", "project"] as const) {
    const { homeDir, cwd, run } = await harness();
    await run(setupArgs);
    const settingsPath = scope === "global"
      ? join(homeDir, ".pi/agent/horsepower/settings.json")
      : join(cwd, ".pi/horsepower/settings.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    const secret = `${scope}-settings-secret`;
    await writeFile(settingsPath, `{"webhook":{"auth":{"token":"${secret}"}`);

    const first = await run(["doctor", "--json"]);
    const second = await run(["doctor", "--json"]);
    expect(first, scope).toEqual(second);
    expect(first, scope).toMatchObject({ exitCode: 1, stderr: "" });
    expect(first.stdout, scope).not.toContain(secret);
    const checks = JSON.parse(first.stdout).data.checks;
    expect(checks.map((check: { id: string }) => check.id), scope).toEqual([
      "configuration", "notification", "openspec", "model-registry", "installation",
    ]);
    expect(checks.find((check: { id: string }) => check.id === "notification"), scope).toMatchObject({
      status: "error",
      message: "Horsepower settings are invalid.",
      action: "Repair or remove the invalid settings listed in rawEvidence.",
      rawEvidence: expect.stringContaining(`Malformed JSON in ${settingsPath}`),
    });
  }
});

test("doctor absorbs unreadable global and project settings into path-specific checks", async () => {
  for (const scope of ["global", "project"] as const) {
    const { homeDir, cwd, run } = await harness();
    await run(setupArgs);
    const settingsPath = scope === "global"
      ? join(homeDir, ".pi/agent/horsepower/settings.json")
      : join(cwd, ".pi/horsepower/settings.json");
    await rm(settingsPath, { force: true });
    await mkdir(settingsPath, { recursive: true });

    const result = await run(["doctor", "--json"]);
    expect(result, scope).toMatchObject({ exitCode: 1, stderr: "" });
    const checks = JSON.parse(result.stdout).data.checks;
    expect(checks.map((check: { id: string }) => check.id), scope).toEqual([
      "configuration", "notification", "openspec", "model-registry", "installation",
    ]);
    expect(checks.find((check: { id: string }) => check.id === "notification"), scope).toMatchObject({
      status: "error",
      message: "Horsepower settings are invalid.",
      action: "Repair or remove the invalid settings listed in rawEvidence.",
      rawEvidence: expect.stringContaining(settingsPath),
    });
  }
});

test("doctor distinguishes healthy, missing, stale, and unofficial OpenSpec integration", async () => {
  for (const [kind, expected] of [["healthy", "ok"], ["missing", "error"], ["stale", "error"], ["unofficial", "error"]] as const) {
    const { cwd, run } = await harness();
    if (kind !== "missing") {
      const generated = kind === "stale" ? "1.5.0" : "1.6.0";
      await mkdir(join(cwd, ".pi/skills/openspec-apply-change"), { recursive: true });
      await mkdir(join(cwd, ".pi/prompts"), { recursive: true });
      await writeFile(join(cwd, ".pi/skills/openspec-apply-change/SKILL.md"), kind === "unofficial"
        ? `name: arbitrary\ngeneratedBy: \"${generated}\"`
        : `name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: \"${generated}\"`);
      await writeFile(join(cwd, ".pi/prompts/opsx-apply.md"), kind === "unofficial"
        ? "arbitrary file"
        : "Implement tasks from an OpenSpec change.");
    }
    const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
    expect(checks.find((check: { id: string }) => check.id === "openspec").status).toBe(expected);
  }
});

test("doctor rejects malformed partial OpenSpec semver", async () => {
  const { run } = await harness({ runOpenSpec: async (args: readonly string[]) => args[0] === "--version"
    ? { code: 0, stdout: "1.6.\n", stderr: "" }
    : { code: 0, stdout: JSON.stringify({ root: { path: "/project", healthy: true } }), stderr: "" } });
  const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
  expect(checks.find((check: { id: string }) => check.id === "openspec")).toMatchObject({ status: "error", message: "Official OpenSpec is unavailable or invalid.", rawEvidence: expect.stringContaining("1.6.0") });
});

test("staged-release preflight validates manifest, version, layout, and current/link ownership", async () => {
  const { homeDir, root, run } = await harness();
  const staged = join(root, "horsepower");
  await writeRelease(staged, "0.1.0-alpha.1");
  expect(await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 0 });

  const linkedStage = join(root, "linked-stage");
  await symlink(staged, linkedStage);
  expect(await run(["preflight", linkedStage, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 1 });

  const hp = join(homeDir, ".pi/agent/horsepower");
  const externalRoot = join(root, "external-install");
  await mkdir(externalRoot);
  await mkdir(dirname(hp), { recursive: true });
  await symlink(externalRoot, hp);
  expect(await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 1 });
  await rm(hp);

  const cliLink = join(homeDir, ".local/bin/horsepower");
  await mkdir(dirname(cliLink), { recursive: true });
  await symlink("/unrelated", cliLink);
  const ownership = await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"]);
  expect(ownership).toMatchObject({ exitCode: 1 });
  expect(ownership.stderr).toContain("unrelated symlink");

  await writeFile(join(staged, "release-manifest.json"), JSON.stringify({ version: "wrong", entryPoints: {} }));
  expect(await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 1 });
});

test("preflight rejects symlinked manifests, intermediate directories, and invalid semver", async () => {
  for (const hostile of ["manifest", "intermediate", "expected-version", "manifest-version"] as const) {
    const { root, run } = await harness();
    const staged = join(root, `staged-${hostile}`);
    const manifestVersion = hostile === "manifest-version" ? "01.0.0" : "0.1.0";
    await writeRelease(staged, manifestVersion);
    if (hostile === "manifest") {
      const external = join(root, "external-manifest.json");
      await writeFile(external, await readFile(join(staged, "release-manifest.json")));
      await rm(join(staged, "release-manifest.json"));
      await symlink(external, join(staged, "release-manifest.json"));
    }
    if (hostile === "intermediate") {
      const externalBin = join(root, "external-bin");
      await mkdir(externalBin);
      await writeFile(join(externalBin, "horsepower"), "external");
      await rm(join(staged, "bin"), { recursive: true });
      await symlink(externalBin, join(staged, "bin"));
    }
    const expected = hostile === "expected-version" ? "01.0.0" : hostile === "manifest-version" ? "0.1.0" : manifestVersion;
    expect(await run(["preflight", staged, "--version", expected, "--json"]), hostile).toMatchObject({ exitCode: hostile === "expected-version" ? 2 : 1 });
  }
});

test("preflight rejects every symlinked stable-link parent component", async () => {
  for (const parent of [".local", ".local/bin", ".pi", ".pi/agent", ".pi/agent/extensions", ".pi/agent/skills"] as const) {
    const { homeDir, root, run } = await harness();
    const staged = join(root, `staged-${parent.replaceAll("/", "-")}`);
    await writeRelease(staged, "0.1.0");
    const external = join(root, `external-${parent.replaceAll("/", "-")}`);
    await mkdir(external, { recursive: true });
    const marker = join(external, "keep");
    await writeFile(marker, "external data");
    const link = join(homeDir, parent);
    await mkdir(dirname(link), { recursive: true });
    await symlink(external, link);

    const result = await run(["preflight", staged, "--version", "0.1.0", "--json"]);
    expect(result, parent).toMatchObject({ exitCode: 1, stdout: "" });
    expect(await readFile(marker, "utf8"), parent).toBe("external data");
    expect(await readlink(link), parent).toBe(external);
  }
});

test("preflight rejects an existing immutable version destination without modifying it", async () => {
  for (const collision of ["foreign-directory", "matching-release", "symlink"] as const) {
    const { homeDir, root, run } = await harness();
    const staged = join(root, `staged-${collision}`);
    await writeRelease(staged, "0.1.0");
    const destination = join(homeDir, ".pi/agent/horsepower/versions/v0.1.0");
    const external = join(root, `external-${collision}`);
    await mkdir(dirname(destination), { recursive: true });

    if (collision === "foreign-directory") {
      await mkdir(destination);
      await writeFile(join(destination, "keep"), "foreign data");
    } else if (collision === "matching-release") {
      await writeRelease(destination, "0.1.0");
    } else {
      await mkdir(external);
      await writeFile(join(external, "keep"), "external data");
      await symlink(external, destination);
    }

    const result = await run(["preflight", staged, "--version", "0.1.0", "--json"]);
    expect(result, collision).toMatchObject({ exitCode: 1, stdout: "" });
    if (collision === "foreign-directory") expect(await readFile(join(destination, "keep"), "utf8")).toBe("foreign data");
    if (collision === "matching-release") expect(JSON.parse(await readFile(join(destination, "release-manifest.json"), "utf8"))).toMatchObject({ version: "0.1.0" });
    if (collision === "symlink") {
      expect(await readlink(destination)).toBe(external);
      expect(await readFile(join(external, "keep"), "utf8")).toBe("external data");
    }
  }
});

test.each(["foreign-file", "foreign-directory", "foreign-symlink", "malformed-release"] as const)(
  "preflight rejects a %s anywhere in the existing versions tree",
  async (kind) => {
    const { homeDir, root, run } = await harness();
    const staged = join(root, `staged-${kind}`);
    await writeRelease(staged, "0.2.0");
    const versions = join(homeDir, ".pi/agent/horsepower/versions");
    await mkdir(versions, { recursive: true });
    const existing = join(versions, kind === "malformed-release" ? "v0.1.0" : "foreign");
    if (kind === "foreign-file") await writeFile(existing, "foreign data");
    if (kind === "foreign-directory") await mkdir(existing);
    if (kind === "foreign-symlink") await symlink(root, existing);
    if (kind === "malformed-release") {
      await writeRelease(existing, "0.1.0");
      await writeFile(join(existing, "release-manifest.json"), "{malformed");
    }

    const result = await run(["preflight", staged, "--version", "0.2.0", "--json"]);

    expect(result).toMatchObject({ exitCode: 1, stdout: "" });
  },
);

test("preflight accepts an absent target when every other existing version is managed", async () => {
  const { homeDir, root, run } = await harness();
  const staged = join(root, "staged-valid-other-version");
  await writeRelease(staged, "0.2.0");
  await writeRelease(join(homeDir, ".pi/agent/horsepower/versions/v0.1.0"), "0.1.0");

  expect(await run(["preflight", staged, "--version", "0.2.0", "--json"])).toMatchObject({ exitCode: 0, stderr: "" });
});

test("preflight rejects symlinked destination ancestors and versions without touching external paths", async () => {
  for (const hostile of ["ancestor", "versions"] as const) {
    const { homeDir, root, run } = await harness();
    const staged = join(root, `staged-${hostile}`);
    await writeRelease(staged, "0.1.0");
    const external = join(root, `external-${hostile}`);
    await mkdir(external, { recursive: true });
    const marker = join(external, "keep");
    await writeFile(marker, "external data");

    if (hostile === "ancestor") {
      await mkdir(homeDir, { recursive: true });
      await symlink(external, join(homeDir, ".pi"));
    } else {
      const horsepowerRoot = join(homeDir, ".pi/agent/horsepower");
      await mkdir(horsepowerRoot, { recursive: true });
      await symlink(external, join(horsepowerRoot, "versions"));
    }

    const result = await run(["preflight", staged, "--version", "0.1.0", "--json"]);
    expect(result, hostile).toMatchObject({ exitCode: 1, stdout: "" });
    expect(await readFile(marker, "utf8"), hostile).toBe("external data");
  }
});

test("enable reconciles both links when a create mutates and then throws", async () => {
  let creates = 0;
  const { homeDir, run } = await harness({ linkOperations: {
    create: async (target: string, path: string) => {
      creates += 1;
      await symlink(target, path);
      if (creates === 2) throw new Error("injected post-create failure");
    },
    remove: async (path: string) => rm(path),
  } });
  const { managed, cli } = await installManagedFixture(homeDir);

  const result = await run(["enable", "--json"]);

  expect(result).toMatchObject({ exitCode: 1, stdout: "" });
  expect(result.stderr).toContain("injected post-create failure");
  await expect(lstat(join(homeDir, ".pi/agent/extensions/horsepower"))).rejects.toThrow();
  await expect(lstat(join(homeDir, ".pi/agent/skills/horsepower"))).rejects.toThrow();
});

test("enable rollback preserves an unexpected conflicting object created during failure", async () => {
  let creates = 0;
  const { homeDir, run } = await harness({ linkOperations: {
    create: async (target: string, path: string) => {
      creates += 1;
      if (creates === 2) { await writeFile(path, "foreign concurrent data"); throw new Error("mutation conflict"); }
      await symlink(target, path);
    },
    remove: async (path: string) => rm(path),
  } });
  const { skill } = await installManagedFixture(homeDir);

  const result = await run(["enable", "--json"]);

  expect(result.stderr).toContain("mutation conflict");
  expect(result.stderr).toContain("Rollback did not restore");
  expect(await readFile(skill, "utf8")).toBe("foreign concurrent data");
});

test("enable reports rollback errors truthfully when final state was restored", async () => {
  let creates = 0;
  let removes = 0;
  const { homeDir, run } = await harness({ linkOperations: {
    create: async (target: string, path: string) => { creates += 1; if (creates === 2) throw new Error("original create failure"); await symlink(target, path); },
    remove: async (path: string) => { removes += 1; await rm(path); if (removes === 1) throw new Error("post-remove rollback error"); },
  } });
  await installManagedFixture(homeDir);

  const result = await run(["enable", "--json"]);

  expect(result.stderr).toContain("original create failure");
  expect(result.stderr).toContain("post-remove rollback error");
  expect(result.stderr).toContain("rollback restored the original state");
  expect(result.stderr).not.toContain("rollback was incomplete");
  await expect(lstat(join(homeDir, ".pi/agent/extensions/horsepower"))).rejects.toThrow();
  await expect(lstat(join(homeDir, ".pi/agent/skills/horsepower"))).rejects.toThrow();
});

test("enable attempts every reconciliation and reports operation plus rollback failures", async () => {
  let creates = 0;
  const removed: string[] = [];
  const { homeDir, run } = await harness({ linkOperations: {
    create: async (target: string, path: string) => {
      creates += 1;
      await symlink(target, path);
      if (creates === 2) throw new Error("original mutation failure");
    },
    remove: async (path: string) => {
      removed.push(path);
      if (path.includes("extensions")) throw new Error("extension rollback failure");
      await rm(path);
    },
  } });
  const { managed, cli } = await installManagedFixture(homeDir);

  const result = await run(["enable", "--json"]);

  expect(removed).toEqual([
    join(homeDir, ".pi/agent/extensions/horsepower"),
    join(homeDir, ".pi/agent/skills/horsepower"),
  ]);
  expect(result.stderr).toContain("original mutation failure");
  expect(result.stderr).toContain("extension rollback failure");
  await expect(lstat(join(homeDir, ".pi/agent/skills/horsepower"))).rejects.toThrow();
});

test("enable rolls back the first link when creating the second link fails", async () => {
  let creates = 0;
  const { homeDir, run } = await harness({ linkOperations: {
    create: async (target: string, path: string) => { creates += 1; if (creates === 2) throw new Error("injected link failure"); await symlink(target, path); },
    remove: async (path: string) => rm(path),
  } });
  const { managed, cli } = await installManagedFixture(homeDir);
  const result = await run(["enable", "--json"]);
  expect(result).toMatchObject({ exitCode: 1, stdout: "" });
  await expect(lstat(join(homeDir, ".pi/agent/extensions/horsepower"))).rejects.toThrow();
  await expect(lstat(join(homeDir, ".pi/agent/skills/horsepower"))).rejects.toThrow();
  expect(await readlink(cli)).toBe(join(managed, "current/bin/horsepower"));
});

test("enable preflights both integration links and leaves both untouched on conflict", async () => {
  const { homeDir, run } = await harness();
  const { managed, cli } = await installManagedFixture(homeDir);
  const skill = join(homeDir, ".pi/agent/skills/horsepower"); await mkdir(dirname(skill), { recursive: true }); await writeFile(skill, "unrelated");
  const extension = join(homeDir, ".pi/agent/extensions/horsepower");
  expect(await run(["enable", "--json"])).toMatchObject({ exitCode: 1, stdout: "" });
  await expect(lstat(extension)).rejects.toThrow();
  expect(await readFile(skill, "utf8")).toBe("unrelated");
});

test("Chinese enable and disable conclusions preserve the /reload command", async () => {
  const { homeDir, run } = await harness();
  const { managed, cli } = await installManagedFixture(homeDir);
  await run(["configure", "--locale", "zh-CN", "--json"]);
  const enabled = JSON.parse((await run(["enable", "--json"])).stdout);
  expect(enabled).toMatchObject({ outputLocale: "zh-CN", summary: "Horsepower 已启用；请运行 /reload 或重启 Pi。" });
  const disabled = JSON.parse((await run(["disable", "--json"])).stdout);
  expect(disabled).toMatchObject({ outputLocale: "zh-CN", summary: "Horsepower 已禁用；请运行 /reload 或重启 Pi。" });
});

test("enable and disable are idempotent across repeated invocations", async () => {
  const { homeDir, run } = await harness();
  const { managed, cli } = await installManagedFixture(homeDir);
  expect(await run(["enable", "--json"])).toMatchObject({ exitCode: 0 });
  expect(await run(["enable", "--json"])).toMatchObject({ exitCode: 0 });
  expect(await run(["disable", "--json"])).toMatchObject({ exitCode: 0 });
  expect(await run(["disable", "--json"])).toMatchObject({ exitCode: 0 });
});

test("Chinese doctor localizes partial and conflict findings while preserving status and raw evidence", async () => {
  for (const kind of ["partial", "conflict"] as const) {
    const { homeDir, run } = await harness();
    const { managed, extension } = await installManagedFixture(homeDir);
    await run(["configure", "--locale", "zh-CN", "--json"]);
    await mkdir(dirname(extension), { recursive: true });
    if (kind === "partial") await symlink(join(managed, "current/pi/extensions/horsepower"), extension); else await writeFile(extension, "conflict");

    const check = JSON.parse((await run(["doctor", "--installation-only", "--json"])).stdout).data.checks[0];

    expect(check).toMatchObject({
      id: "installation",
      status: "error",
      integrationStatus: kind === "partial" ? "partially_enabled" : "conflict",
      message: kind === "partial" ? "Horsepower Pi 集成仅部分启用。" : "Horsepower Pi 集成存在冲突。",
      action: kind === "partial" ? "运行 horsepower enable 恢复缺失的链接，或运行 horsepower disable 保持禁用。" : "修复冲突，然后运行 horsepower enable 或 horsepower disable。",
      rawEvidence: expect.any(String),
    });
    if (kind === "partial") expect(check.rawEvidence).toBe("extension=owned; skill=absent");
    else {
      expect(check.rawEvidence).toContain("extension=conflict");
      expect(check.rawEvidence).toContain("non-symlink");
      expect(check.rawEvidence).toContain("skill=absent");
    }
  }
});

test("doctor distinguishes partially enabled and conflicting integration topology", async () => {
  for (const kind of ["partial", "conflict"] as const) {
    const { homeDir, run } = await harness();
    const { managed, extension } = await installManagedFixture(homeDir);
    await mkdir(dirname(extension), { recursive: true });
    if (kind === "partial") await symlink(join(managed, "current/pi/extensions/horsepower"), extension); else await writeFile(extension, "conflict");
    const result = JSON.parse((await run(["doctor", "--installation-only", "--json"])).stdout);
    expect(result).toMatchObject({ ok: false, data: { checks: [{ id: "installation", status: "error", integrationStatus: kind === "partial" ? "partially_enabled" : "conflict" }] } });
  }
});

test("enable and disable reject unsupported platforms before mutation", async () => {
  const { run } = await harness({ platform: "win32" });
  expect(await run(["enable", "--json"])).toMatchObject({ exitCode: 1, stdout: "" });
  expect(await run(["disable", "--json"])).toMatchObject({ exitCode: 1, stdout: "" });
});

test("enable verifies the active release and restores only absent Pi integration links", async () => {
  const { homeDir, run } = await harness();
  const { managed, cli } = await installManagedFixture(homeDir);
  await mkdir(join(managed, "state"), { recursive: true }); await writeFile(join(managed, "state/keep"), "state");
  const result = JSON.parse((await run(["enable", "--json"])).stdout);
  expect(result).toMatchObject({ ok: true, data: { integrationStatus: "enabled", reloadRequired: true } });
  expect(await readlink(join(homeDir, ".pi/agent/extensions/horsepower"))).toBe(join(managed, "current/pi/extensions/horsepower"));
  expect(await readlink(join(homeDir, ".pi/agent/skills/horsepower"))).toBe(join(managed, "current/pi/skills/horsepower"));
  expect(await readlink(cli)).toBe(join(managed, "current/bin/horsepower"));
  expect(await readFile(join(managed, "state/keep"), "utf8")).toBe("state");
});

test("disable restores the first link when removing the second link fails", async () => {
  let removes = 0;
  const { homeDir, run } = await harness({ linkOperations: {
    create: async (target: string, path: string) => symlink(target, path),
    remove: async (path: string) => { removes += 1; if (removes === 2) throw new Error("injected unlink failure"); await rm(path); },
  } });
  const { managed } = await installManagedFixture(homeDir, "enabled");
  expect(await run(["disable", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await readlink(join(homeDir, ".pi/agent/extensions/horsepower"))).toBe(join(managed, "current/pi/extensions/horsepower"));
  expect(await readlink(join(homeDir, ".pi/agent/skills/horsepower"))).toBe(join(managed, "current/pi/skills/horsepower"));
});

test("disable removes only owned Pi integration links and preserves CLI, release, and user data", async () => {
  const { homeDir, run } = await harness();
  const { managed, extension, skill, cli } = await installManagedFixture(homeDir, "enabled");
  await writeFile(join(managed, "settings.json"), "{}\n"); await writeFile(join(managed, "model-slots.json"), "{}\n");
  await mkdir(join(managed, "state/handoffs"), { recursive: true }); await writeFile(join(managed, "state/handoffs/keep"), "evidence");
  const result = JSON.parse((await run(["disable", "--json"])).stdout);
  expect(result).toMatchObject({ ok: true, data: { integrationStatus: "disabled", reloadRequired: true } });
  await expect(lstat(extension)).rejects.toThrow(); await expect(lstat(skill)).rejects.toThrow();
  expect(await readlink(cli)).toBe(join(managed, "current/bin/horsepower"));
  expect(await readlink(join(managed, "current"))).toBe("versions/v0.1.0");
  expect(await readFile(join(managed, "state/handoffs/keep"), "utf8")).toBe("evidence");
});

test("safe uninstall removes only owned topology while preserving user data", async () => {
  const { homeDir, cwd, run } = await harness();
  const hp = join(homeDir, ".pi/agent/horsepower");
  const version = join(hp, "versions/v0.1.0-alpha.1");
  await writeRelease(version, "0.1.0-alpha.1");
  await symlink("versions/v0.1.0-alpha.1", join(hp, "current"));
  const links = [[join(homeDir, ".pi/agent/extensions/horsepower"), join(hp, "current/pi/extensions/horsepower")], [join(homeDir, ".pi/agent/skills/horsepower"), join(hp, "current/pi/skills/horsepower")], [join(homeDir, ".local/bin/horsepower"), join(hp, "current/bin/horsepower")]];
  for (const [path, target] of links) { await mkdir(dirname(path!), { recursive: true }); await symlink(target!, path!); }
  for (const name of ["model-slots.json", "settings.json"]) await writeFile(join(hp, name), "{}\n");
  for (const name of ["memory", "state", "standards", "workflows", "personas"]) await mkdir(join(hp, name));
  await mkdir(join(cwd, ".pi/horsepower"), { recursive: true }); await writeFile(join(cwd, ".pi/horsepower/model-slots.json"), "{}\n");

  expect(await run(["uninstall", "--json"])).toMatchObject({ exitCode: 0 });
  for (const [path] of links) await expect(lstat(path!)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(hp, "current"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(hp, "versions"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(hp, "settings.json"), "utf8")).toBe("{}\n");
  expect(await readFile(join(cwd, ".pi/horsepower/model-slots.json"), "utf8")).toBe("{}\n");
});

test("uninstall refuses an arbitrary version directory with a trivial manifest and preserves it", async () => {
  const { homeDir, run } = await harness();
  const release = join(homeDir, ".pi/agent/horsepower/versions/v0.1.0");
  await mkdir(release, { recursive: true });
  await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(release, "user-data.txt"), "must remain");

  expect(await run(["uninstall", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await readFile(join(release, "user-data.txt"), "utf8")).toBe("must remain");
});

test("uninstall refuses regular, unrelated, and hostile symlink targets without following them", async () => {
  const { homeDir, root, run } = await harness();
  const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "keep"), "safe");
  const hp = join(homeDir, ".pi/agent/horsepower"); await mkdir(hp, { recursive: true }); await symlink(outside, join(hp, "current"));
  const extension = join(homeDir, ".pi/agent/extensions/horsepower"); await mkdir(dirname(extension), { recursive: true }); await writeFile(extension, "foreign");
  const result = await run(["uninstall", "--json"]);
  expect(result.exitCode).toBe(1);
  expect(await readFile(extension, "utf8")).toBe("foreign");
  expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
  expect(await readlink(join(hp, "current"))).toBe(outside);
});

test("preflight enforces semantic release compatibility boundaries", async () => {
  for (const [name, compatibility, expectedExit] of [
    ["boundaries", { node: ">=22.19.0", pi: ">=0.80.10 <0.82.0", openspec: ">=1.6.0 <2.0.0" }, 0],
    ["arbitrary-node", { node: "supported", pi: ">=0.80.10 <0.82.0", openspec: ">=1.6.0 <2.0.0" }, 1],
    ["old-node", { node: ">=22.18.0", pi: ">=0.80.10 <0.82.0", openspec: ">=1.6.0 <2.0.0" }, 1],
    ["arbitrary-pi", { node: ">=22.19.0", pi: "compatible", openspec: ">=1.6.0 <2.0.0" }, 1],
    ["old-pi", { node: ">=22.19.0", pi: "0.80.9", openspec: ">=1.6.0 <2.0.0" }, 1],
    ["arbitrary-openspec", { node: ">=22.19.0", pi: ">=0.80.10 <0.82.0", openspec: "latest" }, 1],
    ["old-openspec", { node: ">=22.19.0", pi: ">=0.80.10 <0.82.0", openspec: ">=1.5.9" }, 1],
  ] as const) {
    const { root, run } = await harness();
    const staged = join(root, `staged-${name}`);
    await writeRelease(staged, "0.1.0");
    const manifestPath = join(staged, "release-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.compatibility = compatibility;
    await writeFile(manifestPath, JSON.stringify(manifest));

    expect(await run(["preflight", staged, "--version", "0.1.0", "--json"]), name).toMatchObject({ exitCode: expectedExit });
  }
});

test("doctor rejects trusted installation ancestor symlinks without following or mutating them", async () => {
  for (const hostile of ["horsepower-root", "extensions-parent", "skills-parent", "cli-parent"] as const) {
    const { homeDir, root, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    const external = join(root, `external-${hostile}`);
    const managedRoot = hostile === "horsepower-root" ? external : hp;
    await writeRelease(join(managedRoot, "versions/v0.1.0"), "0.1.0");
    await symlink("versions/v0.1.0", join(managedRoot, "current"));
    const marker = join(external, "keep");
    await mkdir(external, { recursive: true });
    await writeFile(marker, "external data");

    if (hostile === "horsepower-root") {
      await mkdir(dirname(hp), { recursive: true });
      await symlink(external, hp);
    }

    for (const [name, parent, target] of [
      ["extensions-parent", join(homeDir, ".pi/agent/extensions"), join(hp, "current/pi/extensions/horsepower")],
      ["skills-parent", join(homeDir, ".pi/agent/skills"), join(hp, "current/pi/skills/horsepower")],
      ["cli-parent", join(homeDir, ".local/bin"), join(hp, "current/bin/horsepower")],
    ] as const) {
      const actualParent = hostile === name ? external : parent;
      await mkdir(dirname(parent), { recursive: true });
      if (hostile === name) await symlink(external, parent);
      else await mkdir(parent, { recursive: true });
      await symlink(target, join(actualParent, "horsepower"));
    }

    const result = await run(["doctor", "--json"]);
    const installation = JSON.parse(result.stdout).data.checks.find((check: { id: string }) => check.id === "installation");
    expect(result, hostile).toMatchObject({ exitCode: 1, stderr: "" });
    expect(installation, hostile).toMatchObject({
      status: "error",
      message: "Horsepower installation is invalid.",
      rawEvidence: expect.stringContaining(hostile === "horsepower-root" ? hp : hostile === "extensions-parent" ? join(homeDir, ".pi/agent/extensions") : hostile === "skills-parent" ? join(homeDir, ".pi/agent/skills") : join(homeDir, ".local/bin")),
      action: "Install or repair Horsepower from an official release.",
    });
    expect(await readFile(marker, "utf8"), hostile).toBe("external data");
    expect(await readlink(hostile === "horsepower-root" ? hp : hostile === "extensions-parent" ? join(homeDir, ".pi/agent/extensions") : hostile === "skills-parent" ? join(homeDir, ".pi/agent/skills") : join(homeDir, ".local/bin")), hostile).toBe(external);
  }
});

test("doctor reports malformed managed release topology as actionable installation checks", async () => {
  for (const hostile of [
    "trivial", "compatibility", "entrypoint", "digest-shape", "digest-mismatch", "symlink",
    "extra-top-level", "extra-compatibility", "extra-entrypoint", "extra-digest",
  ] as const) {
    const { homeDir, root, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    const release = join(hp, "versions/v0.1.0");
    await writeRelease(release, "0.1.0");
    const manifestPath = join(release, "release-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (hostile === "trivial") await writeFile(manifestPath, JSON.stringify({ version: "0.1.0" }));
    if (hostile === "compatibility") {
      manifest.compatibility = { node: "", pi: ">=0.80.10 <0.82.0", openspec: ">=1.6.0 <2.0.0" };
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "entrypoint") {
      manifest.entryPoints.cli = "bin/not-horsepower";
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "digest-shape") {
      manifest.digests[releaseEntryPoints.cli] = "not-a-sha256";
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "digest-mismatch") {
      manifest.digests[releaseEntryPoints.cli] = "0".repeat(64);
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "extra-top-level") {
      manifest.extra = true;
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "extra-compatibility") {
      manifest.compatibility.extra = "unsupported";
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "extra-entrypoint") {
      manifest.entryPoints.extra = "bin/foreign";
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "extra-digest") {
      manifest.digests.foreign = "0".repeat(64);
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "symlink") {
      const external = join(root, "external-cli");
      await writeFile(external, "external");
      await rm(join(release, releaseEntryPoints.cli));
      await symlink(external, join(release, releaseEntryPoints.cli));
    }
    await symlink("versions/v0.1.0", join(hp, "current"));

    const result = await run(["doctor", "--json"]);
    expect(result.stdout, hostile).not.toBe("");
    expect(result.stderr, hostile).toBe("");
    expect(result.exitCode, hostile).toBe(1);
    expect(JSON.parse(result.stdout).data.checks.find((check: { id: string }) => check.id === "installation"), hostile).toMatchObject({
      status: "error",
      message: "Horsepower installation is invalid.",
      rawEvidence: expect.any(String),
      action: "Install or repair Horsepower from an official release.",
    });
  }
});

test("doctor rejects extra foreign data anywhere in an otherwise valid managed versions tree", async () => {
  for (const foreign of ["directory", "file", "symlink", "malformed-release"] as const) {
    const { homeDir, root, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    await writeRelease(join(hp, "versions/v0.1.0"), "0.1.0");
    await symlink("versions/v0.1.0", join(hp, "current"));
    for (const [path, target] of [
      [join(homeDir, ".pi/agent/extensions/horsepower"), join(hp, "current/pi/extensions/horsepower")],
      [join(homeDir, ".pi/agent/skills/horsepower"), join(hp, "current/pi/skills/horsepower")],
      [join(homeDir, ".local/bin/horsepower"), join(hp, "current/bin/horsepower")],
    ] as const) {
      await mkdir(dirname(path), { recursive: true });
      await symlink(target, path);
    }
    const foreignPath = join(hp, "versions", foreign === "malformed-release" ? "v0.2.0" : `foreign-${foreign}`);
    if (foreign === "directory") await mkdir(foreignPath);
    if (foreign === "file") await writeFile(foreignPath, "foreign");
    if (foreign === "symlink") {
      const outside = join(root, "outside-version");
      await mkdir(outside);
      await symlink(outside, foreignPath);
    }
    if (foreign === "malformed-release") {
      await mkdir(foreignPath);
      await writeFile(join(foreignPath, "release-manifest.json"), JSON.stringify({ version: "0.2.0" }));
    }

    const result = await run(["doctor", "--json"]);
    expect(result, foreign).toMatchObject({ exitCode: 1, stderr: "" });
    expect(JSON.parse(result.stdout).data.checks.find((check: { id: string }) => check.id === "installation"), foreign).toMatchObject({
      status: "error",
      message: "Horsepower installation is invalid.",
      rawEvidence: expect.stringContaining(foreignPath),
      action: "Install or repair Horsepower from an official release.",
    });
  }
});

test("current ownership and uninstall reject an external symlinked manifest", async () => {
  const { homeDir, root, run } = await harness();
  const hp = join(homeDir, ".pi/agent/horsepower");
  const release = join(hp, "versions/v0.1.0");
  await mkdir(release, { recursive: true });
  const externalManifest = join(root, "external-release-manifest.json");
  await writeFile(externalManifest, JSON.stringify({ version: "0.1.0" }));
  await symlink(externalManifest, join(release, "release-manifest.json"));
  await symlink("versions/v0.1.0", join(hp, "current"));

  const doctor = await run(["doctor", "--json"]);
  expect(JSON.parse(doctor.stdout).data.checks.find((check: { id: string }) => check.id === "installation")).toMatchObject({ status: "error" });
  expect((await run(["uninstall", "--json"])).exitCode).toBe(1);
  expect(await readFile(externalManifest, "utf8")).toContain("0.1.0");
  expect(await readlink(join(release, "release-manifest.json"))).toBe(externalManifest);
});

test("uninstall removes only a verified direct current release target", async () => {
  for (const deceptive of ["nested", "dangling", "mismatch", "invalid-version"] as const) {
    const { homeDir, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    const versions = join(hp, "versions");
    await mkdir(versions, { recursive: true });
    let target: string;
    if (deceptive === "nested") {
      const release = join(versions, "container/v0.1.0");
      await mkdir(release, { recursive: true });
      await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "0.1.0" }));
      target = "versions/container/v0.1.0";
    } else if (deceptive === "dangling") {
      target = "versions/v0.1.0";
    } else if (deceptive === "mismatch") {
      const release = join(versions, "v0.1.0");
      await mkdir(release);
      await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "0.2.0" }));
      target = "versions/v0.1.0";
    } else {
      const release = join(versions, "v01.0.0");
      await mkdir(release);
      await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "01.0.0" }));
      target = "versions/v01.0.0";
    }
    await symlink(target, join(hp, "current"));
    const result = await run(["uninstall", "--json"]);
    expect(result.exitCode, deceptive).toBe(1);
    expect(await readlink(join(hp, "current"))).toBe(target);
  }
});

test("uninstall and purge reject a symlinked home trust root without touching external data", async () => {
  const root = await temp();
  const externalHome = join(root, "external-home");
  const homeDir = join(root, "home-link");
  const cwd = join(root, "project");
  await mkdir(join(externalHome, ".pi/agent/horsepower"), { recursive: true });
  await mkdir(cwd);
  const marker = join(externalHome, ".pi/agent/horsepower/keep");
  await writeFile(marker, "external data");
  await symlink(externalHome, homeDir);
  const { createCli } = await import("../../src/cli/app.js");
  const cli = createCli({
    homeDir,
    cwd,
    platform: "linux",
    models,
    runOpenSpec: async () => ({ code: 1, stdout: "", stderr: "" }),
  });

  expect(await cli.run(["uninstall", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await cli.run(["purge", "--yes", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await readFile(marker, "utf8")).toBe("external data");
  expect(await readlink(homeDir)).toBe(externalHome);
});

test("purge rejects a symlinked project trust root without touching external data", async () => {
  const root = await temp();
  const homeDir = join(root, "home");
  const externalProject = join(root, "external-project");
  const cwd = join(root, "project-link");
  await mkdir(homeDir);
  await mkdir(join(externalProject, ".pi/horsepower"), { recursive: true });
  const marker = join(externalProject, ".pi/horsepower/keep");
  await writeFile(marker, "external data");
  await symlink(externalProject, cwd);
  const { createCli } = await import("../../src/cli/app.js");
  const cli = createCli({
    homeDir,
    cwd,
    platform: "linux",
    models,
    runOpenSpec: async () => ({ code: 1, stdout: "", stderr: "" }),
  });

  expect(await cli.run(["purge", "--yes", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await readFile(marker, "utf8")).toBe("external data");
  expect(await readlink(cwd)).toBe(externalProject);
});

test("uninstall and purge refuse a symlinked Horsepower root without following it", async () => {
  const { homeDir, root, run } = await harness();
  const outside = join(root, "outside-root"); await mkdir(outside); await writeFile(join(outside, "keep"), "safe");
  const hp = join(homeDir, ".pi/agent/horsepower"); await mkdir(dirname(hp), { recursive: true }); await symlink(outside, hp);
  expect((await run(["uninstall", "--json"])).exitCode).toBe(1);
  expect((await run(["purge", "--yes", "--json"])).exitCode).toBe(1);
  expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
  expect(await readlink(hp)).toBe(outside);
});

test("uninstall refuses an unowned versions tree and never follows a versions symlink", async () => {
  for (const hostile of ["symlink", "unmanaged"] as const) {
    const { homeDir, root, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    await mkdir(hp, { recursive: true });
    if (hostile === "symlink") {
      const outside = join(root, "outside-versions");
      await mkdir(outside); await writeFile(join(outside, "keep"), "safe");
      await symlink(outside, join(hp, "versions"));
      expect((await run(["uninstall", "--json"])).exitCode).toBe(1);
      expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
    } else {
      await mkdir(join(hp, "versions/not-a-managed-release"), { recursive: true });
      await writeFile(join(hp, "versions/not-a-managed-release/keep"), "safe");
      expect((await run(["uninstall", "--json"])).exitCode).toBe(1);
      expect(await readFile(join(hp, "versions/not-a-managed-release/keep"), "utf8")).toBe("safe");
    }
  }
});

test("purge refuses while any installed code or stable link remains and preserves all data", async () => {
  for (const remaining of ["owned-link-and-versions", "unowned-link"] as const) {
    const { homeDir, cwd, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    const projectData = join(cwd, ".pi/horsepower/keep");
    const extension = join(homeDir, ".pi/agent/extensions/horsepower");
    await mkdir(dirname(projectData), { recursive: true });
    await writeFile(projectData, "project data");
    await mkdir(join(hp, "memory"), { recursive: true });
    await writeFile(join(hp, "memory/keep"), "global data");
    await mkdir(dirname(extension), { recursive: true });

    if (remaining === "owned-link-and-versions") {
      await writeRelease(join(hp, "versions/v0.1.0"), "0.1.0");
      await symlink(join(hp, "current/pi/extensions/horsepower"), extension);
    } else {
      await symlink("/unrelated", extension);
    }

    const result = await run(["purge", "--yes", "--json"]);
    expect(result, remaining).toMatchObject({ exitCode: 1, stdout: "" });
    expect(result.stderr).toContain("uninstall");
    expect(await readFile(join(hp, "memory/keep"), "utf8")).toBe("global data");
    expect(await readFile(projectData, "utf8")).toBe("project data");
    expect(await readlink(extension)).toBe(remaining === "owned-link-and-versions" ? join(hp, "current/pi/extensions/horsepower") : "/unrelated");
  }
});

test("purge refuses project and global symlinked parent components", async () => {
  for (const scope of ["project", "global"] as const) {
    const { homeDir, cwd, root, run } = await harness();
    const outside = join(root, `outside-${scope}`);
    await mkdir(join(outside, "horsepower"), { recursive: true });
    await writeFile(join(outside, "horsepower/keep"), "external data");
    const parent = scope === "project" ? join(cwd, ".pi") : join(homeDir, ".pi");
    await mkdir(dirname(parent), { recursive: true });
    await symlink(outside, parent);

    expect(await run(["purge", "--yes", "--json"]), scope).toMatchObject({ exitCode: 1 });
    expect(await readFile(join(outside, "horsepower/keep"), "utf8"), scope).toBe("external data");
    expect(await readlink(parent), scope).toBe(outside);
  }
});

test("purge requires confirmation and --yes noninteractively, then removes only Horsepower data", async () => {
  const { homeDir, cwd, run } = await harness({ interactive: false });
  await mkdir(join(homeDir, ".pi/agent/horsepower/memory"), { recursive: true });
  await mkdir(join(cwd, ".pi/horsepower"), { recursive: true });
  expect(await run(["purge", "--json"])).toMatchObject({ exitCode: 2 });
  expect(await stat(join(homeDir, ".pi/agent/horsepower/memory"))).toBeTruthy();
  expect(await run(["purge", "--yes", "--json"])).toMatchObject({ exitCode: 0 });
  await expect(lstat(join(homeDir, ".pi/agent/horsepower"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(cwd, ".pi/horsepower"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("interactive purge requires an explicit yes and a negative answer changes nothing", async () => {
  const confirmNo = vi.fn(async () => false);
  const rejected = await harness({ interactive: true, confirm: confirmNo });
  await mkdir(join(rejected.homeDir, ".pi/agent/horsepower/memory"), { recursive: true });
  await writeFile(join(rejected.homeDir, ".pi/agent/horsepower/memory/keep"), "safe");
  await mkdir(join(rejected.cwd, ".pi/horsepower"), { recursive: true });
  expect(await rejected.run(["purge", "--json"])).toMatchObject({ exitCode: 0 });
  expect(confirmNo).toHaveBeenCalledOnce();
  expect(await readFile(join(rejected.homeDir, ".pi/agent/horsepower/memory/keep"), "utf8")).toBe("safe");
  expect(await stat(join(rejected.cwd, ".pi/horsepower"))).toBeTruthy();

  const confirmYes = vi.fn(async () => true);
  const accepted = await harness({ interactive: true, confirm: confirmYes });
  await mkdir(join(accepted.homeDir, ".pi/agent/horsepower/memory"), { recursive: true });
  await mkdir(join(accepted.cwd, ".pi/horsepower"), { recursive: true });
  expect(await accepted.run(["purge", "--json"])).toMatchObject({ exitCode: 0 });
  expect(confirmYes).toHaveBeenCalledOnce();
  await expect(lstat(join(accepted.homeDir, ".pi/agent/horsepower"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("config reads reject global and project ancestor and file symlinks", async () => {
  const validSlots = '{"slots":{"judgment":{"model":"provider/judge","thinking":"high"},"craft":{"model":"provider/craft","thinking":"medium"},"utility":{"model":"provider/util","thinking":"low"}}}\n';
  for (const [scope, component] of [
    ["global", ".pi"],
    ["global", ".pi/agent"],
    ["global", ".pi/agent/horsepower"],
    ["global", ".pi/agent/horsepower/model-slots.json"],
    ["project", ".pi"],
    ["project", ".pi/horsepower"],
    ["project", ".pi/horsepower/model-slots.json"],
  ] as const) {
    const { homeDir, cwd, root, run } = await harness();
    const trustedRoot = scope === "global" ? homeDir : cwd;
    const external = join(root, `external-read-${scope}-${component.replaceAll("/", "-")}`);
    const link = join(trustedRoot, component);
    const finalFile = component.endsWith(".json");
    await mkdir(dirname(link), { recursive: true });
    if (finalFile) await writeFile(external, validSlots);
    else {
      await mkdir(external, { recursive: true });
      const nested = scope === "global"
        ? component === ".pi" ? "agent/horsepower" : component === ".pi/agent" ? "horsepower" : ""
        : component === ".pi" ? "horsepower" : "";
      await mkdir(join(external, nested), { recursive: true });
      await writeFile(join(external, nested, "model-slots.json"), validSlots);
    }
    await symlink(external, link);
    if (scope === "project") {
      const globalSlots = join(homeDir, ".pi/agent/horsepower/model-slots.json");
      await mkdir(dirname(globalSlots), { recursive: true });
      await writeFile(globalSlots, validSlots);
    }

    const result = await run(["slots", "--json"]);
    expect(result, `${scope}:${component}`).toMatchObject({ exitCode: 1, stdout: "" });
    expect(await readlink(link), `${scope}:${component}`).toBe(external);
    if (finalFile) expect(await readFile(external, "utf8"), `${scope}:${component}`).toBe(validSlots);
  }
});

test("config writes reject global and project ancestor and file symlinks without changing targets", async () => {
  const validSlots = '{"slots":{"judgment":{"model":"provider/judge","thinking":"high"},"craft":{"model":"provider/craft","thinking":"medium"},"utility":{"model":"provider/util","thinking":"low"}},"keep":"external"}\n';
  for (const [scope, component] of [
    ["global", ".pi"],
    ["global", ".pi/agent"],
    ["global", ".pi/agent/horsepower"],
    ["global", ".pi/agent/horsepower/model-slots.json"],
    ["project", ".pi"],
    ["project", ".pi/horsepower"],
    ["project", ".pi/horsepower/model-slots.json"],
  ] as const) {
    const { homeDir, cwd, root, run } = await harness();
    const trustedRoot = scope === "global" ? homeDir : cwd;
    const external = join(root, `external-write-${scope}-${component.replaceAll("/", "-")}`);
    const link = join(trustedRoot, component);
    const finalFile = component.endsWith(".json");
    await mkdir(dirname(link), { recursive: true });
    if (finalFile) await writeFile(external, validSlots);
    else {
      await mkdir(external, { recursive: true });
      const nested = scope === "global"
        ? component === ".pi" ? "agent/horsepower" : component === ".pi/agent" ? "horsepower" : ""
        : component === ".pi" ? "horsepower" : "";
      await mkdir(join(external, nested), { recursive: true });
      await writeFile(join(external, nested, "model-slots.json"), validSlots);
    }
    await symlink(external, link);
    if (scope === "project") {
      const globalSlots = join(homeDir, ".pi/agent/horsepower/model-slots.json");
      await mkdir(dirname(globalSlots), { recursive: true });
      await writeFile(globalSlots, validSlots);
    }
    const targetFile = finalFile ? external : join(external,
      scope === "global" ? component === ".pi" ? "agent/horsepower/model-slots.json" : component === ".pi/agent" ? "horsepower/model-slots.json" : "model-slots.json"
        : component === ".pi" ? "horsepower/model-slots.json" : "model-slots.json");
    const before = await readFile(targetFile);
    const argv = scope === "global"
      ? ["set", "vision", "--fallback", "utility", "--json"]
      : ["set", "vision", "--fallback", "utility", "--scope", "project", "--json"];

    const result = await run(argv);
    expect(result, `${scope}:${component}`).toMatchObject({ exitCode: 2, stdout: "" });
    expect(await readFile(targetFile), `${scope}:${component}`).toEqual(before);
    expect(await readlink(link), `${scope}:${component}`).toBe(external);
  }
});

test("config commands reject final global and project settings symlinks", async () => {
  for (const scope of ["global", "project"] as const) {
    const { homeDir, cwd, root, run } = await harness();
    await run(setupArgs);
    const settings = scope === "global" ? join(homeDir, ".pi/agent/horsepower/settings.json") : join(cwd, ".pi/horsepower/settings.json");
    const external = join(root, `external-${scope}-settings.json`);
    const bytes = Buffer.from('{"webhook":{"enabled":false},"keep":"external"}\n');
    await mkdir(dirname(settings), { recursive: true });
    await writeFile(external, bytes);
    await rm(settings, { force: true });
    await symlink(external, settings);

    const result = scope === "global"
      ? await run(["webhook", "disable", "--json"])
      : await run(setupArgs);
    expect(result, scope).toMatchObject({ exitCode: scope === "global" ? 1 : 2, stdout: "" });
    expect(await readFile(external), scope).toEqual(bytes);
    expect(await readlink(settings), scope).toBe(external);
  }
});

test("purge refuses foreign regular global and project roots", async () => {
  for (const scope of ["global", "project"] as const) {
    const { homeDir, cwd, run } = await harness();
    const root = scope === "global" ? join(homeDir, ".pi/agent/horsepower") : join(cwd, ".pi/horsepower");
    await mkdir(dirname(root), { recursive: true });
    await writeFile(root, `foreign-${scope}`);

    expect(await run(["purge", "--yes", "--json"]), scope).toMatchObject({ exitCode: 1, stdout: "" });
    expect(await readFile(root, "utf8"), scope).toBe(`foreign-${scope}`);
  }
});

test("purge refuses FIFO and socket Horsepower roots without replacing them", async () => {
  for (const kind of ["fifo", "socket"] as const) {
    const { homeDir, run } = await harness();
    const root = join(homeDir, ".pi/agent/horsepower");
    await mkdir(dirname(root), { recursive: true });
    let close: () => Promise<void> = async () => undefined;
    if (kind === "fifo") await execFileAsync("mkfifo", [root]);
    else {
      const server = createServer();
      await new Promise<void>((resolve, reject) => server.listen(root, resolve).once("error", reject));
      close = async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    try {
      expect(await run(["purge", "--yes", "--json"]), kind).toMatchObject({ exitCode: 1, stdout: "" });
      const info = await lstat(root);
      expect(kind === "fifo" ? info.isFIFO() : info.isSocket(), kind).toBe(true);
    } finally {
      await close();
    }
  }
});

test("purge refuses directories with objects outside the Horsepower user-data topology", async () => {
  for (const scope of ["global", "project"] as const) {
    const { homeDir, cwd, run } = await harness();
    const root = scope === "global" ? join(homeDir, ".pi/agent/horsepower") : join(cwd, ".pi/horsepower");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "foreign.txt"), `foreign-${scope}`);

    expect(await run(["purge", "--yes", "--json"]), scope).toMatchObject({ exitCode: 1, stdout: "" });
    expect(await readFile(join(root, "foreign.txt"), "utf8"), scope).toBe(`foreign-${scope}`);
  }
});

test("doctor blocks model-registry validation when slot validation fails", async () => {
  const { run } = await harness();
  const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
  expect(checks.find((check: { id: string }) => check.id === "configuration")).toMatchObject({ status: "error" });
  expect(checks.find((check: { id: string }) => check.id === "model-registry")).toMatchObject({
    status: "skipped",
    message: expect.stringContaining("valid slot configuration"),
    action: "Run horsepower setup.",
  });
});

test("unsupported platforms reject mutating and install-management commands but allow diagnostics", async () => {
  const { root, run } = await harness({ platform: "win32" });
  const staged = join(root, "staged");
  await writeRelease(staged, "0.1.0");
  for (const argv of [
    setupArgs,
    ["configure", "--craft", "provider/craft", "--craft-thinking", "medium", "--json"],
    ["set", "vision", "--fallback", "utility", "--json"],
    ["unset", "vision", "--json"],
    ["webhook", "disable", "--json"],
    ["preflight", staged, "--version", "0.1.0", "--json"],
    ["uninstall", "--json"],
    ["purge", "--yes", "--json"],
  ]) {
    const result = await run(argv);
    expect(result, argv[0]).toMatchObject({ exitCode: 1, stdout: "" });
    expect(result.stderr, argv[0]).toContain("Unsupported platform: win32");
  }
  expect(await run(["slots", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await run(["configure", "--json"])).toMatchObject({ exitCode: 0 });
  expect(await run(["doctor", "--json"])).toMatchObject({ stderr: "" });
});

test("CLI never mutates Pi model/provider configuration or API keys", async () => {
  const { homeDir, run } = await harness();
  const provider = join(homeDir, ".pi/agent/models.json");
  const auth = join(homeDir, ".pi/agent/auth.json");
  await mkdir(dirname(provider), { recursive: true }); await writeFile(provider, '{"private":"model"}'); await writeFile(auth, '{"apiKey":"secret"}');
  await run(setupArgs); await run(["doctor", "--json"]); await run(["uninstall", "--json"]);
  expect(await readFile(provider, "utf8")).toBe('{"private":"model"}');
  expect(await readFile(auth, "utf8")).toBe('{"apiKey":"secret"}');
});
