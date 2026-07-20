import { expect, test } from "vitest";

test("reads compact and detailed events by monotonic cursor", async () => {
  const module = await import("../../src/runtime/event-stream.js").catch(() => undefined);
  const stream = module?.createEventStream({ byteLimit: 1024 });

  const first = stream?.append({ type: "worker.created", timestamp: 1 });
  const second = stream?.append({ type: "rpc.raw", timestamp: 2, details: { type: "agent_start" } }, true);

  expect([first, second]).toEqual([1, 2]);
  expect(stream?.read({ afterCursor: 0, includeDetails: false })).toMatchObject({
    events: [{ cursor: 1, type: "worker.created", timestamp: 1 }],
    oldestCursor: 1,
    nextCursor: 2,
    hasMore: false,
    truncated: false,
  });
  expect(stream?.read({ afterCursor: 1, includeDetails: true })).toMatchObject({
    events: [{ cursor: 2, type: "rpc.raw", timestamp: 2, details: { type: "agent_start" } }],
    nextCursor: 2,
  });
});

test("reports a dropped oversized event between retained cursors", async () => {
  const { createEventStream } = await import("../../src/runtime/event-stream.js");
  const stream = createEventStream({ byteLimit: 180 });
  stream.append({ type: "small", timestamp: 1, text: "first" });
  stream.append({ type: "large", timestamp: 2, text: "x".repeat(500) });
  stream.append({ type: "small", timestamp: 3, text: "third" });

  expect(stream.read({ afterCursor: 1, includeDetails: true })).toMatchObject({
    events: [{ cursor: 3, type: "small" }],
    oldestCursor: 1,
    truncated: true,
  });
});

test("drops a single event larger than the byte limit", async () => {
  const { createEventStream } = await import("../../src/runtime/event-stream.js");
  const stream = createEventStream({ byteLimit: 10 });

  expect(stream.append({ type: "text", timestamp: 1, text: "x".repeat(100) })).toBe(1);
  expect(stream.read({ afterCursor: 0, includeDetails: true })).toMatchObject({
    events: [],
    oldestCursor: 2,
    truncated: true,
  });
});

test("does not retain one metadata entry per dropped event", async () => {
  const { createEventStream } = await import("../../src/runtime/event-stream.js");
  const stream = createEventStream({ byteLimit: 1 });
  for (let index = 0; index < 10_000; index += 1) {
    stream.append({ type: "large", timestamp: index, text: "oversized" });
  }

  expect(stream.read({ afterCursor: 9_999, includeDetails: true })).toMatchObject({
    events: [],
    nextCursor: 10_000,
    truncated: true,
  });
  expect(stream.read({ afterCursor: 10_000, includeDetails: true }).truncated).toBe(false);
  expect(stream.stats().droppedRangeCount).toBe(1);
});

test("evicts old events by UTF-8 bytes and reports truncation", async () => {
  const { createEventStream } = await import("../../src/runtime/event-stream.js");
  const stream = createEventStream({ byteLimit: 360 });
  for (let index = 0; index < 8; index += 1) {
    stream.append({ type: "text", timestamp: index, text: `你好-${index}-${"x".repeat(40)}` });
  }

  const result = stream.read({ afterCursor: 0, includeDetails: true, limit: 2 });

  expect(result.truncated).toBe(true);
  expect(result.oldestCursor).toBeGreaterThan(1);
  expect(result.events).toHaveLength(2);
  expect(result.hasMore).toBe(true);
  expect(result.nextCursor).toBe(result.events[1]?.cursor);
});
