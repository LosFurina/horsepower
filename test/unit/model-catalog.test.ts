import { expect, test, vi } from "vitest";

const model = (overrides: Record<string, unknown> = {}) => ({
  provider: "provider",
  id: "model",
  name: "Model",
  reasoning: true,
  apiKey: "must-not-affect-catalog",
  headers: { authorization: "secret" },
  ...overrides,
});

test("discovers current Pi models as stable provider/model identifiers without secret revision inputs", async () => {
  const { createPiModelCatalog } = await import("../../src/capabilities/model-catalog.js");
  const first = createPiModelCatalog({
    getAll: vi.fn(() => [
      model({ provider: "zeta", id: "second", apiKey: "first-secret" }),
      model({ provider: "alpha", id: "first", apiKey: "another-secret" }),
    ]),
  });
  const second = createPiModelCatalog({
    getAll: vi.fn(() => [
      model({ provider: "alpha", id: "first", apiKey: "rotated-secret", headers: { authorization: "rotated" } }),
      model({ provider: "zeta", id: "second", apiKey: "different-secret" }),
    ]),
  });

  expect(first).toMatchObject({ status: "available", modelIds: ["alpha/first", "zeta/second"] });
  expect(first.status).toBe("available");
  if (first.status !== "available") throw new Error("expected an available catalog");
  expect(second).toMatchObject({ status: "available", revision: first.revision });
  expect(JSON.stringify(first)).not.toContain("secret");
});

test("reports empty and unavailable current Pi catalogs without throwing", async () => {
  const { createPiModelCatalog } = await import("../../src/capabilities/model-catalog.js");

  expect(createPiModelCatalog({ getAll: () => [] })).toEqual({
    status: "unavailable",
    reason: "empty",
  });
  expect(createPiModelCatalog({ getAll: () => { throw new Error("credential-shaped private detail"); } })).toEqual({
    status: "unavailable",
    reason: "registry-error",
  });
});

test("treats coarse reasoning metadata as unverified instead of declaring every thinking level", async () => {
  const { createPiModelCatalog } = await import("../../src/capabilities/model-catalog.js");
  const reasoning = createPiModelCatalog({ getAll: () => [model({ reasoning: true })] });
  const nonReasoning = createPiModelCatalog({ getAll: () => [model({ reasoning: false })] });

  expect(reasoning).toMatchObject({
    status: "available",
    models: {
      "provider/model": { thinkingLevels: undefined },
    },
  });
  expect(nonReasoning).toMatchObject({
    status: "available",
    models: {
      "provider/model": { thinkingLevels: undefined },
    },
  });
  expect(reasoning.status).toBe("available");
  expect(nonReasoning.status).toBe("available");
  if (reasoning.status !== "available" || nonReasoning.status !== "available") {
    throw new Error("expected available catalogs");
  }
  expect(nonReasoning.revision).not.toBe(reasoning.revision);
});

test("uses an authoritative Pi thinking-level map as exact declared support", async () => {
  const { createPiModelCatalog } = await import("../../src/capabilities/model-catalog.js");
  const snapshot = createPiModelCatalog({
    getAll: () => [model({
      thinkingLevelMap: { off: "none", low: "low", medium: null, high: "high" },
    })],
  });

  expect(snapshot).toMatchObject({
    status: "available",
    models: {
      "provider/model": { thinkingLevels: ["off", "low", "high"] },
    },
  });
});
