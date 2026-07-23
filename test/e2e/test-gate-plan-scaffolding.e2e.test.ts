import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeAll, expect, test } from "vitest";
import { selectedE2ELocales } from "../fixtures/e2e-locales.js";
import { realPiAcceptanceScenarios } from "../fixtures/test-gate-authoring.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const configuredExtensionPath = process.env.HORSEPOWER_TEST_PLAN_EXTENSION_PATH;
const productionExtensionPath = configuredExtensionPath
  ? resolve(configuredExtensionPath)
  : join(repositoryRoot, "dist", "extension", "index.js");
const productionExtensionHref = pathToFileURL(productionExtensionPath).href;
const roots: string[] = [];
beforeAll(async () => { await promisify(execFile)(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot }); });
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type Scenario = "confirmed" | "canceled" | "relevant-drift" | "prose-drift" | "completion";

async function runPiContract(locale: "en" | "zh-CN", scenario: Scenario) {
  const root = await mkdtemp(join(tmpdir(), `horsepower-test-plan-pi-${locale}-`)); roots.push(root);
  const agentDir = join(root, ".pi", "agent"); await mkdir(agentDir, { recursive: true });
  const extension = join(root, "test-plan-contract.mjs");
  await writeFile(extension, `
export default function (pi) {
  pi.registerCommand("test-gate-plan-contract", {
    description: "Real Pi test-and-gate acceptance contract scaffold",
    handler: async (args, ctx) => {
      const locale = ${JSON.stringify(locale)};
      const scenario = args || "confirmed";
      const intensity = await ctx.ui.select(locale === "zh-CN" ? "显式选择 testIntensity（无默认值）" : "Explicitly select testIntensity (no default)", ["targeted", "standard", "exhaustive", "custom"]);
      if (!intensity) { ctx.ui.notify(locale === "zh-CN" ? "已取消；plan 保持 unconfirmed" : "Canceled; plan remains unconfirmed", "info"); return; }
      const strictness = await ctx.ui.select(locale === "zh-CN" ? "显式选择 gateStrictness（无默认值）" : "Explicitly select gateStrictness (no default)", ["required", "strict", "release", "custom"]);
      if (!strictness) return;
      ctx.ui.notify(locale === "zh-CN"
        ? "TC-1 · real Pi E2E · fixture：官方 design/tasks · 操作：组合确认 · 预期：一个 campaign/kickoff · 失败含义：授权泄漏；G-1 · completion · 通过：claim-matched evidence · waiver：具体替代证据"
        : "TC-1 · real Pi E2E · fixture: official design/tasks · action: combined confirmation · expected: one campaign/kickoff · failure meaning: authority leak; G-1 · completion · pass: claim-matched evidence · waiver: concrete alternative evidence", "info");
      const confirmed = await ctx.ui.confirm(locale === "zh-CN" ? "组合确认" : "Combined confirmation", "tasks=3.1,3.2; mode=multi_agent; testIntensity=" + intensity + "; gateStrictness=" + strictness + "; TC-1; G-1");
      if (!confirmed) { ctx.ui.notify(locale === "zh-CN" ? "已取消；未创建 campaign，active campaign 未改变" : "Canceled; no campaign created and active campaign unchanged", "info"); return; }
      if (scenario === "relevant-drift") { ctx.ui.notify(locale === "zh-CN" ? "TEST_PLAN_DRIFT：dispatch 已阻止" : "TEST_PLAN_DRIFT: dispatch blocked", "error"); return; }
      if (scenario === "prose-drift") { ctx.ui.notify(locale === "zh-CN" ? "仅 prose 变化；digest 保持一致，dispatch 已授权" : "Prose-only change; digest unchanged and dispatch authorized", "info"); return; }
      if (scenario === "completion") { ctx.ui.notify("completed: acceptance=task:3.1 evidence=e2e-current TC-1=e2e-current G-1=e2e-current", "info"); return; }
      ctx.ui.notify(locale === "zh-CN" ? "已创建一个 campaign 与一个 kickoff" : "Created one campaign and one kickoff", "info");
    },
  });
}
`);
  const child = spawn("pi", ["--mode", "rpc", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions", "--extension", extension], {
    cwd: root, env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const events: Array<Record<string, any>> = []; let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const event = JSON.parse(line); events.push(event);
    if (event.type === "extension_ui_request") {
      if (event.method === "select") child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, value: event.options[1] })}\n`);
      if (event.method === "confirm") child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: scenario !== "canceled" })}\n`);
    }
    if (event.type === "response" && event.id === "scenario") child.stdin.end();
  });
  child.stdin.write(`${JSON.stringify({ id: "scenario", type: "prompt", message: `/test-gate-plan-contract ${scenario}` })}\n`);
  const code = await new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  return { code, stderr, events, text: JSON.stringify(events) };
}

async function runProductionCampaign(locale: "en" | "zh-CN", confirm: boolean) {
  const root = await mkdtemp(join(tmpdir(), `horsepower-production-plan-${locale}-`)); roots.push(root);
  const agentDir = join(root, ".pi", "agent"); await mkdir(agentDir, { recursive: true });
  const extension = join(root, "production-campaign-fixture.mjs");
  await writeFile(extension, `import { registerHorsepowerExtension } from ${JSON.stringify(productionExtensionHref)};
const plan = {
  changeId: "change-plan", testIntensity: "standard", gateStrictness: "strict", digest: "${"d".repeat(64)}", coverageRefs: [], nonApplicability: [],
  cases: [{ id: "TC-1", title: "Combined confirmation", maps: ["task:1.1"], level: "integration", purpose: "Prove confirmed scope", preconditions: "Official design fixture", action: "Invoke production command", expected: "One campaign and kickoff", failure: "Authority leak", disposition: "required" }],
  gates: [{ id: "G-1", title: "Claim gate", maps: ["task:1.1"], intent: "Run production acceptance", scope: "Selected task", pass: "Mapped evidence succeeds", disposition: "required", phase: "completion", waiver: "none", floor: "e2e" }]
};
export default function(pi) {
  registerHorsepowerExtension(pi, {
    acquireRuntime: () => ({ value: {
      execute: async () => [],
      discoverImplementationChanges: async () => [{ changeId: "change-plan", completedTasks: 0, totalTasks: 1 }],
      loadImplementationTaskInventory: async () => ({ changeId: "change-plan", projectRoot: process.cwd(), digest: "${"a".repeat(64)}", sections: [{ id: "1", title: "Work", tasks: [{ id: "1.1", description: "Implement plan", status: "pending", sectionId: "1" }] }] }),
      loadImplementationTestAndGatePlan: async () => plan,
      beginImplementationCampaign: async (input) => ({ campaignId: "campaign-production", changeId: input.changeId, selectedTaskIds: input.selectedTaskIds, mode: input.mode, plan: { digest: input.planDigest } }),
    }, cleanup: async () => {}, abandon: () => {} }),
    resolveOutputLocale: async () => ${JSON.stringify(locale)},
  });
}`);
  const child = spawn("pi", ["--mode", "rpc", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions", "--extension", extension], {
    cwd: root, env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const events: Array<Record<string, any>> = []; let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const event = JSON.parse(line); events.push(event);
    if (event.type === "extension_ui_request") {
      if (event.method === "select") child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, value: event.options[0] })}\n`);
      if (event.method === "confirm") child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: confirm })}\n`);
    }
    if (event.type === "response" && event.id === "campaign") child.stdin.end();
  });
  child.stdin.write(`${JSON.stringify({ id: "campaign", type: "prompt", message: "/horsepower-campaign" })}\n`);
  const code = await new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("close", done); });
  return { code, stderr, text: JSON.stringify(events), events };
}

test.each(selectedE2ELocales())("production /horsepower-campaign presents and atomically confirms the official plan in %s", async (locale) => {
  const accepted = await runProductionCampaign(locale, true);
  expect(accepted.code).toBe(0); expect(accepted.stderr).toBe("");
  for (const token of ["taskIds=1.1", "mode=multi_agent", "testIntensity=standard", "gateStrictness=strict", "TC-1", "G-1", "campaign-production"]) expect(accepted.text).toContain(token);
  const canceled = await runProductionCampaign(locale, false);
  expect(canceled.code).toBe(0); expect(canceled.stderr).toBe("");
  expect(canceled.text).toContain(locale === "zh-CN" ? "未创建 campaign" : "no campaign");
  expect(canceled.text).not.toContain("campaign-production");
});

test("real Pi acceptance scaffold enumerates the production scenarios", () => {
  expect(realPiAcceptanceScenarios).toEqual(expect.arrayContaining([
    expect.stringContaining("authoring"), expect.stringContaining("cancellation"), expect.stringContaining("combined campaign"),
    expect.stringContaining("semantic drift"), expect.stringContaining("prose-only"), expect.stringContaining("completion evidence"),
  ]));
});

test("real Pi exercises bilingual explicit choice, cancellation, drift, and claim-matched completion contracts", async () => {
  for (const locale of selectedE2ELocales()) {
    for (const scenario of ["confirmed", "canceled", "relevant-drift", "prose-drift", "completion"] as const) {
      const result = await runPiContract(locale, scenario);
      expect(result.code, `${locale}/${scenario}`).toBe(0); expect(result.stderr, `${locale}/${scenario}`).toBe("");
      expect(result.text).toContain("testIntensity"); expect(result.text).toContain("gateStrictness");
      expect(result.text).toContain("TC-1"); expect(result.text).toContain("G-1");
      if (scenario === "canceled") expect(result.text).toMatch(locale === "zh-CN" ? /未创建 campaign/u : /no campaign created/u);
      if (scenario === "relevant-drift") expect(result.text).toContain("TEST_PLAN_DRIFT");
      if (scenario === "prose-drift") expect(result.text).toMatch(/digest unchanged|digest 保持一致/u);
      if (scenario === "completion") expect(result.text).toContain("TC-1=e2e-current G-1=e2e-current");
    }
  }
});
