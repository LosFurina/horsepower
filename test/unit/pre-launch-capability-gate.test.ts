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

test("records user-configured evidence without probing upstream", async () => {
  const { cache, clock, gate, probe } = await gateFixture();
  await gate.ensure(selection);
  await gate.ensure(selection);
  expect(probe.probe).not.toHaveBeenCalled();

  await gate.ensure({ ...selection, thinking: "low" });
  await gate.ensure({ ...selection, catalogRevision: "catalog-r2" });
  expect(probe.probe).not.toHaveBeenCalled();

  cache.invalidate(selection);
  await gate.ensure(selection);
  clock.now = 10 * 60 * 1_000 + 1;
  await gate.ensure(selection);
  expect(probe.probe).not.toHaveBeenCalled();
  expect(cache.get(selection)).toMatchObject({ source: "user-configured", code: "user_configured" });
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
  cache.recordSupported(selection, { source: "user-configured", code: "accepted" });
  cache.recordSupported(other, { source: "user-configured", code: "accepted" });

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
