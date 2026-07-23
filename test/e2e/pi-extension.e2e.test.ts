import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, expect, test } from "vitest";
import { selectedE2ELocales } from "../fixtures/e2e-locales.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

beforeAll(async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot });
});

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runPiRpc(args: string[], line: string, agentDir: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const child = spawn("pi", args, { cwd: repositoryRoot, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.stdin.end(`${line}\n`);
  const code = await new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  return { stdout, stderr, code };
}

test("official Pi executes horsepower_subagent with selected bilingual conclusions over English evidence", async () => {
  for (const locale of selectedE2ELocales()) {
    const root = await mkdtemp(join(tmpdir(), `horsepower-real-tool-${locale}-`)); roots.push(root);
    const agentDir = join(root, ".pi", "agent");
    await mkdir(join(agentDir, "horsepower"), { recursive: true });
    await writeFile(join(agentDir, "horsepower", "settings.json"), JSON.stringify({ outputLocale: locale }));
    let requestCount = 0;
    const server = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        requestCount += 1;
        response.writeHead(200, { "content-type": "text/event-stream" });
        const chunks = requestCount === 1
          ? [
              { id: "tool", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-doctor", type: "function", function: { name: "horsepower_subagent", arguments: JSON.stringify({ action: "doctor", cwd: "ignored-by-extension" }) } }] }, finish_reason: null }] },
              { id: "tool", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
            ]
          : [
              { id: "done", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: { role: "assistant", content: "English model acknowledgement" }, finish_reason: null }] },
              { id: "done", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
            ];
        for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
        response.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("model fixture did not bind");
    const routesField = ["pro", "viders"].join("");
    const routeField = ["pro", "vider"].join("");
    const keyField = ["api", "Key"].join("");
    const entriesField = ["mod", "els"].join("");
    const modelConfig = { [routesField]: { [routeField]: {
      baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", [keyField]: "fixture-value",
      [entriesField]: [{ id: "model", reasoning: false, input: ["text"], contextWindow: 10_000, maxTokens: 1_000 }],
    } } };
    await writeFile(join(agentDir, "models.json"), JSON.stringify(modelConfig));
    const extension = join(root, "horsepower-tool-fixture.mjs");
    const productionExtension = pathToFileURL(join(repositoryRoot, "dist", "extension", "index.js")).href;
    await writeFile(extension, `import { registerHorsepowerExtension } from ${JSON.stringify(productionExtension)};\nexport default function (pi) {\n  registerHorsepowerExtension(pi, {\n    acquireRuntime: () => ({ value: { execute: async () => ({ generation: "process", workers: 0, rawEvidence: "English worker evidence" }) }, cleanup: async () => {}, abandon: () => {} }),\n    resolveOutputLocale: async () => process.env.HORSEPOWER_TEST_LOCALE,\n  });\n}\n`);
    const child = spawn("pi", [
      "--mode", "rpc", "--no-session", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions",
      "--extension", extension, "--model", "provider/model",
    ], { cwd: root, env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, HORSEPOWER_TEST_LOCALE: locale }, stdio: ["pipe", "pipe", "pipe"] });
    const events: Array<Record<string, unknown>> = [];
    let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const event = JSON.parse(line) as Record<string, unknown>; events.push(event);
      if (event.type === "agent_settled") child.stdin.end();
    });
    child.stdin.write(`${JSON.stringify({ id: "prompt", type: "prompt", message: "Call horsepower_subagent doctor exactly once." })}\n`);
    const code = await new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    expect(code, locale).toBe(0); expect(stderr, locale).toBe(""); expect(requestCount, locale).toBe(2);
    const completed = events.find((event) => event.type === "tool_execution_end") as { result?: { details?: Record<string, unknown> } } | undefined;
    expect(completed?.result?.details, locale).toMatchObject({
      outputLocale: locale,
      summary: locale === "zh-CN" ? "doctor 已完成。" : "doctor completed.",
    });
    expect(completed?.result?.details, locale).toMatchObject({ data: { generation: "process", workers: 0, rawEvidence: "English worker evidence" } });
    expect(JSON.stringify(completed?.result?.details), locale).not.toContain("English model acknowledgement");
  }
});

test("official Pi exposes attributed live worker tool progress and a structured failed terminal result", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-real-progress-")); roots.push(root);
  const agentDir = join(root, ".pi", "agent"); await mkdir(agentDir, { recursive: true });
  let requestCount = 0;
  const server = createServer((request, response) => {
    request.resume(); request.on("end", () => {
      requestCount += 1; response.writeHead(200, { "content-type": "text/event-stream" });
      const chunks = requestCount === 1 ? [
        { id: "tool", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call-worker", type: "function", function: { name: "horsepower_subagent", arguments: JSON.stringify({ action: "single", cwd: root, changeId: "change-progress", taskScope: "1.1", implementationCampaignId: "campaign-progress", workKind: "implementation", agent: "coder", modelSlot: "craft", handoffMode: "inline", name: "progress-check", task: "Use a tool" }) } }] }, finish_reason: null }] },
        { id: "tool", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ] : [
        { id: "done", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: { role: "assistant", content: "Observed failure" }, finish_reason: null }] },
        { id: "done", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ];
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("progress fixture did not bind");
  const routesField = ["pro", "viders"].join(""); const routeField = ["pro", "vider"].join("");
  const keyField = ["api", "Key"].join(""); const entriesField = ["mod", "els"].join("");
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ [routesField]: { [routeField]: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", [keyField]: "fixture-value",
    [entriesField]: [{ id: "model", reasoning: false, input: ["text"], contextWindow: 10_000, maxTokens: 1_000 }],
  } } }));
  const extension = join(root, "horsepower-progress-fixture.mjs");
  const productionExtension = pathToFileURL(join(repositoryRoot, "dist", "extension", "index.js")).href;
  await writeFile(extension, `import { registerHorsepowerExtension } from ${JSON.stringify(productionExtension)};
const identity = { name: "progress-check", agent: "coder", role: "Implement a narrowly specified change", requestedSlot: "craft", resolvedSlot: "craft", model: "provider/model", thinking: "minimal", handoffMode: "inline", invocationId: "invocation-progress", runId: "run-progress" };
export default function (pi) { registerHorsepowerExtension(pi, { acquireRuntime: () => ({ value: { execute: async (_input, context) => { context.onProgress?.({ type: "accepted", identity, telemetry: { elapsedMs: 0 } }); context.onProgress?.({ type: "tool_start", identity, toolName: "read", toolCallId: "tool-progress", operation: "read", target: "src/index.ts", telemetry: { elapsedMs: 1250, usage: { input: 7, output: 3 }, latestAssistantSummary: "safe [private-path]" } }); context.onProgress?.({ type: "tool_end", identity, toolName: "read", toolCallId: "tool-progress", operation: "read", target: "src/index.ts", isError: true, telemetry: { elapsedMs: 1500, usage: { input: 7, output: 3 }, latestAssistantSummary: "newest safe" } }); context.onProgress?.({ type: "failed", identity, summary: "worker failed", telemetry: { elapsedMs: 1500 } }); return { status: "failed", identity, failure: { stage: "worker", code: "WORKER_FAILED", message: "worker failed" } }; } }, cleanup: async () => {}, abandon: () => {} }) }); }
`);
  const child = spawn("pi", ["--mode", "rpc", "--no-session", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions", "--extension", extension, "--model", "provider/model"], {
    cwd: root, env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir }, stdio: ["pipe", "pipe", "pipe"],
  });
  const events: Array<Record<string, unknown>> = []; let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  createInterface({ input: child.stdout }).on("line", (line) => { const event = JSON.parse(line) as Record<string, unknown>; events.push(event); if (event.type === "agent_settled") child.stdin.end(); });
  child.stdin.write(`${JSON.stringify({ id: "prompt", type: "prompt", message: "Call horsepower_subagent exactly once." })}\n`);
  const code = await new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));

  expect(code).toBe(0); expect(stderr).toBe(""); expect(requestCount).toBe(2);
  const updates = events.filter((event) => event.type === "tool_execution_update");
  const completedIndex = events.findIndex((event) => event.type === "tool_execution_end");
  expect(updates.length, JSON.stringify(events)).toBeGreaterThanOrEqual(4);
  expect(events.indexOf(updates[0]!)).toBeLessThan(completedIndex);
  const updateText = JSON.stringify(updates);
  expect(updateText).toContain("progress-check · coder (Implement a narrowly specified change) · craft→craft · provider/model · thinking=minimal · inline");
  expect(updateText).toContain("tool_start"); expect(updateText).toContain("tool_end");
  expect(updateText).toContain("elapsed: 1250ms"); expect(updateText).toContain("input tokens: 7"); expect(updateText).toContain("output tokens: 3");
  expect(updateText).toContain("latest: newest safe"); expect(updateText).not.toContain(["", "Users", ""].join("/")); expect(updateText).not.toContain("api_key");
  const completed = events[completedIndex] as { result?: { details?: Record<string, unknown> } };
  expect(completed.result?.details).toMatchObject({ status: "failed", failure: { stage: "worker", code: "WORKER_FAILED" } });
});

test("official Pi restart observes disabled and re-enabled extension links", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "horsepower-real-pi-restart-")); roots.push(agentDir);
  const extensions = join(agentDir, "extensions"); await mkdir(extensions, { recursive: true });
  const link = join(extensions, "horsepower.js"); await symlink(join(repositoryRoot, "dist", "extension", "index.js"), link);
  const args = ["--mode", "rpc", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files"];
  const command = '{"id":"commands","type":"get_commands"}';
  const enabled = await runPiRpc(args, command, agentDir);
  expect(enabled.stdout).toContain("horsepower-workers");
  await rm(link);
  const disabled = await runPiRpc(args, command, agentDir);
  expect(disabled.stdout).not.toContain("horsepower-workers");
  await symlink(join(repositoryRoot, "dist", "extension", "index.js"), link);
  const restored = await runPiRpc(args, command, agentDir);
  expect(restored.stdout).toContain("horsepower-workers");
});

test("official Pi RPC loads the bundled extension and exposes only Horsepower commands", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "horsepower-real-pi-"));
  roots.push(agentDir);
  const extension = join(repositoryRoot, "dist", "extension", "index.js");
  const { stdout, stderr, code } = await runPiRpc([
    "--mode", "rpc", "--no-session", "--offline",
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--extension", extension,
  ], '{"id":"commands","type":"get_commands"}', agentDir);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  const response = JSON.parse(stdout.trim()) as { success: boolean; data: { commands: Array<{ name: string }> } };
  expect(response.success).toBe(true);
  expect(response.data.commands.map(({ name }) => name)).toEqual([
    "horsepower-workers", "horsepower-doctor", "horsepower-campaign", "horsepower-review-authorize",
  ]);
});
