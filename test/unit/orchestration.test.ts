import { Check } from "typebox/value";
import { expect, test, vi } from "vitest";

const genericId = (...parts: string[]) => parts.join("/");

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
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Review.", tools: [], standards: [] }),
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
  await expect(orchestration.execute({ action: "begin_review_campaign", changeId: "change-a", cwd: "/project", implementationCampaignId: "implementation-1", taskScope: "5.3,5.4", acceptanceScope: "task", budget: 1 }, { captain: false }))
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
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("unknown", "model"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: (slot) => { throw new Error(`Unknown model: ${slot.model}`); },
    getAgent: (name) => ({ name, role: name, prompt: "Prompt.", tools: [], standards: [] }),
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
    resolveSlot: (slot) => { calls.push("resolve"); return { requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "slot-r" }; },
    validateModel: () => { calls.push("catalog"); },
    validateCapability: async () => { calls.push("gate"); throw Object.assign(new Error(status), { status }); },
    getAgent: () => { calls.push("agent"); return { name: "a", role: "a", prompt: "Prompt", tools: [], standards: [] }; },
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
    resolveSlot: (slot) => { calls.push(`resolve:${slot}`); return { requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "slot-r" }; },
    validateModel: () => { calls.push("catalog"); },
    validateCapability: async (slot) => { calls.push(`gate:${slot.requestedSlot}`); if (slot.requestedSlot === "craft") throw new Error("unsupported"); },
    getAgent: (name) => { calls.push(`agent:${name}`); return { name, role: name, prompt: "Prompt", tools: [], standards: [] }; },
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
  const configured = { model: genericId("p", "m"), thinking: "high" as const };
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
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async (input) => { attempts.push({ model: input.model, thinking: input.thinking }); throw rejection; },
    beginDispatch: () => ({ runId: "run" }),
    reportDispatchTerminal: async () => undefined,
  });

  const error = await captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "judgment",
  });

  expect(error).toMatchObject({ status: "failed", failure: { stage: "worker", code: "MODEL_CAPABILITY_REJECTED" } });
  expect(attempts).toEqual([{ model: genericId("p", "m"), thinking: "high" }]);
  expect(invalidated).toHaveBeenCalledTimes(1);
  expect(configured).toEqual({ model: genericId("p", "m"), thinking: "high" });
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
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", slot), thinking: "high", fallbackPath: [slot], revision: "slot-r" }),
    validateModel: () => undefined, validateCapability: async () => undefined,
    handleWorkerCapabilityRejection: invalidated,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], standards: [] }),
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
  });

  expect(error).toMatchObject({ status: "failed", failure: { stage: "worker", code: "MODEL_CAPABILITY_REJECTED" } });
  expect(attempts).toEqual([[{ model: genericId("p", "judgment"), thinking: "high" }, { model: genericId("p", "craft"), thinking: "high" }]]);
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
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "xhigh", fallbackPath: [slot], revision: "slot-r" }),
    validateModel: () => undefined,
    validateCapability: async () => undefined,
    handleWorkerCapabilityRejection: invalidated,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], standards: [] }),
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
  });

  expect(error).toMatchObject({ status: "failed", failure: { stage: "worker", code: "MODEL_CAPABILITY_REJECTED" } });
  expect(attempts).toEqual([{ model: genericId("p", "m"), thinking: "xhigh" }]);
  expect(invalidated).toHaveBeenCalledTimes(1);
});

test("authorizes and executes exactly one explicitly requested persistent creation", async () => {
  const calls: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js").catch(() => ({
    createOrchestration: undefined,
  }));
  const orchestration = createOrchestration?.({
    authorize: async () => { calls.push("authorize"); },
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("provider", "model"), thinking: "high", fallbackPath: [slot], revision: "rev" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Review", prompt: "Review.", tools: ["read"], standards: [] }),
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

test("pre-aborted one-shot returns canceled before authorization, accounting, run, handoff, or spawn", async () => {
  const calls: string[] = [];
  const controller = new AbortController(); controller.abort("captain turn canceled");
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => { calls.push("authorize"); },
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => { calls.push("model"); },
    getAgent: (name) => ({ name, role: "Review", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => { calls.push("worker"); return { workerId: "unused" }; },
    oneShot: { single: async () => { calls.push("spawn"); return { name: "review", text: "unused" }; }, parallel: async () => [], chain: async () => [] },
    beginDispatch: () => { calls.push("run"); return { runId: "unused" }; },
    createHandoff: async () => { calls.push("handoff"); throw new Error("unused"); },
    consumeReviewCampaign: () => { calls.push("budget"); return {} as never; },
    reportDispatchTerminal: async () => { calls.push("terminal"); },
    signal: controller.signal,
  });

  await expect(captain(orchestration, {
    action: "single", handoffMode: "managed", changeId: "c", cwd: "/p", name: "review", agent: "reviewer", modelSlot: "judgment", task: "review", reviewCampaignId: "review-campaign",
  })).resolves.toEqual({
    status: "canceled", action: "single",
    failure: { stage: "preflight", code: "DISPATCH_CANCELED", boundary: "cancellation", message: "Dispatch canceled before authorization", remediation: "Start a new Captain turn and retry the explicit dispatch." },
  });
  expect(calls).toEqual([]);
});

test("emits immutable complete identity with requested-to-resolved fallback and terminal progress", async () => {
  const progress: Array<Record<string, unknown>> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: "judgment", model: genericId("provider", "model"), thinking: "xhigh", fallbackPath: [slot, "judgment"], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Implement a narrowly specified change", prompt: "Prompt", tools: ["read"], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async (input) => { input.onProgress?.({ type: "tool_start", toolName: "read", toolCallId: "call-1", operation: "read", target: "src/index.ts" }); return { name: input.name, text: "done" }; }, parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: "run-identity" }),
    reportDispatchTerminal: async () => undefined,
    onProgress: (event) => { progress.push(event); },
  });

  await captain(orchestration, {
    action: "single", handoffMode: "inline", changeId: "c", cwd: "/p", name: "inventory", agent: "coder", modelSlot: "context", task: "work",
  });

  expect(progress.map((event) => event.type)).toEqual(["accepted", "tool_start", "completed"]);
  expect(progress[0]).toMatchObject({
    identity: {
      name: "inventory", agent: "coder", role: "Implement a narrowly specified change",
      requestedSlot: "context", resolvedSlot: "judgment", model: "provider/model", thinking: "xhigh",
      handoffMode: "inline", invocationId: "run-identity-1", runId: "run-identity",
    },
  });
  expect(Object.isFrozen(progress[0]!.identity)).toBe(true);
});

test("during-run abort returns canceled and terminalizes created managed handoffs as canceled", async () => {
  const controller = new AbortController();
  const handoffTerminals: string[] = []; const dispatchTerminals: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Review", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async () => { controller.abort("captain turn canceled"); throw new Error("One-shot task aborted"); }, parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: "run-canceled" }), signal: controller.signal,
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } }),
    recordHandoffTerminal: async ({ status }) => { handoffTerminals.push(status); },
    reportDispatchTerminal: async ({ status }) => { dispatchTerminals.push(status); },
  });

  await expect(captain(orchestration, {
    action: "single", handoffMode: "managed", changeId: "c", cwd: "/p", name: "review", agent: "reviewer", modelSlot: "judgment", task: "review",
  })).resolves.toMatchObject({
    status: "canceled", runId: "run-canceled",
    failure: { stage: "worker", code: "DISPATCH_CANCELED", boundary: "cancellation", message: "Dispatch canceled during worker execution" },
  });
  expect(handoffTerminals).toEqual(["canceled"]);
  expect(dispatchTerminals).toEqual(["canceled"]);
});

test("external Captain abort cancels an admitted slow managed one-shot without report or orphan", async () => {
  const controller = new AbortController();
  let admitted!: () => void;
  const admittedPromise = new Promise<void>((resolve) => { admitted = resolve; });
  let activeChildren = 0;
  const handoffTerminals: Array<{ runId: string; status: string; reportPresent: boolean }> = [];
  const dispatchTerminals: Array<{ runId: string; status: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Review", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: {
      single: async (input) => {
        activeChildren += 1;
        admitted();
        try {
          await new Promise<never>((_resolve, reject) => {
            const abort = () => reject(new Error("One-shot task aborted"));
            input.signal?.addEventListener("abort", abort, { once: true });
            if (input.signal?.aborted) abort();
          });
        } finally {
          activeChildren -= 1;
        }
        throw new Error("unreachable");
      },
      parallel: async () => [], chain: async () => [],
    },
    beginDispatch: () => ({ runId: "run-external-esc" }), signal: controller.signal,
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } }),
    recordHandoffTerminal: async ({ runId, status }) => {
      handoffTerminals.push({ runId, status, reportPresent: false });
      return { status, reportPresent: false };
    },
    reportDispatchTerminal: async ({ runId, status }) => {
      if (dispatchTerminals.length) throw new Error("Run is already terminal");
      dispatchTerminals.push({ runId, status });
    },
  });

  const running = captain(orchestration, {
    action: "single", handoffMode: "managed", changeId: "c", cwd: "/p", name: "review", agent: "reviewer", modelSlot: "judgment", task: "review",
  });
  await admittedPromise;
  expect(activeChildren).toBe(1);
  controller.abort("Esc");

  await expect(running).resolves.toMatchObject({
    status: "canceled", runId: "run-external-esc",
    identities: [{ invocationId: "run-external-esc-1", runId: "run-external-esc" }],
    failure: { code: "DISPATCH_CANCELED", boundary: "cancellation" },
  });
  expect(activeChildren).toBe(0);
  expect(handoffTerminals).toEqual([{ runId: "run-external-esc", status: "canceled", reportPresent: false }]);
  expect(dispatchTerminals).toEqual([{ runId: "run-external-esc", status: "canceled" }]);
});

test("orchestration progress callback failure cannot change worker completion", async () => {
  const terminals: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Implement", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async (input) => ({ name: input.name, text: "done" }), parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: "run-progress-error" }),
    reportDispatchTerminal: async ({ status }) => { terminals.push(status); },
    onProgress: () => { throw new Error("TUI update failed"); },
  });

  await expect(captain(orchestration, {
    action: "single", handoffMode: "inline", changeId: "c", cwd: "/p", name: "work", agent: "coder", modelSlot: "craft", task: "work",
  })).resolves.toMatchObject({ status: "completed", runId: "run-progress-error" });
  expect(terminals).toEqual(["completed"]);
});

test("dispatches exactly the explicit parallel tasks and reports terminal lifecycle", async () => {
  const dispatched: string[] = [];
  const terminal: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: `${name}.`, tools: ["read"], standards: [] }),
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
      { requestedSlot: "judgment", resolvedSlot: "judgment", model: genericId("p", "m"), thinking: "high", fallbackPath: ["judgment"] },
      { requestedSlot: "craft", resolvedSlot: "craft", model: genericId("p", "m"), thinking: "high", fallbackPath: ["craft"] },
    ],
  });
});

test("parallel batch failure preserves completed and failed child terminal truth", async () => {
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
      { status: "fulfilled", value: { name: "a", text: "done" } }, { status: "rejected", reason: new Error("b failed") },
    ]); }, chain: async () => [] },
    beginDispatch: () => ({ runId: "run-batch-truth" }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } }),
    validateHandoffReport: async ({ runId }) => ({ runId, artifactId: "report" }),
    recordHandoffTerminal: async ({ runId, status }) => { handoffTerminals.push({ runId, status }); },
    reportDispatchTerminal: async () => undefined,
    onProgress: (event) => { progress.push(event); },
  });

  await expect(captain(orchestration, { action: "parallel", handoffMode: "managed", changeId: "c", cwd: "/p", tasks: [
    { name: "a", agent: "reviewer", modelSlot: "craft", task: "a" }, { name: "b", agent: "reviewer", modelSlot: "craft", task: "b" },
  ] })).resolves.toMatchObject({ status: "failed", failure: { message: "b failed" } });
  const childTerminal = progress.filter((event) => ["completed", "failed", "canceled"].includes(String(event.type)));
  expect(childTerminal).toMatchObject([
    { type: "completed", identity: { name: "a" } }, { type: "failed", identity: { name: "b" }, summary: "b failed" },
  ]);
  expect(handoffTerminals).toEqual([{ runId: "run-batch-truth-2", status: "failed" }]);
});

test("terminalizes only managed handoffs that were created before parallel handoff setup failed", async () => {
  const handoffs: string[] = [];
  const terminals: Array<{ runId: string; status: string }> = [];
  const dispatchTerminals: Array<{ status: string; summary: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async () => ({ name: "unused", text: "unused" }), parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: "run-partial" }),
    createHandoff: async ({ runId }) => {
      if (runId.endsWith("-2")) throw new Error("second handoff failed");
      handoffs.push(runId);
      return { worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } };
    },
    recordHandoffTerminal: async ({ runId, status }) => { terminals.push({ runId, status }); },
    reportDispatchTerminal: async ({ status, summary }) => { dispatchTerminals.push({ status, summary }); },
  });

  await expect(captain(orchestration, {
    action: "parallel", handoffMode: "managed", changeId: "c", cwd: "/p", tasks: [
      { name: "one", agent: "a", modelSlot: "judgment", task: "one" },
      { name: "two", agent: "a", modelSlot: "craft", task: "two" },
    ],
  })).resolves.toMatchObject({
    status: "failed", action: "parallel", runId: "run-partial",
    failure: { stage: "handoff", message: "second handoff failed" },
  });
  expect(handoffs).toEqual(["run-partial-1"]);
  expect(terminals).toEqual([{ runId: "run-partial-1", status: "failed" }]);
  expect(dispatchTerminals).toEqual([{ status: "failed", summary: "parallel failed at handoff: second handoff failed" }]);
});

test.each([
  ["worker", async () => { throw new Error("spawn failed"); }],
  ["handoff_report", async () => ({ name: "one", text: "done" })],
] as const)("returns structured failure and terminalizes managed one-shot on %s failure", async (expectedStage, executeSingle) => {
  const terminals: Array<{ runId: string; status: string }> = [];
  const dispatchTerminals: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Implement", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: executeSingle, parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: `run-${expectedStage}` }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } }),
    validateHandoffReport: async () => { throw new Error("Managed report is missing"); },
    recordHandoffTerminal: async ({ runId, status }) => { terminals.push({ runId, status }); },
    reportDispatchTerminal: async ({ status }) => { dispatchTerminals.push(status); },
  });

  const result = await captain(orchestration, {
    action: "single", handoffMode: "managed", changeId: "c", cwd: "/p", name: "one", agent: "a", modelSlot: "craft", task: "work",
  });

  expect(result).toMatchObject({ status: "failed", action: "single", failure: { stage: expectedStage } });
  expect(terminals).toEqual([{ runId: `run-${expectedStage}`, status: "failed" }]);
  expect(dispatchTerminals).toEqual(["failed"]);
});

test("preserves primary managed failure when handoff terminalization also fails", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Implement", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    oneShot: { single: async () => { throw new Error("worker primary"); }, parallel: async () => [], chain: async () => [] },
    beginDispatch: () => ({ runId: "run-cleanup" }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } }),
    recordHandoffTerminal: async () => { throw new Error("terminal write failed"); },
    reportDispatchTerminal: async () => undefined,
  });

  await expect(captain(orchestration, {
    action: "single", handoffMode: "managed", changeId: "c", cwd: "/p", name: "one", agent: "a", modelSlot: "craft", task: "work",
  })).resolves.toMatchObject({
    status: "failed", failure: { stage: "worker", message: "worker primary" },
    cleanupFailures: [{ runId: "run-cleanup", message: "terminal write failed" }],
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

test("structured list returns empty and populated persistent workers without one-shot children", async () => {
  let listed: unknown[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); },
    validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); },
    createWorker: async () => { throw new Error("create must not run for list"); },
    beginDispatch: () => { throw new Error("dispatch must not run for list"); },
    reportDispatchTerminal: async () => undefined,
    listWorkers: () => listed,
  });

  await expect(captain(orchestration, { action: "list", cwd: "/project" })).resolves.toEqual([]);
  listed = [{ workerId: "persistent-1", name: "coder-a", status: "idle" }];
  await expect(captain(orchestration, { action: "list", cwd: "/project" }))
    .resolves.toEqual([{ workerId: "persistent-1", name: "coder-a", status: "idle" }]);
  // one-shot single/parallel/chain children are outside listWorkers and must not be fabricated here
  expect(JSON.stringify(await captain(orchestration, { action: "list", cwd: "/project" })))
    .not.toMatch(/\b(single|parallel|chain)\b/);
});

test("Captain terminal reporting uses claim-matched verification without creating work", async () => {
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
    verification: {
      observedAt: "2026-07-21T12:00:00.000Z",
      commands: [{ id: "e2e-1", kind: "e2e", command: "npm run e2e", exitCode: 0, summary: "passed", acceptanceRefs: ["task:1.1"] }],
      acceptance: [{ ref: "task:1.1", evidenceIds: ["e2e-1"] }],
    },
  });

  expect(report).toMatchObject({ runId: "run-change", status: "completed", verification: { commands: [{ id: "e2e-1", exitCode: 0 }] } });
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

test("managed persistent create acknowledges admission without invoking its completion waiter", async () => {
  let messageStatus: "running" | "completed" = "running";
  let tracked: Promise<unknown> | undefined;
  let waiterCalls = 0;
  const terminal: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt", tools: [], standards: [] }),
    beginDispatch: () => ({ runId: "run-create-async" }),
    createHandoff: async () => ({ worker: { briefPath: "/private/brief", reportPath: "/private/report" }, reference: { stable: true } }),
    createWorker: async () => ({ workerId: "worker-async", activeMessageId: "message-initial", initialMessageId: "message-initial" }),
    waitForMessage: async () => { waiterCalls += 1; throw new Error("completion waiter must not be invoked"); },
    messageStatus: () => messageStatus,
    validateHandoffReport: async () => ({ artifactId: "report" }),
    reportDispatchTerminal: async ({ status }) => { terminal.push(status); },
    trackSettlement: (settlement) => { tracked = settlement; },
  });
  const result = await captain(orchestration, { action: "create", handoffMode: "managed", changeId: "c", cwd: "/p", name: "worker", agent: "coder", modelSlot: "judgment", brief: "work" });
  expect(result).toMatchObject({ workerId: "worker-async", initialMessageId: "message-initial", runId: "run-create-async", handoff: { stable: true } });
  expect(waiterCalls).toBe(0);
  expect(terminal).toEqual([]);
  expect(tracked).toBeDefined();
  messageStatus = "completed";
  await tracked;
  expect(terminal).toEqual(["completed"]);
});

test.each(["send", "steer"] as const)("%s wait false acknowledges stable message identity without invoking completion waiter", async (action) => {
  let messageStatus: "running" | "completed" = "running";
  let waiterCalls = 0;
  let tracked: Promise<unknown> | undefined;
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
    sendWorker: async (input) => ({ accepted: true, workerId: String(input.workerId), messageId: "message-1", status: "running" }),
    waitForMessage: async () => { waiterCalls += 1; throw new Error("completion waiter must not be invoked"); },
    messageStatus: () => messageStatus,
    trackSettlement: (settlement) => { tracked = settlement; },
  });

  const dispatch = await captain(orchestration, {
    action, ...(action === "send" ? { handoffMode: "inline" as const } : {}),
    changeId: "x", cwd: "/project", workerId: "w", message: "m", wait: false, timeoutMs: 2,
  });
  expect(dispatch).toMatchObject({ status: "accepted", runId: "run-send", result: { messageId: "message-1" } });
  expect(waiterCalls).toBe(0);
  expect(terminal).toEqual([]);
  expect(tracked).toBeDefined();
  messageStatus = "completed";
  await tracked;
  expect(terminal).toEqual(["completed"]);
});

test("persistent send projects attributed accepted and completed telemetry without changing settlement", async () => {
  let status: "running" | "completed" = "running";
  let tracked: Promise<unknown> | undefined;
  const progress: Array<Record<string, unknown>> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); }, validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Implement", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => ({ workerId: "unused" }),
    beginDispatch: () => ({ runId: "run-persistent-card" }), reportDispatchTerminal: async () => undefined,
    sendWorker: async () => ({ accepted: true, workerId: "worker-1", messageId: "message-1", status: "running" }),
    waitForMessage: async () => { throw new Error("not used"); },
    messageStatus: () => status,
    statusWorker: () => ({
      workerId: "worker-1", name: "session", agent: "coder", role: "Implement", modelSlot: "context", resolvedSlot: "judgment",
      model: "provider/model", thinking: "high", handoffMode: "inline", telemetry: status === "running"
        ? { elapsedMs: 10 }
        : { elapsedMs: 20, usage: { input: 5, output: 2 }, latestAssistantSummary: "done" },
    }),
    onProgress: (event) => progress.push(event as unknown as Record<string, unknown>),
    trackSettlement: (settlement) => { tracked = settlement; },
  });

  await expect(captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "c", cwd: "/p", workerId: "worker-1", message: "work", wait: false,
  })).resolves.toMatchObject({ status: "accepted", runId: "run-persistent-card" });
  expect(progress).toMatchObject([{ type: "accepted", identity: {
    name: "session", agent: "coder", role: "Implement", requestedSlot: "context", resolvedSlot: "judgment",
    model: "provider/model", thinking: "high", invocationId: "run-persistent-card-1", runId: "run-persistent-card",
  }, telemetry: { elapsedMs: 10 } }]);
  status = "completed";
  await tracked;
  expect(progress.at(-1)).toMatchObject({ type: "completed", telemetry: { elapsedMs: 20, usage: { input: 5, output: 2 }, latestAssistantSummary: "done" } });
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
  })).resolves.toMatchObject({ status: "canceled", failure: { stage: "worker", message: "canceled" } });
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
    statusWorker: () => ({ model: genericId("p", "m"), thinking: "high" }),
    sendWorker: sends,
    waitForMessage: async () => ({ status: "completed" }),
    messageStatus: () => "failed",
    handleWorkerCapabilityRejection: invalidated,
  });

  const error = await captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "c", cwd: "/p", workerId: "w", message: "work",
  });

  expect(error).toMatchObject({ status: "failed", failure: { stage: "worker", code: "MODEL_CAPABILITY_REJECTED" } });
  expect(sends).toHaveBeenCalledTimes(1);
  expect(invalidated).toHaveBeenCalledWith({ model: genericId("p", "m"), thinking: "high" }, expect.anything());
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
    statusWorker: () => ({ model: genericId("p", "m"), thinking: "high" }),
    sendWorker: async () => ({ messageId: "message-1" }),
    waitForMessage: async () => { throw rejection; },
    messageStatus: () => "failed",
    handleWorkerCapabilityRejection: invalidated,
    trackSettlement: (settlement) => { tracked = settlement; },
  });

  await captain(orchestration, {
    action: "send", handoffMode: "inline", changeId: "c", cwd: "/p", workerId: "w", message: "work",
  });
  const error = await tracked!;

  expect(error).toMatchObject({ status: "failed", failure: { stage: "worker", code: "MODEL_CAPABILITY_REJECTED" } });
  expect(invalidated).toHaveBeenCalledWith({ model: genericId("p", "m"), thinking: "high" }, rejection);
});

test("settles create and persistent-send dispatch runs without creating extra work", async () => {
  const terminal: Array<{ runId: string; status: string; summary: string }> = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  let runNumber = 0;
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt.", tools: ["read"], standards: [] }),
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

test("managed persistent create terminalizes its created handoff when worker startup fails", async () => {
  const handoffTerminals: Array<{ runId: string; status: string }> = [];
  const dispatchTerminals: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: "Implement", prompt: "Prompt", tools: [], standards: [] }),
    createWorker: async () => { throw new Error("spawn failed"); },
    beginDispatch: () => ({ runId: "run-managed-create" }),
    createHandoff: async ({ runId }) => ({ worker: { briefPath: `/private/${runId}/brief`, reportPath: `/private/${runId}/report` }, reference: { runId } }),
    recordHandoffTerminal: async ({ runId, status }) => { handoffTerminals.push({ runId, status }); },
    reportDispatchTerminal: async ({ status }) => { dispatchTerminals.push(status); },
  });

  await expect(captain(orchestration, {
    action: "create", handoffMode: "managed", changeId: "c", cwd: "/p", name: "worker", agent: "coder", modelSlot: "craft", brief: "work",
  })).resolves.toMatchObject({ status: "failed", action: "create", runId: "run-managed-create", failure: { stage: "worker", message: "spawn failed" } });
  expect(handoffTerminals).toEqual([{ runId: "run-managed-create", status: "failed" }]);
  expect(dispatchTerminals).toEqual(["failed"]);
});

test("reports failed create dispatch without spawning replacement work", async () => {
  const terminal: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined,
    resolveSlot: (slot) => ({ requestedSlot: slot, resolvedSlot: slot, model: genericId("p", "m"), thinking: "high", fallbackPath: [slot], revision: "r" }),
    validateModel: () => undefined,
    getAgent: (name) => ({ name, role: name, prompt: "Prompt.", tools: [], standards: [] }),
    createWorker: async () => { throw new Error("startup failed"); },
    beginDispatch: () => ({ runId: "run-create" }),
    reportDispatchTerminal: async (report) => { terminal.push(report.status); },
  });

  await expect(captain(orchestration, {
    action: "create", handoffMode: "inline", changeId: "horsepower-alpha1", cwd: "/project",
    name: "reviewer-1", agent: "reviewer", modelSlot: "judgment",
  })).resolves.toMatchObject({ status: "failed", failure: { stage: "worker", message: "startup failed" } });
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

test("legacy completion payload fails closed with actionable replacement shape before runtime mutation", async () => {
  const report = vi.fn();
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const orchestration = createOrchestration({
    authorize: async () => undefined, resolveSlot: () => { throw new Error("unused"); }, validateModel: () => undefined,
    getAgent: () => { throw new Error("unused"); }, createWorker: async () => ({ workerId: "unused" }), beginDispatch: () => ({ runId: "unused" }),
    reportDispatchTerminal: async () => undefined, reportChangeTerminal: report,
  });
  await expect(captain(orchestration, { action: "report_terminal", cwd: "/project", changeId: "change-a", runId: "run-1", status: "completed", summary: "legacy", e2e: [{ command: "npm run test:e2e", exitCode: 0, summary: "passed" }] }))
    .rejects.toThrow(/VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED.*verification.*observedAt.*commands.*acceptance/);
  expect(report).not.toHaveBeenCalled();
});
