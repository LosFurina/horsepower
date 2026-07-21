import { describe, expect, test } from "vitest";
import type { ThinkingLevel } from "../../src/slots/registry.js";

const selection = { model: "provider/model", thinking: "high" as ThinkingLevel };

describe("classifyCapabilityProbe", () => {
  test.each([
    ["successful completion", { kind: "success" }, "supported"],
    ["structured rejection of the selected value", { kind: "capability-rejection", rejectedValue: "high", code: "INVALID_THINKING" }, "unsupported"],
    ["authoritative accepted values excluding the selection", { kind: "capability-rejection", acceptedValues: ["low", "medium"], acceptedValuesAuthoritative: true, code: "INVALID_THINKING" }, "unsupported"],
    ["accepted values containing the selection", { kind: "capability-rejection", acceptedValues: ["low", "high"], acceptedValuesAuthoritative: true }, "inconclusive"],
    ["non-authoritative accepted values excluding the selection", { kind: "capability-rejection", acceptedValues: ["low", "medium"] }, "inconclusive"],
    ["rejection of a different value", { kind: "capability-rejection", rejectedValue: "max" }, "inconclusive"],
    ["authentication failure", { kind: "failure", category: "authentication", message: "model high is supported" }, "inconclusive"],
    ["authorization failure", { kind: "failure", category: "authorization" }, "inconclusive"],
    ["quota failure", { kind: "failure", category: "quota" }, "inconclusive"],
    ["rate limit failure", { kind: "failure", category: "rate-limit" }, "inconclusive"],
    ["timeout", { kind: "failure", category: "timeout" }, "inconclusive"],
    ["transport failure", { kind: "failure", category: "transport" }, "inconclusive"],
    ["service failure", { kind: "failure", category: "service" }, "inconclusive"],
    ["malformed response", { kind: "failure", category: "malformed-response" }, "inconclusive"],
    ["unknown failure claiming rejection", { kind: "failure", category: "unknown", message: "unsupported thinking; accepted values: low" }, "inconclusive"],
  ] as const)("classifies %s as %s", async (_name, observation, expected) => {
    const { classifyCapabilityProbe } = await import("../../src/runtime/model-capability-probe.js");

    expect(classifyCapabilityProbe(selection, observation)).toMatchObject({ status: expected });
  });
});

test("provider-neutral probes accept an exact selection and abort signal", async () => {
  const { runCapabilityProbe } = await import("../../src/runtime/model-capability-probe.js");
  const controller = new AbortController();
  const seen: unknown[] = [];
  const probe = {
    probe: async (request: typeof selection & { signal?: AbortSignal }) => {
      seen.push(request);
      return { status: "supported" as const, evidence: { code: "completed" } };
    },
  };

  await expect(runCapabilityProbe(probe, { ...selection, signal: controller.signal })).resolves.toMatchObject({ status: "supported" });
  expect(seen).toEqual([{ ...selection, signal: controller.signal }]);
});
