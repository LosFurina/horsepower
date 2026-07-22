import { expect, test } from "vitest";

const genericId = ["provider", "model"].join("/");
const otherId = ["provider", "other"].join("/");
const key = {
  model: genericId,
  thinking: "high",
  catalogRevision: "catalog-a",
} as const;

const supported = { source: "user-configured", code: "accepted" } as const;

test("reuses only positive evidence for the exact model, thinking, and catalog revision", async () => {
  const { createCapabilityEvidenceCache } = await import("../../src/capabilities/evidence-cache.js");
  const cache = createCapabilityEvidenceCache({ now: () => 1_000 });
  cache.recordSupported(key, supported);

  expect(cache.get(key)).toEqual({ ...supported, recordedAt: 1_000 });
  expect(cache.get({ ...key, model: otherId })).toBeUndefined();
  expect(cache.get({ ...key, thinking: "low" })).toBeUndefined();
  expect(cache.get({ ...key, catalogRevision: "catalog-b" })).toBeUndefined();
});

test("expires evidence after ten minutes and removes stale entries", async () => {
  const { createCapabilityEvidenceCache, MAX_CAPABILITY_EVIDENCE_TTL_MS } = await import("../../src/capabilities/evidence-cache.js");
  let now = 0;
  const cache = createCapabilityEvidenceCache({ now: () => now });
  cache.recordSupported(key, supported);

  now = MAX_CAPABILITY_EVIDENCE_TTL_MS;
  expect(cache.get(key)).toBeDefined();
  now += 1;
  expect(cache.get(key)).toBeUndefined();
  expect(cache.size).toBe(0);
});

test("caps configured evidence lifetime at ten minutes", async () => {
  const { createCapabilityEvidenceCache, MAX_CAPABILITY_EVIDENCE_TTL_MS } = await import("../../src/capabilities/evidence-cache.js");
  let now = 0;
  const cache = createCapabilityEvidenceCache({
    now: () => now,
    ttlMs: MAX_CAPABILITY_EVIDENCE_TTL_MS * 2,
  });
  cache.recordSupported(key, supported);

  now = MAX_CAPABILITY_EVIDENCE_TTL_MS + 1;
  expect(cache.get(key)).toBeUndefined();
});

test("explicit invalidation removes only matching positive evidence", async () => {
  const { createCapabilityEvidenceCache } = await import("../../src/capabilities/evidence-cache.js");
  const cache = createCapabilityEvidenceCache({ now: () => 1_000 });
  const other = { ...key, thinking: "medium" } as const;
  cache.recordSupported(key, supported);
  cache.recordSupported(other, supported);

  expect(cache.invalidate(key)).toBe(true);
  expect(cache.get(key)).toBeUndefined();
  expect(cache.get(other)).toBeDefined();
  expect(cache.invalidate(key)).toBe(false);
});

test("bounds retained evidence codes", async () => {
  const { createCapabilityEvidenceCache, MAX_CAPABILITY_EVIDENCE_CODE_LENGTH } = await import("../../src/capabilities/evidence-cache.js");
  const cache = createCapabilityEvidenceCache({ now: () => 1_000 });
  cache.recordSupported(key, { source: "user-configured", code: "x".repeat(MAX_CAPABILITY_EVIDENCE_CODE_LENGTH + 20) });

  expect(cache.get(key)?.code).toHaveLength(MAX_CAPABILITY_EVIDENCE_CODE_LENGTH);
});
