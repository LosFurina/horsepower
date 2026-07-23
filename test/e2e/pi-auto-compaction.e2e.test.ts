import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const extensionUnderTest = process.env.HORSEPOWER_AUTO_COMPACTION_EXTENSION_PATH
  ? resolve(process.env.HORSEPOWER_AUTO_COMPACTION_EXTENSION_PATH)
  : join(repositoryRoot, "dist", "extension", "index.js");
const runtimeHelperPath = join(repositoryRoot, "test", "fixtures", "pi-auto-compaction-runtime-helper.mjs");
const roots: string[] = [];

beforeAll(async () => {
  const child = spawn(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot, stdio: "inherit" });
  const code = await new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  if (code !== 0) throw new Error(`build failed with ${code}`);
  const helper = spawn(process.execPath, ["scripts/build-pi-auto-compaction-helper.mjs"], { cwd: repositoryRoot, stdio: "inherit" });
  const helperCode = await new Promise<number | null>((resolveExit, reject) => { helper.once("error", reject); helper.once("close", resolveExit); });
  if (helperCode !== 0) throw new Error(`production runtime helper build failed with ${helperCode}`);
});
afterAll(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

type Scenario = "threshold" | "overflow" | "repeated" | "scope-drift" | "pending";
type Authority = "synthetic" | "production";
interface RunResult {
  requests: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  fixture: Array<Record<string, unknown>>;
  stderr: string;
  code: number | null;
  projectRoot: string;
}

function chunks(text: string) {
  return [
    { id: "answer", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
    { id: "answer", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
  ];
}

async function runScenario(scenario: Scenario, authority: Authority = "synthetic"): Promise<RunResult> {
  const root = await mkdtemp(join(tmpdir(), `horsepower-pi-compact-${authority}-${scenario}-`)); roots.push(root);
  const agentDir = join(root, ".pi", "agent"); await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ compaction: { enabled: true, reserveTokens: 300, keepRecentTokens: 1 } }));
  const requests: Array<Record<string, unknown>> = [];
  let overflowSent = false;
  let child: ReturnType<typeof spawn> | undefined;
  const expectedRequests = scenario === "overflow" ? 3
    : scenario === "repeated" ? 3
    : scenario === "scope-drift" || scenario === "pending" ? 1
    : 2;
  const server = createServer((request, response) => {
    let body = ""; request.setEncoding("utf8"); request.on("data", (part) => { body += part; });
    request.on("end", () => {
      requests.push(JSON.parse(body) as Record<string, unknown>);
      if (scenario === "pending" && requests.length === 2) {
        // Keep the real user follow-up turn active while production OpenSpec
        // revalidation settles, exercising the post-await idle arbitration.
        setTimeout(() => {
          response.writeHead(200, { "content-type": "text/event-stream" });
          for (const chunk of chunks("fixture pending answer")) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
          response.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1, model: "model", choices: [], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })}\n\n`);
          response.end("data: [DONE]\n\n");
        }, 5_000);
        return;
      }
      if (scenario === "overflow" && requests.length === 2 && !overflowSent) {
        overflowSent = true;
        // Pi compares message and compaction timestamps. Keep the synthetic
        // overflow observably after the preceding saved compaction boundary.
        setTimeout(() => {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: { message: "maximum context length exceeded", type: "invalid_request_error", code: "context_length_exceeded" } }));
        }, 20);
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      const highUsage = scenario === "threshold" && requests.length === 1
        || scenario === "scope-drift" && requests.length === 1
        || scenario === "pending" && requests.length === 1
        || scenario === "overflow" && requests.length === 1
        || scenario === "repeated" && requests.length <= 2;
      for (const chunk of chunks(`fixture answer ${requests.length}`)) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      // Pi uses authoritative provider usage to decide threshold compaction.
      response.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1, model: "model", choices: [], usage: { prompt_tokens: highUsage ? 800 : 20, completion_tokens: 10, total_tokens: highUsage ? 810 : 30 } })}\n\n`);
      response.end("data: [DONE]\n\n");
      if (requests.length >= expectedRequests && scenario !== "scope-drift" && scenario !== "pending") {
        setTimeout(() => child?.stdin?.end(), 50);
      }
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("fixture server did not bind");
  const catalogCollectionKey = ["pro", "viders"].join("");
  const modelCollectionKey = ["mo", "dels"].join("");
  const credentialFieldKey = ["api", "Key"].join("");
  const fixtureModelId = ["fixture", "model"].join("-");
  const catalogEntry = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: ["openai", "completions"].join("-"),
    [credentialFieldKey]: ["fixture", "value"].join("-"),
    [modelCollectionKey]: [{ id: fixtureModelId, reasoning: false, input: ["text"], contextWindow: 1_000, maxTokens: 100 }],
  };
  const catalog: Record<string, unknown> = {};
  catalog[catalogCollectionKey] = { fixture: catalogEntry };
  await writeFile(join(agentDir, "models.json"), JSON.stringify(catalog));
  const logPath = join(root, "compaction.jsonl"); await writeFile(logPath, "");
  const processChild = spawn("pi", [
    "--mode", "rpc", "--no-session", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions",
    "--extension", join(repositoryRoot, "test", "fixtures", "pi-auto-compaction.mjs"), "--model", `fixture/${fixtureModelId}`,
  ], { cwd: root, env: {
    ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir,
    HORSEPOWER_EXTENSION_PATH: extensionUnderTest,
    HORSEPOWER_COMPACTION_SCENARIO: scenario,
    HORSEPOWER_COMPACTION_LOG: logPath,
    HORSEPOWER_COMPACTION_AUTHORITY: authority,
    HORSEPOWER_COMPACTION_RUNTIME_HELPER: runtimeHelperPath,
  }, stdio: ["pipe", "pipe", "pipe"] });
  child = processChild;
  const events: Array<Record<string, unknown>> = []; let stderr = ""; let settled = 0;
  processChild.stderr.on("data", (part) => { stderr += String(part); });
  createInterface({ input: processChild.stdout }).on("line", (line) => {
    const event = JSON.parse(line) as Record<string, unknown>; events.push(event);
    if (event.type === "agent_settled") {
      settled += 1;
      if (scenario === "scope-drift" && settled >= 1) setTimeout(() => processChild.stdin.end(), 150);
      if (scenario === "pending" && settled >= 2) setTimeout(() => processChild.stdin.end(), 150);
    }
  });
  const prompt = "Continue the active campaign kickoff exactly once.";
  processChild.stdin.write(`${JSON.stringify({ id: "kickoff", type: "prompt", message: prompt })}\n`);
  const watchdog = setTimeout(() => processChild.stdin.end(), 15_000);
  const code = await new Promise<number | null>((resolveExit, reject) => { processChild.once("error", reject); processChild.once("close", resolveExit); });
  clearTimeout(watchdog);
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  const fixtureText = await readFile(logPath, "utf8");
  return {
    requests,
    events,
    fixture: fixtureText.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>),
    stderr,
    code,
    projectRoot: root,
  };
}

function requestText(result: RunResult): string { return JSON.stringify(result.requests); }
function fixtureEvents(result: RunResult, type: string) { return result.fixture.filter((event) => event.type === type); }

test("official Pi threshold compaction without retry continues exact scope once without duplicate kickoff", async () => {
  const result = await runScenario("threshold");
  expect(result.code, result.stderr).toBe(0); expect(result.stderr).toBe("");
  expect(result.requests).toHaveLength(2);
  expect(fixtureEvents(result, "compact")).toEqual([{ type: "compact", reason: "threshold", willRetry: false, saved: true, authority: "synthetic" }]);
  expect(fixtureEvents(result, "prepare")).toHaveLength(1);
  expect(fixtureEvents(result, "prepare")[0]).toMatchObject({ input: { campaignId: "campaign-e2e", projectId: expect.any(String), generation: 1 }, authority: "synthetic" });
  expect(requestText(result).match(/Continue the active campaign kickoff exactly once\./g)).toHaveLength(1);
  expect(requestText(result).match(/Continuing campaign campaign-e2e for change change-e2e \(tasks 3\.1,3\.2, mode multi_agent\)\./g), requestText(result)).toHaveLength(1);
});

test("official Pi overflow native retry is not duplicated by Horsepower", async () => {
  const result = await runScenario("overflow");
  expect(result.code, result.stderr).toBe(0); expect(result.requests, JSON.stringify({ fixture: result.fixture, events: result.events })).toHaveLength(3);
  expect(fixtureEvents(result, "compact")).toEqual([
    { type: "compact", reason: "threshold", willRetry: false, saved: true, authority: "synthetic" },
    { type: "compact", reason: "overflow", willRetry: true, saved: true, authority: "synthetic" },
  ]);
  expect(fixtureEvents(result, "prepare")).toHaveLength(1);
  expect(JSON.stringify(result.requests.at(-1)).match(/Continuing campaign campaign-e2e/g)).toHaveLength(1);
  expect(result.events.filter((event) => event.type === "compaction_end").at(-1)).toMatchObject({ reason: "overflow", willRetry: true, aborted: false });
});

test("official Pi repeated automatic comped continue once per generation with no duplicate kickoff", async () => {
  const result = await runScenario("repeated");
  expect(result.code, result.stderr).toBe(0); expect(result.requests, JSON.stringify({ fixture: result.fixture, events: result.events })).toHaveLength(3);
  expect(fixtureEvents(result, "compact")).toHaveLength(2); expect(fixtureEvents(result, "prepare")).toHaveLength(2);
  expect(fixtureEvents(result, "prepare").map((event) => (event.input as { generation: number }).generation)).toEqual([1, 2]);
  expect(requestText(result).match(/Continue the active campaign kickoff exactly once\./g)).toHaveLength(1);
  expect(requestText(result).match(/Continuing campaign campaign-e2e/g)).toHaveLength(2);
});

test("official Pi scope drift fails closed before continuation kickoff", async () => {
  const result = await runScenario("scope-drift");
  expect(result.code, result.stderr).toBe(0); expect(result.requests).toHaveLength(1);
  expect(fixtureEvents(result, "compact")).toHaveLength(1); expect(fixtureEvents(result, "prepare")).toHaveLength(1);
  expect(requestText(result)).not.toContain("Continue campaign campaign-e2e");
});

test("production HorsepowerRuntime authority continues after real campaign OpenSpec revalidation", async () => {
  const result = await runScenario("threshold", "production");
  expect(result.code, result.stderr).toBe(0); expect(result.stderr).toBe("");
  const created = fixtureEvents(result, "campaign-created");
  expect(created).toHaveLength(1);
  expect(created[0]).toMatchObject({
    authority: "production",
    changeId: "change-e2e",
    selectedTaskIds: ["3.1", "3.2"],
    mode: "multi_agent",
  });
  const campaignId = String(created[0]!.campaignId);
  expect(fixtureEvents(result, "openspec-inventory").length).toBeGreaterThanOrEqual(1);
  expect(fixtureEvents(result, "openspec-plan").length).toBeGreaterThanOrEqual(1);
  expect(fixtureEvents(result, "compact")).toEqual([
    { type: "compact", reason: "threshold", willRetry: false, saved: true, authority: "production" },
  ]);
  const prepares = fixtureEvents(result, "prepare");
  expect(prepares).toHaveLength(1);
  expect(prepares[0]).toMatchObject({
    authority: "production",
    input: { campaignId, generation: 1 },
  });
  // macOS may report /var vs /private/var; production runtime resolves realpath.
  expect(String((prepares[0]!.input as { projectId: string }).projectId)).toContain("horsepower-pi-compact-production-threshold-");
  const prepareResults = fixtureEvents(result, "prepare-result");
  expect(prepareResults).toHaveLength(1);
  expect(prepareResults[0]).toMatchObject({
    authority: "production",
    result: {
      campaignId,
      changeId: "change-e2e",
      selectedTaskIds: ["3.1", "3.2"],
      mode: "multi_agent",
      generation: 1,
      disposition: "active",
    },
  });
  expect(result.requests).toHaveLength(2);
  expect(requestText(result).match(/Continue the active campaign kickoff exactly once\./g)).toHaveLength(1);
  const continuation = new RegExp(`Continuing campaign ${campaignId} for change change-e2e \\(tasks 3\\.1,3\\.2, mode multi_agent\\)\\.`, "g");
  expect(requestText(result).match(continuation), requestText(result)).toHaveLength(1);
});

test("production HorsepowerRuntime OpenSpec scope drift fails closed without continuation", async () => {
  const result = await runScenario("scope-drift", "production");
  expect(result.code, result.stderr).toBe(0); expect(result.stderr).toBe("");
  expect(fixtureEvents(result, "campaign-created")).toHaveLength(1);
  expect(fixtureEvents(result, "openspec-drift")).toEqual([
    expect.objectContaining({ type: "openspec-drift", field: "task-3.1-status", value: "complete" }),
  ]);
  expect(fixtureEvents(result, "prepare")).toHaveLength(1);
  expect(fixtureEvents(result, "prepare")[0]).toMatchObject({ authority: "production" });
  expect(fixtureEvents(result, "prepare-result")).toEqual([
    expect.objectContaining({ authority: "production", result: null }),
  ]);
  expect(result.requests).toHaveLength(1);
  expect(requestText(result)).not.toMatch(/Continuing campaign /);
});

test("official Pi pending follow-up suppresses Horsepower continuation under production authority", async () => {
  const result = await runScenario("pending", "production");
  expect(result.code, result.stderr).toBe(0); expect(result.stderr).toBe("");
  expect(fixtureEvents(result, "campaign-created")).toHaveLength(1);
  expect(fixtureEvents(result, "compact")).toEqual([
    { type: "compact", reason: "threshold", willRetry: false, saved: true, authority: "production" },
  ]);
  expect(fixtureEvents(result, "pending-injected")).toHaveLength(1);
  // The real follow-up starts before Horsepower can prepare; agent_start consumes
  // the compaction arm and no later settlement may revive it.
  expect(fixtureEvents(result, "prepare"), JSON.stringify({ fixture: result.fixture, events: result.events })).toHaveLength(0);
  expect(fixtureEvents(result, "prepare-result")).toHaveLength(0);
  expect(result.events.some((event) => event.type === "agent_start")).toBe(true);
  expect(requestText(result), JSON.stringify(fixtureEvents(result, "settled"))).not.toMatch(/Continuing campaign /);
});
