import { expect, test } from "vitest";
import { createParallelCardProjection } from "../../src/extension/parallel-card.js";
import type { WorkerIdentity } from "../../src/runtime/one-shot.js";

const fixtureModel = (index: number) => ["fixture-provider", `fixture-model-${index}`].join("/");
const identity = (index: number): WorkerIdentity => ({
  name: `task-${index}`, agent: "coder", role: "Implement", requestedSlot: "craft", resolvedSlot: index === 2 ? "utility" : "craft",
  model: fixtureModel(index), thinking: "high", handoffMode: "managed", invocationId: `inv-${index}`, runId: `run-${index}`,
});

test.each([2, 8])("retains %i children in accepted order across interleaving", (count) => {
  const card = createParallelCardProjection("en");
  const identities = Array.from({ length: count }, (_, index) => identity(index + 1));
  identities.forEach((item) => card.reduce({ type: "accepted", identity: item }));
  [...identities].reverse().forEach((item, index) => card.reduce({ type: "tool_update", identity: item, toolName: "read", toolCallId: `c-${index}`, operation: `op-${item.invocationId}`, telemetry: { elapsedMs: index + 1 } }));
  const snapshot = card.snapshot();
  expect(snapshot.details.parallel.children.map((child) => child.identity.invocationId)).toEqual(identities.map((item) => item.invocationId));
  expect(snapshot.details.parallel.children.map((child) => child.operation)).toEqual(identities.map((item) => `op-${item.invocationId}`));
  expect(snapshot.details.parallel.total).toBe(count);
});

test.each([["en", "Parallel"], ["zh-CN", "并行"]] as const)("renders complete bounded %s cards", (locale, label) => {
  const card = createParallelCardProjection(locale);
  card.reduce({ type: "accepted", identity: identity(2) });
  card.reduce({ type: "assistant", identity: identity(2), summary: "safe summary", telemetry: { elapsedMs: 1250, usage: { input: 7, output: 3 }, latestAssistantSummary: "latest utterance" } });
  const snapshot = card.snapshot();
  expect(snapshot.content[0]!.text).toContain(label);
  for (const value of ["task-2", "coder", "Implement", "craft→utility", fixtureModel(2), "thinking=high", "managed", "inv-2", "run-2", "1250", "7", "3", "latest utterance"]) expect(snapshot.content[0]!.text).toContain(value);
  expect(snapshot.details.parallel.children[0]!).toMatchObject({ status: "running", operation: "assistant", telemetry: { elapsedMs: 1250, usage: { input: 7, output: 3 }, latestAssistantSummary: "latest utterance" } });
});

test("accepts one authoritative run ID enrichment after admission and rejects later changes", () => {
  const card = createParallelCardProjection("en");
  const { runId: _runId, ...admitted } = identity(1);
  card.reduce({ type: "accepted", identity: admitted });
  expect(card.reduce({ type: "starting", identity: { ...admitted, runId: "run-authoritative" } })).toBe(true);
  expect(card.snapshot().details.parallel.children[0]).toMatchObject({
    identity: { invocationId: "inv-1", runId: "run-authoritative" },
    status: "running",
  });
  expect(card.reduce({ type: "assistant", identity: { ...admitted, runId: "run-conflict" }, summary: "must be ignored" })).toBe(false);
  expect(card.snapshot().details.parallel.children[0]!.identity.runId).toBe("run-authoritative");
});

test("derives mixed terminal counts and freezes first terminal presentation", () => {
  const card = createParallelCardProjection("en");
  [1, 2, 3, 4].forEach((i) => card.reduce({ type: "accepted", identity: identity(i) }));
  card.reduce({ type: "completed", identity: identity(1), telemetry: { elapsedMs: 10 } });
  card.reduce({ type: "failed", identity: identity(2), stage: "worker", summary: "failed safely" });
  card.reduce({ type: "canceled", identity: identity(3), summary: "stopped" });
  card.reduce({ type: "starting", identity: identity(1), telemetry: { elapsedMs: 999 } });
  card.reduce({ type: "tool_update", identity: identity(4), toolName: "write", toolCallId: "c", operation: "write" });
  expect(card.snapshot().details.parallel).toMatchObject({ total: 4, pending: 0, running: 1, completed: 1, failed: 1, canceled: 1 });
  expect(card.snapshot().details.parallel.children[0]!).toMatchObject({ status: "completed", telemetry: { elapsedMs: 10 } });
});

test("does not merge distinct authoritative invocation IDs that share a bounded display prefix", () => {
  const card = createParallelCardProjection("en");
  const prefix = "i".repeat(256);
  card.reduce({ type: "accepted", identity: { ...identity(1), invocationId: `${prefix}-one` } });
  card.reduce({ type: "accepted", identity: { ...identity(2), invocationId: `${prefix}-two` } });
  expect(card.snapshot().details.parallel.children).toHaveLength(2);
});

test("ignores unknown and duplicate identities, bounds UTF-8 details, and returns isolated snapshots", () => {
  const card = createParallelCardProjection("en");
  card.reduce({ type: "starting", identity: identity(1) });
  card.reduce({ type: "accepted", identity: identity(1) });
  card.reduce({ type: "accepted", identity: { ...identity(1), name: "imposter" } });
  for (let i = 2; i <= 9; i += 1) card.reduce({ type: "accepted", identity: identity(i) });
  const credentialLike = [["to", "ken"].join(""), ["se", "cret"].join("")].join("=");
  const privatePath = ["", "Users", "person", "private"].join("/");
  card.reduce({ type: "assistant", identity: identity(1), summary: `${"🙂".repeat(10_000)} ${credentialLike} ${privatePath}` });
  const first = card.snapshot();
  expect(first.details.parallel.children).toHaveLength(8);
  expect(first.details.parallel.children[0]!.identity.name).toBe("task-1");
  expect(Buffer.byteLength(JSON.stringify(first.details), "utf8")).toBeLessThan(32 * 1024);
  expect(JSON.stringify(first)).not.toContain(["se", "cret"].join(""));
  expect(JSON.stringify(first)).not.toContain(["", "Users", "person"].join("/"));
  (first.details.parallel.children[0]!.identity as { name: string }).name = "mutated";
  expect(card.snapshot().details.parallel.children[0]!.identity.name).toBe("task-1");
});

test("detects stall when worker makes no substantive progress past threshold", () => {
  const card = createParallelCardProjection("en");
  card.reduce({ type: "accepted", identity: identity(1) });
  // Establish a substantive progress baseline
  card.reduce({ type: "assistant", identity: identity(1), summary: "baseline", telemetry: { elapsedMs: 0 } });
  // Long gap without any substantive event => stall
  card.reduce({ type: "starting", identity: identity(1), telemetry: { elapsedMs: 35_000 } });
  const snap = card.snapshot();
  expect(snap.details.parallel.children[0]!.diagnostic).toBeDefined();
  expect(snap.details.parallel.children[0]!.diagnostic!.code).toBe("WORKER_PROGRESS_STALLED");
});

test("does not stall after substantive assistant progress", () => {
  const card = createParallelCardProjection("en");
  card.reduce({ type: "accepted", identity: identity(1) });
  card.reduce({ type: "assistant", identity: identity(1), summary: "making progress", telemetry: { elapsedMs: 0 } });
  card.reduce({ type: "starting", identity: identity(1), telemetry: { elapsedMs: 5_000 } });
  const snap = card.snapshot();
  expect(snap.details.parallel.children[0]!.diagnostic).toBeUndefined();
});

test("stall clears and re-triggers after new substantive progress then long gap", () => {
  const card = createParallelCardProjection("en");
  card.reduce({ type: "accepted", identity: identity(1) });
  card.reduce({ type: "assistant", identity: identity(1), summary: "first", telemetry: { elapsedMs: 0 } });
  // Long gap triggers stall
  card.reduce({ type: "starting", identity: identity(1), telemetry: { elapsedMs: 35_000 } });
  expect(card.snapshot().details.parallel.children[0]!.diagnostic).toBeDefined();
  // New substantive progress clears stall
  card.reduce({ type: "assistant", identity: identity(1), summary: "resumed", telemetry: { elapsedMs: 36_000 } });
  expect(card.snapshot().details.parallel.children[0]!.diagnostic).toBeUndefined();
  // Another long gap re-triggers stall
  card.reduce({ type: "starting", identity: identity(1), telemetry: { elapsedMs: 70_000 } });
  expect(card.snapshot().details.parallel.children[0]!.diagnostic).toBeDefined();
});

test("terminal child never reports stall", () => {
  const card = createParallelCardProjection("en");
  card.reduce({ type: "accepted", identity: identity(1) });
  card.reduce({ type: "assistant", identity: identity(1), summary: "progress", telemetry: { elapsedMs: 0 } });
  card.reduce({ type: "completed", identity: identity(1), telemetry: { elapsedMs: 5_000 } });
  card.reduce({ type: "starting", identity: identity(1), telemetry: { elapsedMs: 40_000 } });
  expect(card.snapshot().details.parallel.children[0]!.diagnostic).toBeUndefined();
  expect(card.snapshot().details.parallel.children[0]!.terminal).toBe(true);
});

test("dispatchStatus derives failed when any child fails", () => {
  const card = createParallelCardProjection("en");
  [1, 2].forEach((i) => card.reduce({ type: "accepted", identity: identity(i) }));
  card.reduce({ type: "completed", identity: identity(1), telemetry: { elapsedMs: 10 } });
  card.reduce({ type: "failed", identity: identity(2), stage: "worker", summary: "fail" });
  expect(card.snapshot().details.dispatchStatus).toBe("failed");
});

test("dispatchStatus derives canceled when all terminal and some canceled", () => {
  const card = createParallelCardProjection("en");
  [1, 2].forEach((i) => card.reduce({ type: "accepted", identity: identity(i) }));
  card.reduce({ type: "completed", identity: identity(1), telemetry: { elapsedMs: 10 } });
  card.reduce({ type: "canceled", identity: identity(2), summary: "canceled" });
  expect(card.snapshot().details.dispatchStatus).toBe("canceled");
});

test("dispatchStatus is running while any child is not terminal", () => {
  const card = createParallelCardProjection("en");
  [1, 2].forEach((i) => card.reduce({ type: "accepted", identity: identity(i) }));
  card.reduce({ type: "completed", identity: identity(1), telemetry: { elapsedMs: 10 } });
  // child 2 is still pending/running
  expect(card.snapshot().details.dispatchStatus).toBe("running");
});

test("dispatchStatus is completed when all children completed", () => {
  const card = createParallelCardProjection("en");
  [1, 2].forEach((i) => card.reduce({ type: "accepted", identity: identity(i) }));
  card.reduce({ type: "completed", identity: identity(1), telemetry: { elapsedMs: 10 } });
  card.reduce({ type: "completed", identity: identity(2), telemetry: { elapsedMs: 20 } });
  expect(card.snapshot().details.dispatchStatus).toBe("completed");
});
