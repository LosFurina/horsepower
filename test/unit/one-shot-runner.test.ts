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
  expect(child.stdin.writableEnded).toBe(true);
  expect(args.filter((arg) => arg === "--no-skills")).toHaveLength(1);
  expect(args).not.toContain("--skill");
  expect(args.slice(0, 4)).toEqual(["--mode", "json", "--no-session", "--no-skills"]);
  expect(args.slice(4, 8)).toEqual(["--model", "provider/model", "--thinking", "high"]);
  expect(args.slice(-3)).toEqual(["--tools", "read", "Review the change"]);
  const promptPath = args[args.indexOf("--append-system-prompt") + 1]!;
  await expect(stat(promptPath)).rejects.toMatchObject({ code: "ENOENT" });
});

test("emits ordered bounded redacted assistant and tool progress", async () => {
  const child = new FakeJsonChild();
  const progress: unknown[] = [];
  const sensitiveDelta = ["token", "secret"].join("=");
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    spawnProcess: () => {
      queueMicrotask(() => {
        for (const event of [
          { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "unstable" } },
          { type: "message_update", assistantMessageEvent: { type: "text_end", content: `${sensitiveDelta} ${"x".repeat(2_000)}` } },
          { type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "cat /private/secret" } },
          { type: "tool_execution_update", toolCallId: "call-1", toolName: "bash", partialResult: { content: "credential" } },
          { type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: "/private/secret" }, isError: false },
          { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
        ]) child.stdout.write(`${JSON.stringify(event)}\n`);
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await run({ ...invocation, onProgress: (event) => { progress.push(event); } });

  expect(progress).toMatchObject([
    { type: "starting" },
    { type: "assistant", summary: "[REDACTED]" },
    { type: "tool_start", toolName: "bash", toolCallId: "call-1", operation: "bash", target: "cat [private-path]" },
    { type: "tool_update", toolName: "bash", toolCallId: "call-1", operation: "bash", target: "cat [private-path]" },
    { type: "tool_end", toolName: "bash", toolCallId: "call-1", operation: "bash", target: "cat [private-path]", isError: false },
  ]);
  expect(JSON.stringify(progress)).not.toContain("/private/secret");
  expect(Buffer.byteLength(JSON.stringify(progress), "utf8")).toBeLessThan(4_000);
});

test("progress callback failure is observational", async () => {
  const child = new FakeJsonChild();
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({ type: "tool_execution_start", toolCallId: "call-1", toolName: "read" })}\n`);
        child.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }] } })}\n`);
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });
  await expect(run({ ...invocation, onProgress: () => { throw new Error("renderer failed"); } })).resolves.toMatchObject({ text: "done" });
});

test("preserves structured thinking rejection from an actual one-shot worker", async () => {
  const child = new FakeJsonChild();
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: "error",
          error: { kind: "capability_rejection", parameter: "thinking", rejectedValue: "high", code: "INVALID_THINKING" },
        })}\n`);
        child.emit("close", 1, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run(invocation)).rejects.toMatchObject({
    kind: "capability_rejection", parameter: "thinking", rejectedValue: "high", code: "INVALID_THINKING",
  });
});

test("classifies provider unsupported-thinking assistant errors as capability rejection", async () => {
  const child = new FakeJsonChild();
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: "message_end",
          message: { role: "assistant", content: [], stopReason: "error", errorMessage: "400: Unsupported value: 'minimal' is not supported with this model. Supported values are: 'none', 'low', and 'high'." },
        })}\n`);
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run(invocation)).rejects.toMatchObject({
    kind: "capability_rejection", parameter: "thinking", rejectedValue: "minimal",
    acceptedValues: ["none", "low", "high"], acceptedValuesAuthoritative: true,
  });
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

test("rejects an oversized unterminated JSON line and escalates a stubborn child", async () => {
  class StubbornChild extends FakeJsonChild {
    override kill(signal: NodeJS.Signals): boolean {
      this.signals.push(signal);
      if (signal === "SIGKILL") this.emit("close", null, signal);
      return true;
    }
  }
  const child = new StubbornChild();
  const { createPiJsonRunner } = await import("../../src/runtime/one-shot-runner.js");
  const run = createPiJsonRunner({
    stdoutByteLimit: 100,
    gracefulShutdownMs: 2,
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write("x".repeat(101));
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run(invocation)).rejects.toThrow("Pi JSON stdout line exceeds 100 bytes");
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
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
