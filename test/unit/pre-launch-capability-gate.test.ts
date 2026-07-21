import { expect, test, vi } from "vitest";

const selection = {
  model: "provider/model",
  thinking: "high" as const,
  catalogRevision: "catalog-r1",
};

async function gateFixture(now = 0) {
  const [{ createCapabilityEvidenceCache }, { createPreLaunchCapabilityGate }] = await Promise.all([
    import("../../src/capabilities/evidence-cache.js"),
    import("../../src/runtime/pre-launch-capability-gate.js"),
  ]);
  const clock = { now };
  const cache = createCapabilityEvidenceCache({ now: () => clock.now });
  const probe = { probe: vi.fn() };
  const gate = createPreLaunchCapabilityGate({ cache, probe });
  return { cache, clock, gate, probe };
}

test("reuses only fresh exact evidence and reprobes missing, stale, revision-mismatched, or invalidated selections", async () => {
  const { cache, clock, gate, probe } = await gateFixture();
  probe.probe.mockResolvedValue({ status: "supported", evidence: { code: "accepted" } });

  await gate.ensure(selection);
  await gate.ensure(selection);
  expect(probe.probe).toHaveBeenCalledTimes(1);

  await gate.ensure({ ...selection, thinking: "low" });
  await gate.ensure({ ...selection, catalogRevision: "catalog-r2" });
  expect(probe.probe).toHaveBeenCalledTimes(3);

  cache.invalidate(selection);
  await gate.ensure(selection);
  clock.now = 10 * 60 * 1_000 + 1;
  await gate.ensure(selection);
  expect(probe.probe).toHaveBeenCalledTimes(5);
});

test.each(["unsupported", "inconclusive"] as const)("rejects %s probes with bounded remediation and no positive evidence", async (status) => {
  const { cache, gate, probe } = await gateFixture();
  probe.probe.mockResolvedValue({ status, evidence: { code: "x".repeat(2_000), detail: "private provider output" } });

  const error = await gate.ensure(selection).catch((cause: unknown) => cause) as Error & { code?: string; status?: string };

  expect(error).toMatchObject({ code: "MODEL_CAPABILITY_UNVERIFIED", status });
  expect(error.message).toContain("horsepower setup --interactive");
  expect(Buffer.byteLength(error.message, "utf8")).toBeLessThanOrEqual(512);
  expect(error.message).not.toContain("private provider output");
  expect(cache.get(selection)).toBeUndefined();
});

test("authoritative exact catalog support avoids a live probe", async () => {
  const { cache, gate, probe } = await gateFixture();

  await gate.ensure(selection, ["off", "high"]);

  expect(probe.probe).not.toHaveBeenCalled();
  expect(cache.get(selection)).toMatchObject({ source: "declared" });
});

test("explicit actual-worker rejection invalidates only matching evidence and returns bounded remediation", async () => {
  const { cache, gate } = await gateFixture();
  const other = { ...selection, thinking: "low" as const };
  cache.recordSupported(selection, { source: "live-probe", code: "accepted" });
  cache.recordSupported(other, { source: "live-probe", code: "accepted" });

  const remediation = gate.handleWorkerRejection(selection, {
    kind: "capability_rejection",
    parameter: "thinking",
    rejectedValue: "high",
    code: "INVALID_THINKING",
    detail: "x".repeat(2_000),
  });

  expect(remediation).toMatchObject({ code: "MODEL_CAPABILITY_REJECTED", status: "unsupported" });
  expect(Buffer.byteLength(remediation!.message, "utf8")).toBeLessThanOrEqual(512);
  expect(cache.get(selection)).toBeUndefined();
  expect(cache.get(other)).toBeDefined();
  expect(gate.handleWorkerRejection(other, new Error("ordinary worker failure"))).toBeUndefined();
});
