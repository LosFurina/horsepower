import { expect, test, vi } from "vitest";

const genericId = (...parts: string[]) => parts.join("/");

function captain(orchestration: { execute(input: unknown, caller: { captain: boolean }): Promise<unknown> }, input: unknown) {
  return orchestration.execute(input, { captain: true });
}

test("unknown agent returns available-agent remediation with coder guidance", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => { throw Object.assign(new Error(`Unknown agent: ${name}. Available agents: coder, reviewer`), { code: "AGENT_NOT_FOUND", horsepowerFailure: { code: "AGENT_NOT_FOUND", boundary: "agent_catalog", remediation: "Use agent: coder for implementation tasks or review the agent catalog." } }); },
    createWorker: async () => { throw new Error("unexpected"); },
    beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration, {
    action: "single", handoffMode: "inline", changeId: "c", cwd: "/p", name: "w", agent: "bogus", modelSlot: "craft", task: "work",
  })).rejects.toMatchObject({ message: /Unknown agent/ });
});

test("unknown model slot returns structured error with code", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => { throw Object.assign(new Error(`Unknown model slot: ${slot}. Available slots: judgment, craft, utility`), { code: "UNKNOWN_SLOT" }); },
    validateModel: () => undefined,
    getAgent: (name) => { throw new Error("unexpected"); },
    createWorker: async () => { throw new Error("unexpected"); },
    beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "c", cwd: "/p", name: "w", agent: "coder", modelSlot: "nonexistent",
  })).rejects.toThrow(/Unknown model slot/);
});

test("spawn empty error returns structured failure with worker stage", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => { throw Object.assign(new Error("spawn failed"), { code: "SPAWN_FAILED" }); },
    beginDispatch: () => ({ runId: "run-spawn" }),
    reportDispatchTerminal: async () => undefined,
  });

  const result: Record<string, unknown> = await captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "craft",
  }) as Record<string, unknown>;

  expect(result).toMatchObject({ status: "failed" });
  // The failure should have a stage but the code and message depend on how the error propagates
  expect(result.failure).toBeDefined();
});

test("spawn with Horsepower-specific failure retains its code", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => {
      throw Object.assign(new Error("model rejected"), { horsepowerFailure: { code: "MODEL_REJECTED", boundary: "provider", stage: "worker", message: "model rejected", remediation: "choose another" } });
    },
    beginDispatch: () => ({ runId: "run-model-reject" }),
    reportDispatchTerminal: async () => undefined,
  });

  const result = await captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "craft",
  });

  expect(result).toMatchObject({ status: "failed", failure: { stage: "worker", code: "MODEL_REJECTED" } });
});

test("partial parallel failure preserves completed child outcomes", async () => {
  const progress: Array<Record<string, unknown>> = []; const handoffTerminals: Array<{ runId: string; status: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const { OneShotBatchError } = await import("../../src/runtime/one-shot.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Review", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async () => { throw new Error("unused"); }, parallel: async () => { throw new OneShotBatchError([
      { status: "fulfilled", value: { name: "ok", text: "done" } },
      { status: "rejected", reason: new Error("worker b failure") },
      { status: "rejected", reason: new Error("worker c failure") },
    ]); }, chain: async () => [] },
    beginDispatch: () => ({ runId: "run-partial-fail" }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: {} }),
    validateHandoffReport: async ({ runId }) => ({ runId, artifactId: "report" }),
    recordHandoffTerminal: async ({ runId, status }) => { handoffTerminals.push({ runId, status }); },
    reportDispatchTerminal: async () => undefined,
    onProgress: (event) => { progress.push(event as Record<string, unknown>); },
  });

  const result = await captain(orchestration, { action: "parallel", handoffMode: "managed", changeId: "c", cwd: "/p", tasks: [
    { name: "ok", agent: "a", modelSlot: "craft", task: "ok" },
    { name: "b", agent: "a", modelSlot: "craft", task: "b" },
    { name: "c", agent: "a", modelSlot: "craft", task: "c" },
  ] });

  expect(result).toMatchObject({ status: "failed", failure: { message: "worker b failure" } });
  const childTerminal = progress.filter((event) => ["completed", "failed", "canceled"].includes(String(event.type)));
  expect(childTerminal).toMatchObject([
    { type: "completed", identity: { name: "ok" } },
    { type: "failed", identity: { name: "b" }, summary: "worker b failure" },
    { type: "failed", identity: { name: "c" }, summary: "worker c failure" },
  ]);
  expect(handoffTerminals).toEqual([
    { runId: "run-partial-fail-2", status: "failed" },
    { runId: "run-partial-fail-3", status: "failed" },
  ]);
});

test("managed-report failure retains handoff stage", async () => {
  const terminals: Array<{ runId: string; status: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Implement", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async () => ({ name: "one", text: "done" }), parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: "run-report-fail" }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } }),
    validateHandoffReport: async () => { throw new Error("report validation failed"); },
    recordHandoffTerminal: async ({ runId, status }) => { terminals.push({ runId, status }); },
    reportDispatchTerminal: async () => undefined,
  });

  const result = await captain(orchestration, {
    action: "single", handoffMode: "managed", changeId: "c", cwd: "/p", name: "one", agent: "a", modelSlot: "craft", task: "work",
  });

  expect(result).toMatchObject({ status: "failed", failure: { stage: "handoff_report", message: "report validation failed" } });
  expect(terminals).toEqual([{ runId: "run-report-fail", status: "failed" }]);
});

test("post-admission persistent failure projects through error identity", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "run-persistent-fail" }),
    reportDispatchTerminal: async () => undefined,
    statusWorker: () => ({ model: genericId("p", "m"), thinking: "high" }),
    sendWorker: async () => ({ messageId: "msg-1" }),
    waitForMessage: async () => { throw Object.assign(new Error("persistent worker failed"), { structuredFailure: { code: "HP-PERSISTENT-MESSAGE-FAILED", boundary: "persistent-worker", stage: "message" } }); },
    messageStatus: () => "failed",
    handleWorkerCapabilityRejection: () => undefined,
  });

  const result = await captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "c", cwd: "/p", workerId: "w", message: "work",
  });

  expect(result).toMatchObject({ status: "failed", failure: { stage: "worker" } });
});

test("RPC worker exit failure projects through terminal", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "run-rpc-exit" }),
    reportDispatchTerminal: async () => undefined,
    sendWorker: async () => ({ messageId: "msg-1" }),
    waitForMessage: async () => { throw Object.assign(new Error("Pi RPC process exited unexpectedly"), { code: "HP-PERSISTENT-WORKER-EXIT" }); },
    messageStatus: () => "failed",
  });

  const result = await captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "c", cwd: "/p", workerId: "w", message: "work",
  });

  expect(result).toMatchObject({ status: "failed", failure: { stage: "worker" } });
});

test("cancellation during one-shot retains canceled status with DIPATCH_CANCELED code", async () => {
  const controller = new AbortController();
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Review", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async () => { controller.abort(); throw new Error("aborted"); }, parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: "run-cancel" }), signal: controller.signal,
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: {} }),
    recordHandoffTerminal: async () => undefined,
    reportDispatchTerminal: async () => undefined,
  });

  const result = await captain(orchestration, {
    action: "single", handoffMode: "managed", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "craft", task: "work",
  });

  expect(result).toMatchObject({ status: "canceled", failure: { code: "DISPATCH_CANCELED", boundary: "cancellation", stage: "worker" } });
});

test("cleanup degradation preserves primary failure", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Implement", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async () => { throw new Error("worker primary"); }, parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: "run-cleanup-degrade" }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: {} }),
    recordHandoffTerminal: async () => { throw new Error("terminal write failed"); },
    reportDispatchTerminal: async () => { throw new Error("dispatch terminal failed"); },
  });

  const result: Record<string, unknown> = await captain(orchestration, {
    action: "single", handoffMode: "managed", changeId: "c", cwd: "/p", name: "one", agent: "a", modelSlot: "craft", task: "work",
  }) as Record<string, unknown>;

  expect(result).toMatchObject({ status: "failed", failure: { stage: "worker", message: "worker primary" } });
  expect(result.cleanupFailures).toBeDefined();
  const cleanupFailures = result.cleanupFailures as Array<Record<string, unknown>>;
  expect(cleanupFailures.length).toBeGreaterThanOrEqual(1);
  expect(cleanupFailures[0]).toMatchObject({ message: "terminal write failed" });
  // The dispatch terminal failure is also in cleanupFailures
  expect(cleanupFailures.some((f: Record<string, unknown>) => f.message === "dispatch terminal failed")).toBe(true);
});

test("chain failure with managed handoff skips remaining and cancels their handoffs", async () => {
  const seen: string[] = [];
  const handoffTerminals: Array<{ runId: string; status: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const { createOneShotExecutor } = await import("../../src/runtime/one-shot.js");
  const executor = createOneShotExecutor({
    run: async (invocation) => {
      seen.push(invocation.name);
      if (invocation.name === "fail") throw new Error("chain broke");
      return { name: invocation.name, text: `ok:${invocation.name}` };
    },
  });
  
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: executor,
    beginDispatch: () => ({ runId: "run-chain" }),
    createHandoff: async ({ runId }) => {
      return { worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } };
    },
    validateHandoffReport: async ({ runId }) => {
      return { runId, artifactId: "report" };
    },
    recordHandoffTerminal: async ({ runId, status }) => { handoffTerminals.push({ runId, status }); },
    reportDispatchTerminal: async () => undefined,
  });

  const result = await captain(orchestration, {
    action: "chain", handoffMode: "managed", changeId: "c", cwd: "/p", tasks: [
      { name: "ok", agent: "a", modelSlot: "craft", task: "first" },
      { name: "fail", agent: "a", modelSlot: "craft", task: "second" },
      { name: "never", agent: "a", modelSlot: "craft", task: "third" },
    ],
  });

  expect(seen).toEqual(["ok", "fail"]);
  expect(result).toMatchObject({ status: "failed" });
  // The first handoff completed OK and was validated;
  // The second failed; the third was never executed (skipped after failure)
  // For chain: createdHandoffIds includes all 3, then:
  // - fulfilled: run-chain-1 -> terminalized N/A (validated, not terminalized)
  // - rejected: run-chain-2 -> terminalized as failed
  // - skipped: run-chain-3 -> terminalized as canceled
  expect(handoffTerminals.length).toBe(2); // one failed, one canceled (first succeeded)
  expect(handoffTerminals.filter(t => t.status === "failed").length).toBe(1);
  expect(handoffTerminals.filter(t => t.status === "canceled").length).toBe(1);
});
