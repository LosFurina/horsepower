import { expect, test, vi } from "vitest";
import { ObservationScheduler, validatePollInterval } from "../../src/runtime/observation-scheduler.js";

const probe = (revision: number, status = "running") => ({ workerId: "w1", status, progressRevision: revision, elapsedMs: 100, lastProgressAgeMs: 50, lastOperation: "prompt" });

test("validates default and bounded positive polling intervals", () => {
  expect(validatePollInterval(undefined)).toBe(30);
  expect(validatePollInterval(7)).toBe(7);
  expect(() => validatePollInterval(0)).toThrow();
  expect(() => validatePollInterval(1.5)).toThrow();
  expect(() => validatePollInterval(2_147_484)).toThrow();
});

test("emits exactly one stall after two unchanged polls and resets on progress", () => {
  let current = probe(1);
  const emit = vi.fn();
  const scheduler = new ObservationScheduler({ intervalSeconds: 1, probe: () => [current], emit });
  scheduler.poll(); scheduler.poll(); scheduler.poll();
  expect(emit).toHaveBeenCalledTimes(1);
  current = probe(2);
  scheduler.poll(); scheduler.poll(); scheduler.poll();
  expect(emit).toHaveBeenCalledTimes(2);
});

test("removes disappeared workers and invalidates stale callbacks on stop", () => {
  vi.useFakeTimers();
  try {
    let current: readonly ReturnType<typeof probe>[] = [probe(1)];
    const emit = vi.fn();
    const scheduler = new ObservationScheduler({ intervalSeconds: 1, probe: () => current, emit });
    scheduler.start();
    vi.advanceTimersByTime(1000);
    current = [];
    vi.advanceTimersByTime(3000);
    scheduler.stop();
    vi.advanceTimersByTime(5000);
    expect(emit).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
