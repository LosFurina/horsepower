import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

class FakeJsonChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    this.emit("close", null, signal);
    return true;
  }
}

const invocation = {
  name: "review",
  agent: "reviewer",
  modelSlot: "judgment",
  model: "provider/model",
  thinking: "high" as const,
  cwd: "/project",
  prompt: "Review carefully.",
  tools: ["read"],
  task: "Review the change",
};

test("runs Pi JSON mode with private prompt cleanup and captures text and usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-one-shot-"));
  roots.push(root);
  const child = new FakeJsonChild();
  let args: readonly string[] = [];
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    executable: "pi",
    temporaryRoot: root,
    spawnProcess: (_command, invocationArgs) => {
      args = invocationArgs;
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "review result" }],
            usage: { input: 10, output: 5, cost: { total: 0.01 } },
          },
        })}\n`);
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run(invocation)).resolves.toEqual({
    name: "review",
    text: "review result",
    usage: { input: 10, output: 5, totalCost: 0.01 },
  });
  expect(args.slice(0, 3)).toEqual(["--mode", "json", "--no-session"]);
  const promptPath = args[args.indexOf("--append-system-prompt") + 1]!;
  await expect(stat(promptPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("rejects assistant errors", async () => {
  const child = new FakeJsonChild();
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [], stopReason: "error", errorMessage: "provider failed" },
        })}\n`);
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run(invocation)).rejects.toThrow("provider failed");
});

test("accumulates invocation usage and waits for close to drain final stdout", async () => {
  const child = new FakeJsonChild();
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "first" }], usage: { input: 10, output: 2 } },
        })}\n`);
        child.emit("exit", 0, null);
        queueMicrotask(() => {
          child.stdout.write(`${JSON.stringify({
            type: "message_end",
            message: { role: "assistant", content: [{ type: "text", text: "final" }], usage: { input: 5, output: 3 } },
          })}\n`);
          child.emit("close", 0, null);
        });
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run(invocation)).resolves.toMatchObject({
    text: "final",
    usage: { input: 15, output: 5 },
  });
});

test("validates slot fields before spawn and appends a no-delegation prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-one-shot-validation-"));
  roots.push(root);
  const child = new FakeJsonChild();
  let spawned = 0;
  let promptPath = "";
  let resolveSpawned!: () => void;
  const spawnedPromise = new Promise<void>((resolve) => { resolveSpawned = resolve; });
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    temporaryRoot: root,
    spawnProcess: (_command, args) => {
      spawned += 1;
      promptPath = args[args.indexOf("--append-system-prompt") + 1]!;
      resolveSpawned();
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "done" }] },
        })}\n`);
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run({ ...invocation, modelSlot: "" })).rejects.toThrow("One-shot modelSlot is required");
  expect(spawned).toBe(0);
  const running = run(invocation);
  await spawnedPromise;
  expect(await readFile(promptPath, "utf8")).toContain("Do not create or invoke subagents");
  await running;
});

test("rejects an oversized unterminated JSON line", async () => {
  const child = new FakeJsonChild();
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    stdoutByteLimit: 100,
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write("x".repeat(101));
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run(invocation)).rejects.toThrow("Pi JSON stdout line exceeds 100 bytes");
});

test("escalates an aborted JSON child from SIGTERM to SIGKILL", async () => {
  class StubbornChild extends FakeJsonChild {
    override kill(signal: NodeJS.Signals): boolean {
      this.signals.push(signal);
      if (signal === "SIGKILL") this.emit("close", null, signal);
      return true;
    }
  }
  const root = await mkdtemp(join(tmpdir(), "horsepower-one-shot-abort-"));
  roots.push(root);
  const child = new StubbornChild();
  const controller = new AbortController();
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    temporaryRoot: root,
    gracefulShutdownMs: 2,
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
  });

  const running = run({ ...invocation, signal: controller.signal });
  controller.abort();

  await expect(running).rejects.toThrow("One-shot task aborted");
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
});
