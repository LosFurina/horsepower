import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, test } from "vitest";
import { PersistentWorkerManager } from "../../src/runtime/persistent-manager.js";
import { createPersistentWorkerStarter } from "../../src/runtime/persistent-worker-connection.js";

const roots: string[] = [];
afterAll(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

test("production RPC worker transport retains conversation state across two turns", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-two-turn-"));
  roots.push(root);
  const executable = resolve(import.meta.dirname, "../fixtures/pi-rpc-memory.mjs");
  await chmod(executable, 0o755);
  const manager = new PersistentWorkerManager({ startWorker: createPersistentWorkerStarter({
    executable,
    temporaryRoot: root,
    spawnProcess: (_command, args, options) => spawn(process.execPath, [executable, ...args], options),
  }) });
  const worker = await manager.create({ name: "memory", agent: "coder", modelSlot: "craft", model: "provider/model", thinking: "medium", cwd: root, prompt: "Public fixture prompt.", tools: [] });
  const first = await manager.send({ workerId: worker.workerId, message: "alpha", wait: true, timeoutMs: 5_000 });
  const second = await manager.send({ workerId: worker.workerId, message: "beta", wait: true, timeoutMs: 5_000 });
  expect(first).toMatchObject({ status: "completed", text: "remembered:alpha", telemetry: { usage: { input: 1, output: 2 }, latestAssistantSummary: "remembered:alpha" } });
  expect(second).toMatchObject({ status: "completed", text: "prior:alpha;current:beta", telemetry: { usage: { input: 2, output: 4 }, latestAssistantSummary: "prior:alpha;current:beta" } });
  expect(manager.status(worker.workerId)).toMatchObject({ status: "idle", telemetry: second.telemetry });
  expect(second.telemetry?.usage).not.toEqual({ input: 3, output: 6 });
  await manager.destroyAll();
});
