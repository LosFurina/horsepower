import { EventEmitter } from "node:events";
import { expect, test } from "vitest";
import type {
  WorkerConnection,
  WorkerLaunchInput,
} from "../../src/runtime/persistent-manager.js";

class FakeWorker extends EventEmitter implements WorkerConnection {
  requests: Array<{ type: string; payload: Readonly<Record<string, unknown>> }> = [];
  signals: NodeJS.Signals[] = [];
  cleaned = false;
  startupError?: Error;
  requestErrors = new Map<string, Error>();
  holdPrompts = false;

  async request(type: string, payload: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
    this.requests.push({ type, payload });
    if (type === "get_state" && this.startupError) throw this.startupError;
    const requestError = this.requestErrors.get(type);
    if (requestError) throw requestError;
    if (type === "prompt" && !this.holdPrompts) {
      queueMicrotask(() => {
        this.emit("event", {
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: `reply:${String(payload.message)}` }],
          },
        });
        this.emit("event", { type: "agent_end", willRetry: false });
      });
    }
    return { success: true };
  }

  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    queueMicrotask(() => this.emit("exit", 0, signal));
  }

  async cleanup(): Promise<void> {
    this.cleaned = true;
  }
}

function setup(options: { maxWorkers?: number; holdPrompts?: boolean } = {}) {
  const workers: FakeWorker[] = [];
  const launches: WorkerLaunchInput[] = [];
  return {
    workers,
    launches,
    managerPromise: import("../../src/runtime/persistent-manager.js").then(({ PersistentWorkerManager }) =>
      new PersistentWorkerManager({
        ...(options.maxWorkers === undefined ? {} : { maxWorkers: options.maxWorkers }),
        startWorker: async (input) => {
          launches.push(input);
          const worker = new FakeWorker();
          worker.holdPrompts = options.holdPrompts === true;
          workers.push(worker);
          return worker;
        },
      })
    ),
  };
}

const createInput = {
  name: "reviewer-1",
  agent: "reviewer",
  modelSlot: "judgment",
  model: "provider/model",
  thinking: "high" as const,
  cwd: "/project",
  prompt: "Review carefully.",
  tools: ["read", "bash"],
};

test("creates an idle worker after startup state acknowledgement", async () => {
  const { managerPromise, launches } = setup();
  const manager = await managerPromise;

  const created = await manager.create(createInput);

  expect(created).toMatchObject({
    name: "reviewer-1",
    agent: "reviewer",
    modelSlot: "judgment",
    model: "provider/model",
    thinking: "high",
    status: "idle",
    queuedMessageIds: [],
  });
  expect(launches).toEqual([createInput]);
  expect(manager.list()).toHaveLength(1);
});

test("preserves structured capability rejection from persistent execution events", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const created = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const sent = await manager.send({ workerId: created.workerId, message: "work", wait: false });

  workers[0]!.emit("event", {
    type: "error",
    error: { kind: "capability_rejection", parameter: "thinking", rejectedValue: "high", code: "INVALID_THINKING" },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(manager.waitForMessage(created.workerId, sent.messageId)).rejects.toMatchObject({
    kind: "capability_rejection", parameter: "thinking", rejectedValue: "high", code: "INVALID_THINKING",
  });
  expect(manager.messageStatus(created.workerId, sent.messageId)).toBe("failed");
});

test("acknowledges an unresolved initial message while status and read remain available", async () => {
  const { managerPromise } = setup({ holdPrompts: true });
  const manager = await managerPromise;
  // The fixture is unresolved before manager.create can issue prompt.
  const created = await manager.create({ ...createInput, initialMessage: "start now" });
  expect(created.workerId).toBeTruthy();
  expect(created.initialMessageId).toMatch(/^msg-/u);
  expect(created.activeMessageId).toBe(created.initialMessageId);
  expect(manager.status(created.workerId).status).toBe("running");
  expect(manager.read(created.workerId).events.length).toBeGreaterThan(0);
  expect(manager.list()).toHaveLength(1);
});

test("supports an explicit initial message during creation", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;

  const created = await manager.create({ ...createInput, initialMessage: "start now" });

  expect(workers[0]!.requests.some(({ type, payload }) =>
    type === "prompt" && payload.message === "start now"
  )).toBe(true);
  expect(created.status).toBe("idle");
  expect(created.initialMessageId).toMatch(/^msg-/u);
  expect(created.activeMessageId).toBeUndefined();
});

test("reserves a worker name while asynchronous creation is still in flight", async () => {
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const manager = new PersistentWorkerManager({
    startWorker: async () => {
      await gate;
      return new FakeWorker();
    },
  });

  const first = manager.create(createInput);
  await expect(manager.create(createInput)).rejects.toThrow("Persistent worker name already exists: reviewer-1");
  release();
  const created = await first;
  expect(manager.list()).toEqual([expect.objectContaining({ workerId: created.workerId, name: "reviewer-1" })]);
  await manager.destroyAll(true);
});

test("enforces the hard eight-worker limit under concurrent creation", async () => {
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  const workers: FakeWorker[] = [];
  const manager = new PersistentWorkerManager({
    maxWorkers: 99,
    startWorker: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
  });

  const results = await Promise.allSettled(Array.from({ length: 9 }, (_, index) =>
    manager.create({ ...createInput, name: `worker-${index}` })
  ));

  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(8);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(manager.list()).toHaveLength(8);
  await manager.destroyAll(true);
});

test("enforces unique names and the persistent worker limit", async () => {
  const { managerPromise } = setup({ maxWorkers: 2 });
  const manager = await managerPromise;
  await manager.create(createInput);

  await expect(manager.create(createInput)).rejects.toThrow("Persistent worker name already exists: reviewer-1");
  await manager.create({ ...createInput, name: "reviewer-2" });
  await expect(manager.create({ ...createInput, name: "reviewer-3" }))
    .rejects.toThrow("Persistent worker limit reached (2)");
});

test("sends async and waited messages with per-message completion", async () => {
  const { managerPromise } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);

  const asynchronous = await manager.send({ workerId, message: "first", wait: false });
  expect(asynchronous).toMatchObject({ accepted: true, workerId, status: "completed" });
  expect(asynchronous.messageId).toMatch(/^msg-/u);
  await expect(manager.waitForMessage(workerId, asynchronous.messageId)).resolves.toMatchObject({
    status: "completed",
    text: "reply:first",
  });
  await expect(manager.send({ workerId, message: "second", wait: true })).resolves.toMatchObject({
    status: "completed",
    text: "reply:second",
  });
});

test("activates a single queued message even when Pi transforms its user text", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const first = await manager.send({ workerId, message: "first", wait: false });
  const queued = await manager.send({ workerId, message: "/template", wait: false, delivery: "followUp" });
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "first-result" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });
  workers[0]!.emit("event", {
    type: "message_start",
    message: { role: "user", content: [{ type: "text", text: "expanded template text" }] },
  });
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "queued-result" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(manager.waitForMessage(workerId, first.messageId)).resolves.toMatchObject({ text: "first-result" });
  await expect(manager.waitForMessage(workerId, queued.messageId)).resolves.toMatchObject({ text: "queued-result" });
});

test("correlates follow-up and steer completion to queued message IDs", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const first = await manager.send({ workerId, message: "first", wait: false });
  const followUp = await manager.send({ workerId, message: "second", wait: false, delivery: "followUp" });

  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "first-result" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });
  workers[0]!.emit("event", {
    type: "message_start",
    message: { role: "user", content: [{ type: "text", text: "second" }] },
  });
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "second-result" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });
  const thirdActive = await manager.send({ workerId, message: "third-base", wait: false });
  const steer = await manager.send({ workerId, message: "third", wait: false, delivery: "steer" });
  workers[0]!.emit("event", {
    type: "message_start",
    message: { role: "user", content: [{ type: "text", text: "third" }] },
  });
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "third-result" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(manager.waitForMessage(workerId, first.messageId)).resolves.toMatchObject({ text: "first-result" });
  await expect(manager.waitForMessage(workerId, followUp.messageId)).resolves.toMatchObject({ text: "second-result" });
  await expect(manager.waitForMessage(workerId, thirdActive.messageId)).resolves.toMatchObject({ status: "completed" });
  await expect(manager.waitForMessage(workerId, steer.messageId)).resolves.toMatchObject({ text: "third-result" });
});

test("projects frozen per-message telemetry and resets usage, summary, and progress budget on reuse", async () => {
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  const worker = new FakeWorker(); worker.holdPrompts = true;
  let now = 100;
  const manager = new PersistentWorkerManager({ now: () => now, progressEventLimit: 1, progressByteLimit: 4096, startWorker: async () => worker });
  const { workerId } = await manager.create(createInput);

  const first = await manager.send({ workerId, message: "first", wait: false });
  now = 150;
  const privatePath = ["", "Users", "person", "private", "report.md"].join("/");
  worker.emit("event", { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: `first ${privatePath}` }], usage: { input: 4, output: 2, cached: 99 } } });
  worker.emit("event", { type: "agent_end", willRetry: false });
  const firstResult = await manager.waitForMessage(workerId, first.messageId);
  now = 900;
  expect(firstResult.telemetry).toEqual({ elapsedMs: 50, usage: { input: 4, output: 2 }, latestAssistantSummary: "first [private-path]" });
  expect(manager.status(workerId).telemetry).toEqual(firstResult.telemetry);

  const second = await manager.send({ workerId, message: "second", wait: false });
  expect(manager.status(workerId).telemetry).toEqual({ elapsedMs: 0 });
  now = 925;
  worker.emit("event", { type: "message_end", message: { role: "assistant", content: [], usage: { input: 1 } } });
  worker.emit("event", { type: "agent_end", willRetry: false });
  await expect(manager.waitForMessage(workerId, second.messageId)).resolves.toMatchObject({ telemetry: { elapsedMs: 25, usage: { input: 1 } } });
  const compact = manager.read(workerId).events;
  expect(compact.filter((event) => event.type === "progress")).toHaveLength(2);
  expect(JSON.stringify(compact)).not.toContain("cached");
  expect(JSON.stringify(compact)).not.toContain(privatePath);
});

test("wait timeout leaves the worker turn running", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;

  const result = await manager.send({ workerId, message: "slow", wait: true, timeoutMs: 5 });

  expect(result.timedOut).toBe(true);
  expect(manager.status(workerId).status).toBe("running");
});

test("abort cancels queued messages and returns the worker to idle", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  await manager.send({ workerId, message: "active", wait: false });
  const queued = await manager.send({ workerId, message: "queued", wait: false, delivery: "followUp" });
  const aborting = manager.abort(workerId);
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Turn canceled" },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(aborting).resolves.toMatchObject({ aborted: true });
  await expect(manager.waitForMessage(workerId, queued.messageId)).rejects.toThrow("canceled by abort");
  expect(manager.status(workerId)).toMatchObject({ status: "idle", queuedMessageIds: [] });
});

test("rolls back abort intent when the abort RPC is rejected", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const sent = await manager.send({ workerId, message: "active", wait: false });
  workers[0]!.requestErrors.set("abort", new Error("abort rejected"));

  await expect(manager.abort(workerId)).rejects.toThrow("abort rejected");
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "normal result" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });
  await expect(manager.waitForMessage(workerId, sent.messageId)).resolves.toMatchObject({
    status: "completed",
    text: "normal result",
  });
});

test("abort waits for semantic cancellation evidence and preserves the worker", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const sent = await manager.send({ workerId, message: "slow", wait: false });

  const aborting = manager.abort(workerId);
  let settled = false;
  void aborting.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  expect(settled).toBe(false);
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Turn aborted" },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(aborting).resolves.toMatchObject({ workerId, aborted: true });
  await expect(manager.waitForMessage(workerId, sent.messageId)).rejects.toThrow("Turn aborted");
  expect(manager.status(workerId).status).toBe("idle");
  expect(manager.list()).toHaveLength(1);
});

test("can destroy and clean an already-crashed worker", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.emit("exit", 1, null);

  await expect(manager.destroy(workerId)).resolves.toMatchObject({ destroyed: true });
  expect(workers[0]!.cleaned).toBe(true);
  expect(manager.list()).toEqual([]);
});

test("marks crashes failed and rejects future sends", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.emit("exit", 1, null);
  expect(manager.status(workerId)).toMatchObject({ status: "failed" });
  await expect(manager.send({ workerId, message: "again" })).rejects.toThrow("Persistent worker failed");
});

test("does not reopen a destroying worker when the active turn settles", async () => {
  class DelayedExitWorker extends FakeWorker {
    override kill(signal: NodeJS.Signals): void {
      this.signals.push(signal);
    }
  }
  const worker = new DelayedExitWorker();
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  const manager = new PersistentWorkerManager({
    gracefulShutdownMs: 50,
    startWorker: async () => worker,
  });
  const { workerId } = await manager.create(createInput);
  worker.holdPrompts = true;
  await manager.send({ workerId, message: "slow", wait: false });
  const destroying = manager.destroy(workerId);
  worker.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "settled" }] },
  });
  worker.emit("event", { type: "agent_end", willRetry: false });

  expect(manager.status(workerId).status).toBe("destroying");
  await expect(manager.send({ workerId, message: "too late" })).rejects.toThrow("being destroyed");
  worker.emit("exit", 0, "SIGTERM");
  await expect(destroying).resolves.toMatchObject({ destroyed: true });
});

test("destroys workers explicitly, cleans resources, and never expires idle workers", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const first = await manager.create(createInput);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(manager.list()).toHaveLength(1);

  await expect(manager.destroy(first.workerId)).resolves.toEqual({ workerId: first.workerId, destroyed: true });
  expect(workers[0]!.signals).toContain("SIGTERM");
  expect(workers[0]!.cleaned).toBe(true);
  expect(manager.list()).toEqual([]);
});

test("does not return an idle worker if the process exits during startup", async () => {
  class ExitingStartupWorker extends FakeWorker {
    override async request(type: string, payload: Readonly<Record<string, unknown>> = {}): Promise<unknown> {
      if (type === "get_state") this.emit("exit", 1, null);
      return super.request(type, payload);
    }
  }
  const worker = new ExitingStartupWorker();
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  const manager = new PersistentWorkerManager({ startWorker: async () => worker });

  await expect(manager.create(createInput)).rejects.toThrow("exited unexpectedly");
  expect(manager.list()).toEqual([]);
});

test("does not report destruction when the child never exits", async () => {
  class StuckWorker extends FakeWorker {
    override kill(signal: NodeJS.Signals): void {
      this.signals.push(signal);
    }
  }
  const worker = new StuckWorker();
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  const manager = new PersistentWorkerManager({
    gracefulShutdownMs: 2,
    startWorker: async () => worker,
  });
  const { workerId } = await manager.create(createInput);

  await expect(manager.destroy(workerId)).rejects.toThrow("did not exit");
  expect(manager.status(workerId).status).toBe("failed");
  expect(worker.cleaned).toBe(false);
});

test("surfaces cleanup failure and retains a failed worker for retry", async () => {
  class CleanupFailureWorker extends FakeWorker {
    override async cleanup(): Promise<void> {
      throw new Error("cleanup failed");
    }
  }
  const worker = new CleanupFailureWorker();
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  const manager = new PersistentWorkerManager({ startWorker: async () => worker });
  const { workerId } = await manager.create(createInput);

  await expect(manager.destroyAll()).rejects.toThrow("Failed to destroy all workers");
  expect(manager.status(workerId)).toMatchObject({ status: "failed", error: "cleanup failed" });
});

test("cleans a worker whose startup RPC fails", async () => {
  const worker = new FakeWorker();
  worker.startupError = new Error("startup failed");
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  const manager = new PersistentWorkerManager({ startWorker: async () => worker });

  await expect(manager.create(createInput)).rejects.toThrow("startup failed");
  expect(worker.signals).toContain("SIGKILL");
  expect(worker.cleaned).toBe(true);
  expect(manager.list()).toEqual([]);
});

test("recovers from an errored provider attempt when the retry succeeds", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const sent = await manager.send({ workerId, message: "retry", wait: false });
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "error", errorMessage: "attempt failed" },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: true });
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "retry succeeded" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(manager.waitForMessage(workerId, sent.messageId)).resolves.toMatchObject({
    status: "completed",
    text: "retry succeeded",
  });
});

test("settles message failure and restores truthful state when RPC prompt fails", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.requestErrors.set("prompt", new Error("prompt rejected"));

  const error = await manager.send({ workerId, message: "fail" }).catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(Error);
  expect(manager.status(workerId)).toMatchObject({ status: "idle" });
  const messageId = manager.read(workerId, { includeDetails: false }).events
    .find((event) => event.type === "message.accepted")?.messageId;
  await expect(manager.waitForMessage(workerId, messageId!)).rejects.toThrow("prompt rejected");
});

test("treats normal settlement after an abort request as cancellation", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const sent = await manager.send({ workerId, message: "slow", wait: false });
  const aborting = manager.abort(workerId);
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "settled" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(aborting).resolves.toMatchObject({ aborted: true });
  await expect(manager.waitForMessage(workerId, sent.messageId)).rejects.toThrow("settled after abort");
});

test("uses abort stopReason rather than wording as semantic evidence", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const sent = await manager.send({ workerId, message: "slow", wait: false });
  const aborting = manager.abort(workerId);
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Cancelled by user" },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(aborting).resolves.toMatchObject({ aborted: true });
  await expect(manager.waitForMessage(workerId, sent.messageId)).rejects.toThrow("Cancelled by user");
});

test("rejects busy delivery and does not complete while the provider will retry", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  workers[0]!.holdPrompts = true;
  const sent = await manager.send({ workerId, message: "slow", wait: false });

  await expect(manager.send({ workerId, message: "no", wait: false, delivery: "reject" }))
    .rejects.toThrow(`Persistent worker ${workerId} is busy`);
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "attempt-one" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: true });
  expect(manager.status(workerId).status).toBe("running");
  workers[0]!.emit("event", {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "attempt-two" }] },
  });
  workers[0]!.emit("event", { type: "agent_end", willRetry: false });

  await expect(manager.waitForMessage(workerId, sent.messageId)).resolves.toMatchObject({
    status: "completed",
    text: "attempt-two",
  });
});

test("reports message terminal status for dispatch lifecycle correlation", async () => {
  const { managerPromise } = setup();
  const manager = await managerPromise;
  const { workerId } = await manager.create(createInput);
  const sent = await manager.send({ workerId, message: "status", wait: false });

  expect(manager.messageStatus(workerId, sent.messageId)).toBe("completed");
});

test("synchronous abandonment kills workers and removes them without claiming graceful destruction", async () => {
  const { managerPromise, workers } = setup();
  const manager = await managerPromise;
  await manager.create(createInput);

  manager.abandonAll();

  expect(workers[0]!.signals).toEqual(["SIGKILL"]);
  expect(manager.list()).toEqual([]);
  await new Promise((resolve) => setImmediate(resolve));
  expect(workers[0]!.cleaned).toBe(true);
});

test("destroyAll invalidates a deferred worker creation and cleans the child", async () => {
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  let resolveStart!: (worker: FakeWorker) => void;
  const started = new Promise<FakeWorker>((resolve) => { resolveStart = resolve; });
  const manager = new PersistentWorkerManager({ startWorker: async () => started });
  const creating = manager.create(createInput);

  const destroying = manager.destroyAll();
  const worker = new FakeWorker();
  resolveStart(worker);

  await expect(creating).rejects.toThrow("shutting down");
  await expect(destroying).resolves.toBeUndefined();
  expect(worker.signals).toEqual(["SIGKILL"]);
  expect(worker.cleaned).toBe(true);
  expect(manager.list()).toEqual([]);
  await expect(manager.create({ ...createInput, name: "after-shutdown" })).rejects.toThrow("shutting down");
});

test("abandonAll invalidates a deferred worker creation and asynchronously cleans the child", async () => {
  const { PersistentWorkerManager } = await import("../../src/runtime/persistent-manager.js");
  let resolveStart!: (worker: FakeWorker) => void;
  const started = new Promise<FakeWorker>((resolve) => { resolveStart = resolve; });
  const manager = new PersistentWorkerManager({ startWorker: async () => started });
  const creating = manager.create(createInput);

  manager.abandonAll();
  const worker = new FakeWorker();
  resolveStart(worker);

  await expect(creating).rejects.toThrow("shutting down");
  await new Promise((resolve) => setImmediate(resolve));
  expect(worker.signals).toEqual(["SIGKILL"]);
  expect(worker.cleaned).toBe(true);
  expect(manager.list()).toEqual([]);
  await expect(manager.create({ ...createInput, name: "after-abandon" })).rejects.toThrow("shutting down");
});
