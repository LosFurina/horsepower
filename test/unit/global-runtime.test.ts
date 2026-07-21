import { expect, test, vi } from "vitest";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

test("reuses one process-global generation and runtime", async () => {
  const { acquireGlobalRuntime } = await import("../../src/runtime/global-runtime.js").catch(() => ({ acquireGlobalRuntime: undefined }));
  const host = {};
  const create = vi.fn(() => ({ shutdown: vi.fn(async () => undefined), abandon: vi.fn() }));

  const first = acquireGlobalRuntime!({ host, create });
  const second = acquireGlobalRuntime!({ host, create });

  expect(first.value).toBe(second.value);
  expect(first.generation).toBe(second.generation);
  expect(create).toHaveBeenCalledTimes(1);
});

test("stale cleanup cannot destroy or remove a replacement generation", async () => {
  const { acquireGlobalRuntime, replaceGlobalRuntimeForTest, RUNTIME_SYMBOL } = await import("../../src/runtime/global-runtime.js");
  const host: Record<PropertyKey, unknown> = {};
  const oldShutdown = deferred();
  const oldValue = { shutdown: vi.fn(() => oldShutdown.promise), abandon: vi.fn() };
  const oldLease = acquireGlobalRuntime({ host, create: () => oldValue });
  const replacement = replaceGlobalRuntimeForTest(host, {
    shutdown: vi.fn(async () => undefined),
    abandon: vi.fn(),
  });

  const cleanup = oldLease.cleanup();
  expect(host[RUNTIME_SYMBOL]).toBe(replacement.record);
  oldShutdown.resolve();
  await cleanup;

  expect(oldValue.shutdown).not.toHaveBeenCalled();
  expect(host[RUNTIME_SYMBOL]).toBe(replacement.record);
});

test("all leases for a generation share its pending cleanup", async () => {
  const { acquireGlobalRuntime, RUNTIME_SYMBOL } = await import("../../src/runtime/global-runtime.js");
  const host: Record<PropertyKey, unknown> = {};
  const stopped = deferred();
  const value = { shutdown: vi.fn(() => stopped.promise), abandon: vi.fn() };
  const firstLease = acquireGlobalRuntime({ host, create: () => value });
  const secondLease = acquireGlobalRuntime({ host, create: () => value });

  const first = firstLease.cleanup();
  const second = secondLease.cleanup();
  let firstSettled = false;
  let secondSettled = false;
  void first.then(() => { firstSettled = true; });
  void second.then(() => { secondSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));

  expect(host[RUNTIME_SYMBOL]).toBeUndefined();
  expect(value.shutdown).toHaveBeenCalledTimes(1);
  expect(firstSettled).toBe(false);
  expect(secondSettled).toBe(false);

  stopped.resolve();
  await Promise.all([first, second]);
  expect(firstSettled).toBe(true);
  expect(secondSettled).toBe(true);
  expect(value.shutdown).toHaveBeenCalledTimes(1);
});

test("signal backstop cleans the live generation then re-delivers the signal", async () => {
  const { acquireGlobalRuntime, RUNTIME_SYMBOL } = await import("../../src/runtime/global-runtime.js");
  const host: Record<PropertyKey, unknown> = {};
  const handlers = new Map<string, () => void>();
  const events = {
    on: vi.fn((event: string, handler: () => void) => { handlers.set(event, handler); }),
    off: vi.fn((event: string, handler: () => void) => {
      if (handlers.get(event) === handler) handlers.delete(event);
    }),
  };
  const stopped = deferred();
  const terminate = vi.fn();
  const value = { shutdown: vi.fn(() => stopped.promise), abandon: vi.fn() };
  acquireGlobalRuntime({ host, create: () => value, events, terminate });

  handlers.get("SIGTERM")!();
  expect(host[RUNTIME_SYMBOL]).toBeUndefined();
  expect(terminate).not.toHaveBeenCalled();
  stopped.resolve();
  await new Promise((resolve) => setImmediate(resolve));

  expect(value.shutdown).toHaveBeenCalledTimes(1);
  expect(terminate).toHaveBeenCalledWith("SIGTERM");
});

test("exit during deferred signal cleanup abandons the still-owned generation", async () => {
  const { acquireGlobalRuntime } = await import("../../src/runtime/global-runtime.js");
  const host: Record<PropertyKey, unknown> = {};
  const handlers = new Map<string, () => void>();
  const events = {
    on: vi.fn((event: string, handler: () => void) => { handlers.set(event, handler); }),
    off: vi.fn((event: string, handler: () => void) => {
      if (handlers.get(event) === handler) handlers.delete(event);
    }),
  };
  const stopped = deferred();
  const value = { shutdown: vi.fn(() => stopped.promise), abandon: vi.fn() };
  acquireGlobalRuntime({ host, create: () => value, events, terminate: vi.fn() });

  handlers.get("SIGTERM")!();
  expect(handlers.has("exit")).toBe(true);
  const exit = handlers.get("exit")!;
  exit();
  exit();

  expect(value.abandon).toHaveBeenCalledTimes(1);
  stopped.resolve();
  await new Promise((resolve) => setImmediate(resolve));
});

test("exit during stale deferred cleanup abandons the pending generation without touching its replacement", async () => {
  const { acquireGlobalRuntime, replaceGlobalRuntimeForTest, RUNTIME_SYMBOL } = await import("../../src/runtime/global-runtime.js");
  const host: Record<PropertyKey, unknown> = {};
  const handlers = new Map<string, () => void>();
  const events = {
    on: vi.fn((event: string, handler: () => void) => { handlers.set(event, handler); }),
    off: vi.fn((event: string, handler: () => void) => {
      if (handlers.get(event) === handler) handlers.delete(event);
    }),
  };
  const stopped = deferred();
  const oldValue = { shutdown: vi.fn(() => stopped.promise), abandon: vi.fn() };
  acquireGlobalRuntime({ host, create: () => oldValue, events, terminate: vi.fn() });

  handlers.get("SIGTERM")!();
  const exit = handlers.get("exit")!;
  const replacement = { shutdown: vi.fn(async () => undefined), abandon: vi.fn() };
  const replacementRecord = replaceGlobalRuntimeForTest(host, replacement).record;
  exit();
  exit();

  expect(oldValue.abandon).toHaveBeenCalledTimes(1);
  expect(replacement.abandon).not.toHaveBeenCalled();
  expect(host[RUNTIME_SYMBOL]).toBe(replacementRecord);
  stopped.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  expect(host[RUNTIME_SYMBOL]).toBe(replacementRecord);
});

test("synchronous exit backstop abandons only its live generation", async () => {
  const { acquireGlobalRuntime, RUNTIME_SYMBOL } = await import("../../src/runtime/global-runtime.js");
  const host: Record<PropertyKey, unknown> = {};
  const handlers = new Map<string, () => void>();
  const events = {
    on: vi.fn((event: string, handler: () => void) => { handlers.set(event, handler); }),
    off: vi.fn((event: string, handler: () => void) => {
      if (handlers.get(event) === handler) handlers.delete(event);
    }),
  };
  const value = { shutdown: vi.fn(async () => undefined), abandon: vi.fn() };
  acquireGlobalRuntime({ host, create: () => value, events });

  const exit = handlers.get("exit")!;
  exit();
  exit();

  expect(value.abandon).toHaveBeenCalledTimes(1);
  expect(value.shutdown).not.toHaveBeenCalled();
  expect(host[RUNTIME_SYMBOL]).toBeUndefined();
});
