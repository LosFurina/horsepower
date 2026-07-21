import { expect, test } from "vitest";

function orchestrationFixture() {
  const events: string[] = []; let run = 0; let reportRevision = 0;
  return import("../../src/orchestration/facade.js").then(({ createOrchestration }) => ({ events, orchestration: createOrchestration({
    authorize: async () => undefined,
    resolveSlot: () => { throw new Error("unused"); }, validateModel: () => undefined, getAgent: () => { throw new Error("unused"); },
    createWorker: async () => ({ workerId: "w" }), beginDispatch: () => ({ runId: `run-${++run}` }), reportDispatchTerminal: async ({ status }) => { events.push(`terminal:${status}`); },
    statusWorker: () => ({ workerId: "w", handoffMode: "managed", handoffRunId: "run-original" }),
    createHandoff: async ({ runId }) => { events.push(`create:${runId}`); return { worker: { briefPath: `/private/${runId}/brief.md`, reportPath: `/private/${runId}/report.md` }, reference: {} }; },
    prepareHandoffMessage: async ({ runId, brief }) => { events.push(`prepare:${runId}:${brief}`); reportRevision += 1; return { worker: { briefPath: `/private/${runId}/brief.md`, reportPath: `/private/${runId}/report.md` }, reportRevision }; },
    sendWorker: async ({ message }) => { events.push(`send:${message}`); return { messageId: "m", text: "raw worker output must stay private" }; }, waitForMessage: async () => ({ status: "completed", text: "raw final worker output" }), messageStatus: () => "completed",
    validateHandoffReport: async ({ runId, expectedRevision }) => { events.push(`validate:${runId}:${expectedRevision ?? 0}`); return { runId, artifactId: "report", sha256: "a".repeat(64), bytes: 8, mediaType: "text/markdown", summary: "bounded" }; }, recordHandoffTerminal: async () => undefined,
  }) }));
}

test("managed create requires a Captain brief and validated initial report", async () => {
  const events: string[] = [];
  const { createOrchestration } = await import("../../src/orchestration/facade.js");
  const options = {
    authorize: async () => undefined,
    resolveSlot: (slot: string) => ({ requestedSlot: slot, resolvedSlot: slot, model: "p/m", thinking: "high" as const, fallbackPath: [slot], revision: "r" }), validateModel: () => undefined,
    getAgent: (name: string) => ({ name, role: name, prompt: "Prompt", tools: [], recommendedSlots: [], standards: [] }),
    beginDispatch: () => ({ runId: "run-create" }), reportDispatchTerminal: async ({ status }: { status: string }) => { events.push(`terminal:${status}`); },
    createHandoff: async () => ({ worker: { briefPath: "/private/brief.md", reportPath: "/private/report.md" }, reference: { runId: "run-create" } }),
    createWorker: async ({ initialMessage }: { initialMessage?: string }) => { events.push(`create:${initialMessage}`); return { workerId: "w", activeMessageId: "initial" }; },
    waitForMessage: async () => { events.push("wait"); return { status: "completed" }; },
    validateHandoffReport: async () => { events.push("validate"); return { artifactId: "report" }; }, recordHandoffTerminal: async () => undefined,
  };
  await expect(createOrchestration(options as never).execute({ action: "create", handoffMode: "managed", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "judgment" }, { captain: true })).rejects.toThrow("$.brief: required for managed create");
  await createOrchestration(options as never).execute({ action: "create", handoffMode: "managed", changeId: "c", cwd: "/p", name: "w", agent: "a", modelSlot: "judgment", brief: "do work" }, { captain: true });
  expect(events).toEqual(["create:Read your assigned brief at /private/brief.md. Write the completed report to /private/report.md.", "wait", "validate", "terminal:completed"]);
});

test("managed substantive send creates message evidence and requires report", async () => {
  const { orchestration, events } = await orchestrationFixture();
  await orchestration.execute({ action: "send", handoffMode: "managed", changeId: "c", cwd: "/p", workerId: "w", message: "work", wait: true }, { captain: true });
  expect(events).toEqual(["create:run-1", "send:Read your assigned brief at /private/run-1/brief.md. Write the completed report to /private/run-1/report.md.", "validate:run-1:0", "terminal:completed"]);
});

test("managed followUp refreshes evidence in the associated workspace while steer creates none", async () => {
  const { orchestration, events } = await orchestrationFixture();
  const result = await orchestration.execute({ action: "send", handoffMode: "managed", changeId: "c", cwd: "/p", workerId: "w", message: "more", delivery: "followUp", wait: true }, { captain: true });
  expect(events).not.toContain("create:run-1");
  expect(events).toContain("prepare:run-original:more");
  expect(events).toContain("send:Read your assigned brief at /private/run-original/brief.md. Write the completed report to /private/run-original/report.md.");
  expect(events).toContain("validate:run-original:1");
  expect(JSON.stringify(result)).not.toContain("raw final worker output");
  expect(JSON.stringify(result)).not.toContain("raw worker output must stay private");
  expect(result).toEqual({ runId: "run-1", result: { handoff: expect.objectContaining({ artifactId: "report", summary: "bounded" }) } });
  events.splice(0);
  await orchestration.execute({ action: "steer", changeId: "c", cwd: "/p", workerId: "w", message: "change", wait: true }, { captain: true });
  expect(events.some((event) => event.startsWith("create:") || event.startsWith("validate:"))).toBe(false);
});
