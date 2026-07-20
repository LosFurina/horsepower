import { expect, test } from "vitest";
import type { OneShotInvocation, OneShotResult } from "../../src/runtime/one-shot.js";

function setup(run?: (invocation: OneShotInvocation) => Promise<OneShotResult>) {
  return import("../../src/runtime/one-shot.js").then(({ createOneShotExecutor }) =>
    createOneShotExecutor({
      run: run ?? (async (invocation) => ({
        name: invocation.name,
        text: `result:${invocation.task}`,
        usage: { input: 1, output: 2 },
      })),
    })
  );
}

const task = {
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

test("runs one explicitly requested task", async () => {
  const executor = await setup();

  await expect(executor.single(task)).resolves.toEqual({
    name: "review",
    text: "result:Review the change",
    displayText: "result:Review the change",
    usage: { input: 1, output: 2 },
  });
});

test("preflights every parallel and chain slot before running any task", async () => {
  let runs = 0;
  const executor = await setup(async (invocation) => {
    runs += 1;
    return { name: invocation.name, text: "done" };
  });

  await expect(executor.parallel([
    { ...task, name: "valid" },
    { ...task, name: "invalid", modelSlot: "" },
  ])).rejects.toThrow("One-shot modelSlot is required for invalid");
  await expect(executor.chain([
    { ...task, name: "valid" },
    { ...task, name: "invalid", modelSlot: "" },
  ])).rejects.toThrow("One-shot modelSlot is required for invalid");
  expect(runs).toBe(0);
});

test("runs parallel input with at most four children and rejects more than eight tasks", async () => {
  let active = 0;
  let maximum = 0;
  const executor = await setup(async (invocation) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return { name: invocation.name, text: invocation.name };
  });
  const tasks = Array.from({ length: 8 }, (_, index) => ({ ...task, name: `task-${index}` }));

  const results = await executor.parallel(tasks);

  expect(results.map((result) => result.name)).toEqual(tasks.map(({ name }) => name));
  expect(maximum).toBe(4);
  await expect(executor.parallel([...tasks, { ...task, name: "ninth" }]))
    .rejects.toThrow("Parallel one-shot accepts at most 8 tasks");
});

test("substitutes previous chain output and stops after the first failure", async () => {
  const seen: string[] = [];
  const executor = await setup(async (invocation) => {
    seen.push(invocation.task);
    if (invocation.name === "fail") throw new Error("chain failed");
    return { name: invocation.name, text: `out:${invocation.name}` };
  });

  await expect(executor.chain([
    { ...task, name: "first", task: "start" },
    { ...task, name: "fail", task: "use {previous}" },
    { ...task, name: "never", task: "do not run" },
  ])).rejects.toThrow("chain failed");
  expect(seen).toEqual(["start", "use out:first"]);
});

test("caps displayed UTF-8 output while preserving the full structured result", async () => {
  const text = "你".repeat(20_000);
  const executor = await setup(async (invocation) => ({ name: invocation.name, text }));

  const result = await executor.single(task);

  expect(result.text).toBe(text);
  expect(Buffer.byteLength(result.displayText!, "utf8")).toBeLessThanOrEqual(50 * 1024);
  expect(result.displayText).toContain("output omitted");
  expect(result.displayText).not.toContain("�");
});
