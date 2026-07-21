import { Check } from "typebox/value";
import { expect, test, vi } from "vitest";

function captain(orchestration: { execute(input: unknown, caller: { captain: boolean }): Promise<unknown> }, input: unknown) {
  return orchestration.execute(input, { captain: true });
}

test("exports a strict Horsepower TypeBox action schema", async () => {
  const module = await import("../../src/orchestration/schema.js").catch(() => undefined);
  const schema = module?.horsepowerSubagentSchema as Record<string, unknown> | undefined;

  expect(schema).toBeDefined();
  expect((schema?.anyOf as Array<{ additionalProperties?: boolean }>).every((variant) => variant.additionalProperties === false)).toBe(true);
  expect(JSON.stringify(schema)).toContain("report_terminal");
  expect(JSON.stringify(schema)).toContain("e2eWaiver");
  expect(JSON.stringify(schema)).toContain("modelSlot");
  expect(Check(schema as never, { action: "list", cwd: "/project", task: "wrong" })).toBe(false);
  expect(Check(schema as never, { action: "create", handoffMode: "inline", changeId: "x", cwd: "/project", name: "n", agent: "a" })).toBe(false);
});

test("review campaign budget is consumed before a review dispatch creates work", async () => {
  const calls: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => { calls.push("authorize"); },
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Review.", tools: [], recommendedSlots: [], standards: [] }),
    createWorker: async () => { calls.push("worker"); return { workerId: "w" }; },
    beginDispatch: () => { calls.push("dispatch"); return { runId: "run" }; },
    consumeReviewCampaign: (input) => { calls.push(`consume:${input.campaignId}`); throw new Error("Review campaign budget exhausted: campaign-1"); },
    reportDispatchTerminal: async () => undefined,
  });
  await expect(captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "change-a", cwd: "/project", name: "review", agent: "reviewer", modelSlot: "judgment", reviewCampaignId: "campaign-1",
  })).rejects.toThrow("budget exhausted");
  expect(calls).toEqual(["authorize", "consume:campaign-1"]);
});

test("workers cannot create or extend review campaigns", async () => {
  let mutations = 0;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); }, validateModel: () => undefined, getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }), beginDispatch: () => ({ runId: "unused" }), reportDispatchTerminal: async () => undefined,
    beginReviewCampaign: () => { mutations += 1; throw new Error("unexpected"); },
    extendReviewCampaign: () => { mutations += 1; throw new Error("unexpected"); },
  });
  await expect(orchestration.execute({ action: "begin_review_campaign", changeId: "change-a", cwd: "/project", acceptanceScope: "task", budget: 1 }, { captain: false }))
    .rejects.toThrow("Captain capability is required");
  await expect(orchestration.execute({ action: "extend_review_campaign", changeId: "change-a", cwd: "/project", campaignId: "campaign-1", additionalBudget: 1, humanAuthorized: true, reason: "human" }, { captain: false }))
    .rejects.toThrow("Captain capability is required");
  expect(mutations).toBe(0);
});

test("rejects advancing actions without Captain capability before authorization", async () => {
  let authorized = false;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => { authorized = true; },
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined,
  });

  await expect(orchestration.execute({
    action: "create", handoffMode: "inline", changeId: "x", cwd: "/project", name: "n", agent: "a", modelSlot: "judgment",
  }, { captain: false })).rejects.toThrow("Captain capability is required for create");
  expect(authorized).toBe(false);
});

test("rechecks admission after asynchronous authorization before registering work", async () => {
  let release!: () => void;
  const authorized = new Promise<void>((resolve) => { release = resolve; });
  let open = true;
  let dispatches = 0;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => authorized,
    assertOpen: () => { if (!open) throw new Error("Horsepower runtime is closed"); },
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginChange: () => { dispatches += 1; return { runId: "unused" }; },
    beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined,
  });

  const execution = captain(orchestration, {
    action: "begin_change", changeId: "change-a", cwd: "/project",
  });
  open = false;
  release();

  await expect(execution).rejects.toThrow("Horsepower runtime is closed");
  expect(dispatches).toBe(0);
});

test("rejects an unknown resolved model before spawning any work", async () => {
  let workers = 0;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: "unknown/model", thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: (slot) => { throw new Error(`Unknown model: ${slot.model}`); },
    getAgent: (name) => ({ name, role: name, prompt: "Prompt.", tools: [], recommendedSlots: [], standards: [] }),
    createWorker: async () => { workers += 1; return { workerId: "unused" }; },
    beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "x", cwd: "/project", name: "n", agent: "a", modelSlot: "judgment",
  })).rejects.toThrow("Unknown model: unknown/model");
  expect(workers).toBe(0);
});

test.each(["unsupported", "inconclusive"] as const)("gates persistent creation after slot resolution and before run, handoff, prompt, or child side effects on %s", async (status) => {
  const calls: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => { calls.push("authorize"); },
    resolveSlot: (slot) => { calls.push("resolve"); return { requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high", fallbackPath: [slot], revision: "slot-r" }; },
    validateModel: () => { calls.push("catalog"); },
    validateCapability: async () => { calls.push("gate"); throw Object.assign(new Error(status), { status }); },
    getAgent: () => { calls.push("agent"); return { name: "a", role: "a", prompt: "Prompt", tools: [], recommendedSlots: [], standards: [] }; },
    createWorker: async () => { calls.push("child"); return { workerId: "w" }; },
    beginDispatch: () => { calls.push("run"); return { runId: "run" }; },
    createHandoff: async () => { calls.push("handoff"); throw new Error("unused"); },
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration, {
    action: "create", handoffMode: "managed", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "judgment", brief: "work",
  })).rejects.toThrow(status);
  expect(calls).toEqual(["authorize", "resolve", "catalog", "gate"]);
});

test.each(["single", "parallel"] as const)("gates %s one-shot after all slot resolution and before run, handoff, temporary prompt, or child side effects", async (action) => {
  const calls: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => { calls.push("authorize"); },
    resolveSlot: (slot) => { calls.push(`resolve:${slot}`); return { requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high", fallbackPath: [slot], revision: "slot-r" }; },
    validateModel: () => { calls.push("catalog"); },
    validateCapability: async (slot) => { calls.push(`gate:${slot.requestedSlot}`); if (slot.requestedSlot === "craft") throw new Error("unsupported"); },
    getAgent: (name) => { calls.push(`agent:${name}`); return { name, role: name, prompt: "Prompt", tools: [], recommendedSlots: [], standards: [] }; },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => { calls.push("run"); return { runId: "run" }; },
    createHandoff: async () => { calls.push("handoff"); throw new Error("unused"); },
    oneShot: {
      single: async () => { calls.push("temporary-prompt/child"); return { name: "a", text: "done" }; },
      parallel: async () => { calls.push("temporary-prompt/child"); return []; },
      chain: async () => [],
    },
    reportDispatchTerminal: async () => undefined,
  });
  const input = action === "single"
    ? { action, handoffMode: "inline", changeId: "c", cwd: "/p", name: "a", agent: "a", modelSlot: "craft", task: "work" }
    : { action, handoffMode: "managed", changeId: "c", cwd: "/p", tasks: [
        { name: "a", agent: "a", modelSlot: "judgment", task: "one" },
        { name: "b", agent: "b", modelSlot: "craft", task: "two" },
      ] };

  await expect(captain(orchestration, input)).rejects.toThrow("unsupported");
  expect(calls).not.toContain("run");
  expect(calls).not.toContain("handoff");
  expect(calls).not.toContain("temporary-prompt/child");
  expect(calls.indexOf("resolve:craft")).toBeLessThan(calls.indexOf("gate:craft"));
});

test("actual worker capability rejection invalidates evidence without fallback or binding mutation", async () => {
  const configured = { model: "p/m", thinking: "high" as const };
  const attempts: Array<{ model: string; thinking: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const rejection = { kind: "capability_rejection", parameter: "thinking", rejectedValue: "high", code: "INVALID_THINKING" };
  const invalidated = vi.fn(() => Object.assign(new Error("Model capability rejected; run horsepower setup --interactive"), {
    code: "MODEL_CAPABILITY_REJECTED", status: "unsupported",
  }));
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, ...configured, fallbackPath: [slot], revision: "slot-r" }),
    validateModel: () => undefined,
    validateCapability: async () => undefined,
    handleWorkerCapabilityRejection: invalidated,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], recommendedSlots: [], standards: [] }),
    createWorker: async (input) => { attempts.push({ model: input.model, thinking: input.thinking }); throw rejection; },
    beginDispatch: () => ({ runId: "run" }),
    reportDispatchTerminal: async () => undefined,
  });

  const error = await captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "judgment",
  }).catch((cause: unknown) => cause) as Error & { code?: string };

  expect(error).toMatchObject({ code: "MODEL_CAPABILITY_REJECTED" });
  expect(attempts).toEqual([{ model: "p/m", thinking: "high" }]);
  expect(invalidated).toHaveBeenCalledTimes(1);
  expect(configured).toEqual({ model: "p/m", thinking: "high" });
});

test("parallel worker capability rejection invalidates each matching attempted combination without retry", async () => {
  const attempts: Array<Array<{ model: string; thinking: string }>> = [];
  const invalidated = vi.fn((slot: { model: string; thinking: string }, cause: unknown) =>
    slot.thinking === "high" && (cause as { kind?: unknown }).kind === "capability_rejection"
      ? Object.assign(new Error("Reconfigure with horsepower setup --interactive"), { code: "MODEL_CAPABILITY_REJECTED", status: "unsupported" })
      : undefined
  );
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: `p/${slot}`, thinking: "high", fallbackPath: [slot], revision: "slot-r" }),
    validateModel: () => undefined, validateCapability: async () => undefined,
    handleWorkerCapabilityRejection: invalidated,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], recommendedSlots: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: {
      single: async () => ({ name: "unused", text: "unused" }),
      parallel: async (inputs) => {
        attempts.push(inputs.map(({ model, thinking }) => ({ model, thinking })));
        throw { kind: "capability_rejection", parameter: "thinking", rejectedValue: "high", code: "INVALID_THINKING" };
      },
      chain: async () => [],
    },
    beginDispatch: () => ({ runId: "run" }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/tmp/${runId}/brief`, reportPath: `/tmp/${runId}/report` }, reference: {} }),
    recordHandoffTerminal: async () => undefined,
    reportDispatchTerminal: async () => undefined,
  });

  const error = await captain(orchestration, {
    action: "parallel", handoffMode: "managed", changeId: "c", cwd: "/p", tasks: [
      { name: "one", agent: "a", modelSlot: "judgment", task: "one" },
      { name: "two", agent: "a", modelSlot: "craft", task: "two" },
    ],
  }).catch((cause: unknown) => cause) as Error & { code?: string };

  expect(error).toMatchObject({ code: "MODEL_CAPABILITY_REJECTED" });
  expect(attempts).toEqual([[{ model: "p/judgment", thinking: "high" }, { model: "p/craft", thinking: "high" }]]);
  expect(invalidated.mock.calls.map(([slot]) => slot.model)).toEqual(["p/judgment", "p/craft"]);
});

test("one-shot worker capability rejection invalidates evidence without automatic fallback", async () => {
  const attempts: Array<{ model: string; thinking: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const invalidated = vi.fn(() => Object.assign(new Error("Reconfigure with horsepower setup --interactive"), {
    code: "MODEL_CAPABILITY_REJECTED", status: "unsupported",
  }));
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "xhigh", fallbackPath: [slot], revision: "slot-r" }),
    validateModel: () => undefined,
    validateCapability: async () => undefined,
    handleWorkerCapabilityRejection: invalidated,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], recommendedSlots: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: {
      single: async (input) => {
        attempts.push({ model: input.model, thinking: input.thinking });
        throw { kind: "capability_rejection", parameter: "thinking", rejectedValue: "xhigh", code: "INVALID_THINKING" };
      },
      parallel: async () => [],
      chain: async () => [],
    },
    beginDispatch: () => ({ runId: "run" }),
    reportDispatchTerminal: async () => undefined,
  });

  const error = await captain(orchestration, {
    action: "single", handoffMode: "inline", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "judgment", task: "work",
  }).catch((cause: unknown) => cause) as Error & { code?: string };

  expect(error).toMatchObject({ code: "MODEL_CAPABILITY_REJECTED" });
  expect(attempts).toEqual([{ model: "p/m", thinking: "xhigh" }]);
  expect(invalidated).toHaveBeenCalledTimes(1);
});

test("authorizes and executes exactly one explicitly requested persistent creation", async () => {
  const calls: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js").catch(() => ({
    createOrchestration: undefined,
  }));
  const orchestration = createOrchestration?.({
    authorize: async () => { calls.push("authorize"); },
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: "provider/model", thinking: "high", fallbackPath: [slot], revision: "rev" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Review", prompt: "Review.", tools: ["read"], recommendedSlots: ["judgment"], standards: [] }),
    createWorker: async (input) => { calls.push(`create:${input.name}`); return { workerId: "worker-1" }; },
    beginDispatch: () => ({ runId: "run-1" }),
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration!, {
    action: "create", handoffMode: "inline",
    changeId: "horsepower-alpha1",
    cwd: "/project",
    name: "reviewer-1",
    agent: "reviewer",
    modelSlot: "judgment",
  })).resolves.toMatchObject({ workerId: "worker-1", runId: "run-1" });
  expect(calls).toEqual(["authorize", "create:reviewer-1"]);
});

test("dispatches exactly the explicit parallel tasks and reports terminal lifecycle", async () => {
  const dispatched: string[] = [];
  const terminal: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: `${name}.`, tools: ["read"], recommendedSlots: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: {
      single: async (input) => ({ name: input.name, text: input.task }),
      parallel: async (inputs) => { dispatched.push(...inputs.map((input) => input.name)); return inputs.map((input) => ({ name: input.name, text: input.task })); },
      chain: async () => [],
    },
    beginDispatch: () => ({ runId: "run-parallel" }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief.md`, reportPath: `/private/${runId}/report.md` }, reference: { runId } }),
    validateHandoffReport: async ({ runId }) => ({ runId, artifactId: "report" }),
    reportDispatchTerminal: async (report) => { terminal.push(report.status); },
  });

  const result = await captain(orchestration, {
    action: "parallel", handoffMode: "managed",
    changeId: "horsepower-alpha1",
    cwd: "/project",
    tasks: [
      { name: "a", agent: "reviewer", modelSlot: "judgment", task: "A" },
      { name: "b", agent: "tester", modelSlot: "craft", task: "B" },
    ],
  });

  expect(dispatched).toEqual(["a", "b"]);
  expect(terminal).toEqual(["completed"]);
  expect(result).toMatchObject({
    runId: "run-parallel",
    slots: [
      { requestedSlot: "judgment", resolvedSlot: "judgment", model: "p/m", thinking: "high", fallbackPath: ["judgment"] },
      { requestedSlot: "craft", resolvedSlot: "craft", model: "p/m", thinking: "high", fallbackPath: ["craft"] },
    ],
  });
});

test("reports unknown action at the action path", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration, { action: "bogus", cwd: "/project" }))
    .rejects.toThrow("$.action: unsupported action bogus");
});

test("safe actions never start dispatches or workers", async () => {
  let creations = 0;
  let dispatches = 0;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => { creations += 1; return { workerId: "unused" }; },
    beginDispatch: () => { dispatches += 1; return { runId: "unused" }; },
    reportDispatchTerminal: async () => undefined,
    listWorkers: () => [{ workerId: "worker-1" }],
  });

  await expect(captain(orchestration, { action: "list", cwd: "/project" }))
    .resolves.toEqual([{ workerId: "worker-1" }]);
  expect({ creations, dispatches }).toEqual({ creations: 0, dispatches: 0 });
});

test("Captain terminal reporting uses E2E evidence without creating work", async () => {
  let report: unknown;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => { throw new Error("unused"); },
    beginDispatch: () => { throw new Error("unused"); },
    reportDispatchTerminal: async () => undefined,
    reportChangeTerminal: async (input) => { report = input; return { run: { status: input.status } }; },
    identityForRun: () => ({ changeId: "horsepower-alpha1", projectId: "/project" }),
  });

  await captain(orchestration, {
    action: "report_terminal",
    changeId: "horsepower-alpha1",
    cwd: "/project",
    runId: "run-change",
    status: "completed",
    summary: "done",
    e2e: [{ command: "npm run e2e", exitCode: 0, summary: "passed" }],
  });

  expect(report).toMatchObject({ runId: "run-change", status: "completed", evidence: { e2e: [{ exitCode: 0 }] } });
});

test("rejects change terminal reporting when run belongs to another change", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined,
    reportChangeTerminal: async () => ({ run: {} }),
    identityForRun: () => ({ changeId: "change-a", projectId: "/project" }),
  });

  await expect(captain(orchestration, {
    action: "report_terminal", changeId: "change-b", cwd: "/project", runId: "run-a",
    status: "failed", summary: "failed",
  })).rejects.toThrow("Run run-a belongs to change change-a, not change-b");
});

test("validates persistent settlement dependencies before beginning a dispatch", async () => {
  let dispatches = 0;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => { dispatches += 1; return { runId: "unused" }; },
    reportDispatchTerminal: async () => undefined,
    sendWorker: async () => ({ messageId: "message-1" }),
  });

  await expect(captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "x", cwd: "/project", workerId: "w", message: "m",
  })).rejects.toThrow("Orchestration dependency is unavailable: waitForMessage");
  expect(dispatches).toBe(0);
});

test("clears the timeout when waited settlement completes first", async () => {
  vi.useFakeTimers();
  try {
    const { createOrchestration } = await import("../../src/orchestration/facade.js");
    const orchestration = createOrchestration({
      authorize: async () => undefined,
      resolveSlot: () => { throw new Error("unused"); },
      validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
      createWorker: async () => ({ workerId: "unused" }),
      beginDispatch: () => ({ runId: "run-send" }),
      reportDispatchTerminal: async () => undefined,
      sendWorker: async () => ({ messageId: "message-1" }),
      waitForMessage: async () => ({ status: "completed" }),
      messageStatus: () => "completed",
    });

    await captain(orchestration, {
      action: "send", handoffMode: "inline", changeId: "x", cwd: "/project", workerId: "w", message: "m",
      wait: true, timeoutMs: 1_500,
    });
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("wait timeout returns without canceling persistent dispatch settlement", async () => {
  let finish!: () => void;
  const completion = new Promise<void>((resolve) => { finish = resolve; });
  const terminal: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "run-send" }),
    reportDispatchTerminal: async (report) => { terminal.push(report.status); },
    sendWorker: async () => ({ messageId: "message-1" }),
    waitForMessage: async () => { await completion; return { status: "completed" }; },
    messageStatus: () => "completed",
  });

  await expect(captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "x", cwd: "/project", workerId: "w", message: "m",
    wait: true, timeoutMs: 2,
  })).resolves.toMatchObject({ runId: "run-send", timedOut: true });
  expect(terminal).toEqual([]);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  expect(terminal).toEqual(["completed"]);
});

test("maps wait-true semantic cancellation to canceled dispatch terminal", async () => {
  const terminal: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "run-send" }),
    reportDispatchTerminal: async (report) => { terminal.push(report.status); },
    sendWorker: async () => ({ messageId: "message-1" }),
    waitForMessage: async () => { throw new Error("canceled"); },
    messageStatus: () => "canceled",
  });

  await expect(captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "x", cwd: "/project", workerId: "w", message: "m", wait: true,
  })).rejects.toThrow("canceled");
  expect(terminal).toEqual(["canceled"]);
});

test("maps semantic persistent cancellation to canceled dispatch terminal", async () => {
  const terminal: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "run-send" }),
    reportDispatchTerminal: async (report) => { terminal.push(report.status); },
    sendWorker: async () => ({ messageId: "message-1" }),
    waitForMessage: async () => { throw new Error("canceled"); },
    messageStatus: () => "canceled",
  });

  await captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "x", cwd: "/project", workerId: "w", message: "m",
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(terminal).toEqual(["canceled"]);
});

test("persistent execution capability rejection invalidates matching evidence without retry", async () => {
  const sends = vi.fn(async () => {
    throw { kind: "capability_rejection", parameter: "thinking", rejectedValue: "high", code: "INVALID_THINKING" };
  });
  const invalidated = vi.fn(() => Object.assign(new Error("Reconfigure with horsepower setup --interactive"), {
    code: "MODEL_CAPABILITY_REJECTED", status: "unsupported",
  }));
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); }, validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); }, createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "run-send" }), reportDispatchTerminal: async () => undefined,
    statusWorker: () => ({ model: "p/m", thinking: "high" }),
    sendWorker: sends,
    waitForMessage: async () => ({ status: "completed" }),
    messageStatus: () => "failed",
    handleWorkerCapabilityRejection: invalidated,
  });

  const error = await captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "c", cwd: "/p", workerId: "w", message: "work",
  }).catch((cause: unknown) => cause) as Error & { code?: string };

  expect(error).toMatchObject({ code: "MODEL_CAPABILITY_REJECTED" });
  expect(sends).toHaveBeenCalledTimes(1);
  expect(invalidated).toHaveBeenCalledWith({ model: "p/m", thinking: "high" }, expect.anything());
});

test("late persistent execution rejection invalidates evidence during tracked settlement", async () => {
  const rejection = { kind: "capability_rejection", parameter: "thinking", rejectedValue: "high", code: "INVALID_THINKING" };
  const invalidated = vi.fn(() => Object.assign(new Error("Reconfigure with horsepower setup --interactive"), {
    code: "MODEL_CAPABILITY_REJECTED", status: "unsupported",
  }));
  let tracked: Promise<unknown> | undefined;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); }, validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); }, createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "run-send" }), reportDispatchTerminal: async () => undefined,
    statusWorker: () => ({ model: "p/m", thinking: "high" }),
    sendWorker: async () => ({ messageId: "message-1" }),
    waitForMessage: async () => { throw rejection; },
    messageStatus: () => "failed",
    handleWorkerCapabilityRejection: invalidated,
    trackSettlement: (settlement) => { tracked = settlement; },
  });

  await captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "c", cwd: "/p", workerId: "w", message: "work",
  });
  const error = await tracked!.catch((cause: unknown) => cause) as Error & { code?: string };

  expect(error).toMatchObject({ code: "MODEL_CAPABILITY_REJECTED" });
  expect(invalidated).toHaveBeenCalledWith({ model: "p/m", thinking: "high" }, rejection);
});

test("settles create and persistent-send dispatch runs without creating extra work", async () => {
  const terminal: Array<{ runId: string; status: string; summary: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  let runNumber = 0;
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt.", tools: ["read"], recommendedSlots: [], standards: [] }),
    createWorker: async () => ({ workerId: "worker-1" }),
    beginDispatch: () => ({ runId: `run-${++runNumber}` }),
    reportDispatchTerminal: async (report) => { terminal.push(report); },
    sendWorker: async () => ({ messageId: "message-1", status: "running" }),
    waitForMessage: async () => ({ status: "completed", text: "done" }),
    messageStatus: () => "completed",
  });

  await captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "horsepower-alpha1", cwd: "/project",
    name: "reviewer-1", agent: "reviewer", modelSlot: "judgment",
  });
  await captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "horsepower-alpha1", cwd: "/project",
    workerId: "worker-1", message: "review", wait: false,
  });
  await new Promise((resolve) => setImmediate(resolve));

  expect(terminal).toEqual([
    { runId: "run-1", status: "completed", summary: "create completed" },
    { runId: "run-2", status: "completed", summary: "send completed" },
  ]);
});

test("reports failed create dispatch without spawning replacement work", async () => {
  const terminal: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt.", tools: [], recommendedSlots: [], standards: [] }),
    createWorker: async () => { throw new Error("startup failed"); },
    beginDispatch: () => ({ runId: "run-create" }),
    reportDispatchTerminal: async (report) => { terminal.push(report.status); },
  });

  await expect(captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "horsepower-alpha1", cwd: "/project",
    name: "reviewer-1", agent: "reviewer", modelSlot: "judgment",
  })).rejects.toThrow("startup failed");
  expect(terminal).toEqual(["failed"]);
});

test("reports nested missing fields with their full array path", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration, {
    action: "parallel", handoffMode: "managed",
    changeId: "horsepower-alpha1",
    cwd: "/project",
    tasks: [{ name: "reviewer-1", agent: "reviewer", modelSlot: "judgment" }],
  })).rejects.toThrow("$.tasks[0].task: required");
});

test("rejects invalid input before authorization or worker creation with a path-specific error", async () => {
  let calls = 0;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => { calls += 1; },
    resolveSlot: () => { calls += 1; throw new Error("should not resolve"); },
    validateModel: () => undefined,
    getAgent: () => { calls += 1; throw new Error("should not load"); },
    createWorker: async () => { calls += 1; return { workerId: "unexpected" }; },
    beginDispatch: () => { calls += 1; return { runId: "unexpected" }; },
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration, {
    action: "create", handoffMode: "inline",
    changeId: "horsepower-alpha1",
    cwd: "/project",
    name: "reviewer-1",
    agent: "reviewer",
  })).rejects.toThrow("$.modelSlot: required");
  expect(calls).toBe(0);
});
