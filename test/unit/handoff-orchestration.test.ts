import { expect, test } from "vitest";

function base(overrides: Record<string, unknown> = {}) {
  let effects = 0;
  return {
    effects: () => effects,
    options: {
      authorize: async () => { effects += 1; },
      resolveSlot: (slot: string) => ({ requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high" as const, fallbackPath: [slot], revision: "r" }),
      validateModel: () => undefined,
      getAgent: (name: string) => ({ name, role: name, prompt: "Prompt.", tools: [], recommendedSlots: [], standards: [] }),
      createWorker: async () => { effects += 1; return { workerId: "worker-1" }; },
      beginDispatch: () => { effects += 1; return { runId: "run-1" }; },
      reportDispatchTerminal: async () => undefined,
      ...overrides,
    },
  };
}

test("requires explicit handoff mode before authorization or side effects", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  for (const input of [
    { action: "single", changeId: "c", cwd: "/p", name: "n", agent: "a", modelSlot: "judgment", task: "t" },
    { action: "create", changeId: "c", cwd: "/p", name: "n", agent: "a", modelSlot: "judgment", brief: "b" },
    { action: "send", changeId: "c", cwd: "/p", workerId: "w", message: "m" },
  ]) {
    const fixture = base();
    await expect(createOrchestration(fixture.options as never).execute(input, { captain: true })).rejects.toThrow("$.handoffMode: required");
    expect(fixture.effects()).toBe(0);
  }
});

test("parallel and chain reject inline before side effects", async () => {
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  for (const action of ["parallel", "chain"]) {
    const fixture = base();
    await expect(createOrchestration(fixture.options as never).execute({ action, changeId: "c", cwd: "/p", handoffMode: "inline", tasks: [{ name: "n", agent: "a", modelSlot: "judgment", task: "t" }] }, { captain: true })).rejects.toThrow(`${action} requires managed handoff mode`);
    expect(fixture.effects()).toBe(0);
  }
});

test("managed one-shot creates brief before execution and requires report for success", async () => {
  const events: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const fixture = base({
    createHandoff: async ({ runId }: { runId: string }) => { events.push(`brief:${runId}`); return { worker: { briefPath: "/private/brief.md", reportPath: "/private/report.md" }, reference: { projectId: "opaque", runId } }; },
    oneShot: { single: async (input: { task: string }) => { events.push(`execute:${input.task}`); return { name: "n", text: "ignored full output" }; }, parallel: async () => [], chain: async () => [] },
    validateHandoffReport: async () => { events.push("report"); throw new Error("Managed report is missing"); },
    recordHandoffTerminal: async ({ status }: { status: string }) => { events.push(`terminal:${status}`); },
  });
  await expect(createOrchestration(fixture.options as never).execute({ action: "single", changeId: "c", cwd: "/p", handoffMode: "managed", name: "n", agent: "a", modelSlot: "judgment", task: "do work" }, { captain: true })).rejects.toThrow("Managed report is missing");
  expect(events[0]).toBe("brief:run-1");
  expect(events[1]).toContain("Read your assigned brief at /private/brief.md");
  expect(events).toContain("terminal:failed");
});

test("managed chain preserves the prior-output substitution point", async () => {
  let tasks: readonly { task: string }[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const fixture = base({
    createHandoff: async ({ runId }: { runId: string }) => ({ worker: { briefPath: `/private/${runId}/brief.md`, reportPath: `/private/${runId}/report.md` }, reference: {} }),
    validateHandoffReport: async ({ runId }: { runId: string }) => ({ runId, artifactId: "report" }),
    oneShot: { single: async () => ({ name: "", text: "" }), parallel: async () => [], chain: async (inputs: readonly { task: string }[]) => { tasks = inputs; return []; } },
  });
  await createOrchestration(fixture.options as never).execute({ action: "chain", handoffMode: "managed", changeId: "c", cwd: "/p", tasks: [{ name: "a", agent: "a", modelSlot: "judgment", task: "first" }, { name: "b", agent: "a", modelSlot: "judgment", task: "use {previous}" }] }, { captain: true });
  expect(tasks[1]!.task).toContain("{previous}");
});

test("inline one-shot retains direct task and creates no handoff", async () => {
  let task = ""; let handoffs = 0;
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const fixture = base({
    createHandoff: async () => { handoffs += 1; throw new Error("unused"); },
    oneShot: { single: async (input: { task: string }) => { task = input.task; return { name: "n", text: "done" }; }, parallel: async () => [], chain: async () => [] },
  });
  await createOrchestration(fixture.options as never).execute({ action: "single", changeId: "c", cwd: "/p", handoffMode: "inline", name: "n", agent: "a", modelSlot: "judgment", task: "direct" }, { captain: true });
  expect({ task, handoffs }).toEqual({ task: "direct", handoffs: 0 });
});
