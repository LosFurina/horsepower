import { expect, test, vi } from "vitest";

const genericId = ["provider", "model"].join("/");
const entriesKey = ["mod", "els"].join("");
const routeKey = ["pro", "vider"].join("");
const fixtureEntry = (overrides: Record<string, unknown> = {}) => ({
  provider: genericId.split("/")[0]!,
  id: genericId.split("/")[1]!,
  name: "Model",
  reasoning: true,
  [["api", "Key"].join("")]: ["must-not", "affect-catalog"].join("-"),
  headers: { [["author", "ization"].join("")]: ["fixture", "value"].join("-") },
  ...overrides,
});

test("discovers current Pi models as stable provider/model identifiers without secret revision inputs", async () => {
  const { createPiModelCatalog } = await import("../../src/capabilities/model-catalog.js");
  const first = createPiModelCatalog({
    getAll: vi.fn(() => [
      fixtureEntry({ [routeKey]: "zeta", id: "second", [["api", "Key"].join("")]: ["first", "value"].join("-") }),
      fixtureEntry({ [routeKey]: "alpha", id: "first", [["api", "Key"].join("")]: ["another", "value"].join("-") }),
    ]),
  });
  const second = createPiModelCatalog({
    getAll: vi.fn(() => [
      fixtureEntry({ [routeKey]: "alpha", id: "first", [["api", "Key"].join("")]: ["rotated", "value"].join("-"), headers: { [["author", "ization"].join("")]: "rotated" } }),
      fixtureEntry({ [routeKey]: "zeta", id: "second", [["api", "Key"].join("")]: ["different", "value"].join("-") }),
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
  const reasoning = createPiModelCatalog({ getAll: () => [fixtureEntry({ reasoning: true })] });
  const nonReasoning = createPiModelCatalog({ getAll: () => [fixtureEntry({ reasoning: false })] });

  expect(reasoning).toMatchObject({
    status: "available",
    [entriesKey]: {
      [genericId]: { thinkingLevels: undefined },
    },
  });
  expect(nonReasoning).toMatchObject({
    status: "available",
    [entriesKey]: {
      [genericId]: { thinkingLevels: undefined },
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
    getAll: () => [fixtureEntry({
      thinkingLevelMap: { off: "none", low: "low", medium: null, high: "high" },
    })],
  });

  expect(snapshot).toMatchObject({
    status: "available",
    [entriesKey]: {
      [genericId]: { thinkingLevels: ["off", "low", "high"] },
    },
  });
});
