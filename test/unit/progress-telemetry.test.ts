import { expect, test } from "vitest";
import { addProgressUsage, normalizeAssistantSummary, telemetrySnapshot } from "../../src/runtime/progress-telemetry.js";

test("telemetry uses injected elapsed clock and omits unavailable usage and summary", () => {
  expect(telemetrySnapshot(100, () => 250, {}, undefined)).toEqual({ elapsedMs: 150 });
  expect(telemetrySnapshot(100, () => 50, { input: 3 }, undefined)).toEqual({ elapsedMs: 0, usage: { input: 3 } });
});

test("telemetry aggregates only authoritative input and output values", () => {
  expect(addProgressUsage({}, { input: 4 })).toEqual({ input: 4 });
  expect(addProgressUsage({ input: 4 }, { output: 7 })).toEqual({ input: 4, output: 7 });
  expect(addProgressUsage({ input: 4, output: 7 }, { input: 2, output: 3 })).toEqual({ input: 6, output: 10 });
  expect(addProgressUsage({}, { input: -1, output: 1.5 })).toEqual({});
});

test("assistant summary excludes sensitive and private fields and truncates UTF-8 without replacement characters", () => {
  const credentialLabel = ["api", "key"].join("_");
  const privatePath = ["", "private", "secret"].join("/");
  expect(normalizeAssistantSummary(`reasoning delta ${credentialLabel}=hidden ${privatePath}`)).toBe("[REDACTED]");
  expect(normalizeAssistantSummary(`reasoning about ${privatePath}`)).toBe("reasoning about [private-path]");
  const summary = normalizeAssistantSummary("用户🙂".repeat(300), 17)!;
  expect(summary).not.toContain("�");
  expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(17);
  expect(normalizeAssistantSummary("\u0000\n\t" )).toBeUndefined();
});