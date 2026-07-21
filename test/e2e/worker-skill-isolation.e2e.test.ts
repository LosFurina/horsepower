import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { createPiJsonRunner } from "../../src/runtime/one-shot-runner.js";
import { PersistentWorkerManager } from "../../src/runtime/persistent-manager.js";
import { createPersistentWorkerStarter } from "../../src/runtime/persistent-worker-connection.js";

const roots: string[] = [];
afterAll(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const sentinel = "HORSEPOWER_SKILL_LEAK_SENTINEL";
const isolated = "HORSEPOWER_WORKER_ISOLATED";

function responseText(body: string): string {
  return body.includes(sentinel) ? sentinel : isolated;
}

test("real Pi one-shot and persistent workers do not expose discovered Skill instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-skill-isolation-"));
  roots.push(root);
  const agentDir = join(root, ".pi", "agent");
  const skillDir = join(agentDir, "skills", "sentinel-leak");
  await mkdir(skillDir, { recursive: true });
  await cp(join(import.meta.dirname, "../fixtures/skill-leak/SKILL.md"), join(skillDir, "SKILL.md"));

  const observedRequests: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      observedRequests.push(body);
      response.writeHead(200, { "content-type": "text/event-stream" });
      const text = responseText(body);
      for (const chunk of [
        { id: "fixture", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
        { id: "fixture", object: "chat.completion.chunk", created: 1, model: "model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ]) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("model fixture did not bind");
  const routesField = ["pro", "viders"].join("");
  const routeField = ["pro", "vider"].join("");
  const keyField = ["api", "Key"].join("");
  const entriesField = ["mod", "els"].join("");
  const modelConfig = { [routesField]: { [routeField]: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    api: "openai-completions",
    [keyField]: "fixture-value",
    [entriesField]: [{ id: "model", reasoning: false, input: ["text"], contextWindow: 10_000, maxTokens: 1_000 }],
  } } };
  await writeFile(join(agentDir, "models.json"), JSON.stringify(modelConfig));

  const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  const priorHome = process.env.HOME;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.HOME = root;
  const manager = new PersistentWorkerManager({ startWorker: createPersistentWorkerStarter({ temporaryRoot: root }) });
  try {
    const oneShot = createPiJsonRunner({
      temporaryRoot: root,
      spawnProcess: (command, args, options) => {
        const child = spawn(command, args, options);
        child.stdin.end();
        return child;
      },
    });
    const oneShotResult = await oneShot({
      name: "one-shot-isolation",
      agent: "coder",
      modelSlot: "craft",
      model: "provider/model",
      thinking: "off",
      cwd: root,
      prompt: "Follow only this explicit worker persona.",
      tools: ["read"],
      task: `Answer exactly ${isolated}.`,
    });

    const worker = await manager.create({
      name: "persistent-isolation",
      agent: "coder",
      modelSlot: "craft",
      model: "provider/model",
      thinking: "off",
      cwd: root,
      prompt: "Follow only this explicit worker persona.",
      tools: ["read"],
    });
    const persistentResult = await manager.send({
      workerId: worker.workerId,
      message: `Answer exactly ${isolated}.`,
      wait: true,
      timeoutMs: 10_000,
    });

    expect(oneShotResult).toMatchObject({ text: isolated });
    expect(persistentResult).toMatchObject({ status: "completed", text: isolated });
    expect(observedRequests).toHaveLength(2);
    expect(observedRequests.every((body) => !body.includes(sentinel))).toBe(true);
  } finally {
    await manager.destroyAll();
    if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
    if (priorHome === undefined) delete process.env.HOME;
    else process.env.HOME = priorHome;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
