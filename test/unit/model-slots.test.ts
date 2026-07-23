import { expect, test } from "vitest";

const requiredSlots = {
  judgment: { model: "provider/strong", thinking: "high" },
  craft: { model: "provider/craft", thinking: "medium" },
  utility: { model: "provider/cheap", thinking: "low" },
} as const;

test("requires judgment, craft, and utility bindings", async () => {
  const module = await import("../../src/slots/registry.js").catch(() => undefined);

  expect(() => module?.createSlotRegistry({
    global: { slots: { judgment: requiredSlots.judgment } },
  })).toThrow("Missing required model slots: craft, utility");
});

test("resolves built-in speed and context fallbacks with complete metadata", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");
  const registry = createSlotRegistry({ global: { slots: requiredSlots } });

  expect(registry.resolve("speed")).toEqual({
    requestedSlot: "speed",
    resolvedSlot: "utility",
    model: "provider/cheap",
    thinking: "low",
    fallbackPath: ["speed", "utility"],
    revision: registry.revision,
  });
  expect(registry.resolve("context")).toEqual({
    requestedSlot: "context",
    resolvedSlot: "judgment",
    model: "provider/strong",
    thinking: "high",
    fallbackPath: ["context", "judgment"],
    revision: registry.revision,
  });
});

test("rejects invented lifecycle slots with bounded available-slot guidance", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");
  const registry = createSlotRegistry({ global: { slots: requiredSlots } });

  expect(() => registry.resolve("test")).toThrow(
    "Unknown model slot: test. Available slots: context, craft, judgment, speed, utility. Pass an existing modelSlot explicitly; do not derive it from agent or workKind.",
  );
  expect(registry.resolve("craft")).toMatchObject({ requestedSlot: "craft", resolvedSlot: "craft" });
});

test("computes the same revision for semantically identical key ordering", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");
  const first = createSlotRegistry({ global: { slots: requiredSlots } });
  const second = createSlotRegistry({
    global: {
      slots: {
        utility: { thinking: "low", model: "provider/cheap" },
        craft: { thinking: "medium", model: "provider/craft" },
        judgment: { thinking: "high", model: "provider/strong" },
      },
    },
  });

  expect(second.revision).toBe(first.revision);
});

test("does not consult locale collation when normalizing revisions", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");
  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => {
    throw new Error("locale collation must not be used");
  };

  try {
    expect(() => createSlotRegistry({
      global: {
        slots: {
          ...requiredSlots,
          ta: { model: "provider/ta", thinking: "off" },
          za: { model: "provider/za", thinking: "off" },
        },
      },
    })).not.toThrow();
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test("merges project overrides without dropping unmentioned global slots", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");
  const registry = createSlotRegistry({
    global: { slots: { ...requiredSlots, vision: { model: "provider/vision", thinking: "medium" } } },
    project: { slots: { craft: { model: "project/craft", thinking: "max" } } },
  });

  expect(registry.resolve("craft").model).toBe("project/craft");
  expect(registry.resolve("craft").thinking).toBe("max");
  expect(registry.resolve("vision").model).toBe("provider/vision");
});

test("rejects invalid custom slot IDs", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");

  expect(() => createSlotRegistry({
    global: { slots: { ...requiredSlots, "Vision Slot": { model: "provider/vision", thinking: "medium" } } },
  })).toThrow('Invalid model slot ID: Vision Slot');
});

test("reports a complete fallback cycle", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");

  expect(() => createSlotRegistry({
    global: {
      slots: {
        ...requiredSlots,
        alpha: { fallback: "beta" },
        beta: { fallback: "gamma" },
        gamma: { fallback: "alpha" },
      },
    },
  })).toThrow("Model slot fallback cycle: alpha -> beta -> gamma -> alpha");
});

test("rejects invalid thinking levels during runtime configuration validation", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");

  expect(() => createSlotRegistry({
    global: {
      slots: {
        ...requiredSlots,
        utility: { model: "provider/cheap", thinking: JSON.parse('"extreme"') },
      },
    },
  })).toThrow('Invalid thinking level for slot utility: extreme');
});

test("rejects cycles and missing targets even when no caller resolves them", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");

  expect(() => createSlotRegistry({
    global: {
      slots: {
        ...requiredSlots,
        alpha: { fallback: "beta" },
        beta: { fallback: "alpha" },
      },
    },
  })).toThrow("Model slot fallback cycle: alpha -> beta -> alpha");

  expect(() => createSlotRegistry({
    global: { slots: { ...requiredSlots, vision: { fallback: "missing" } } },
  })).toThrow("Model slot fallback target does not exist: vision -> missing");
});

test("validates models and supported thinking levels when a catalog is available", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");
  const models = {
    "provider/strong": { thinkingLevels: ["high"] },
    "provider/craft": { thinkingLevels: ["medium"] },
    "provider/cheap": { thinkingLevels: ["off", "low"] },
  } as const;

  expect(() => createSlotRegistry({
    global: { slots: { ...requiredSlots, utility: { model: "provider/missing", thinking: "low" } } },
    models,
  })).toThrow("Unknown model for slot utility: provider/missing");

  expect(() => createSlotRegistry({
    global: { slots: { ...requiredSlots, utility: { model: "provider/cheap", thinking: "max" } } },
    models,
  })).toThrow("Thinking level max is not supported by model provider/cheap for slot utility");
});

test("requires each required slot to contain a concrete model binding", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");

  expect(() => createSlotRegistry({
    global: {
      slots: {
        ...requiredSlots,
        judgment: { fallback: "craft" },
      },
    },
  })).toThrow("Required model slot must contain model and thinking: judgment");
});

test("rejects malformed and hybrid bindings with slot-specific diagnostics", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");

  expect(() => createSlotRegistry({
    global: {
      slots: JSON.parse(JSON.stringify({ ...requiredSlots, vision: null })),
    },
  })).toThrow("Invalid binding for model slot vision: expected an object");

  expect(() => createSlotRegistry({
    global: {
      slots: JSON.parse(JSON.stringify({
        ...requiredSlots,
        vision: { fallback: "utility", model: "provider/vision", thinking: "max" },
      })),
    },
  })).toThrow("Invalid binding for model slot vision: choose fallback or model/thinking");
});

test("owns an immutable effective snapshot that matches its revision", async () => {
  const { createSlotRegistry } = await import("../../src/slots/registry.js");
  const utility = { model: "provider/cheap", thinking: "low" } as const;
  const slots = { ...requiredSlots, utility };
  const registry = createSlotRegistry({ global: { slots } });
  const revision = registry.revision;

  Object.assign(utility, { model: "mutated/model", thinking: "max" });

  expect(registry.resolve("utility").model).toBe("provider/cheap");
  expect(registry.resolve("utility").thinking).toBe("low");
  expect(registry.revision).toBe(revision);
  expect(() => Object.assign(registry.effective.utility!, { model: "other/model" })).toThrow();
  expect(() => Object.assign(registry, { revision: "forged", effective: {} })).toThrow();
  expect(registry.revision).toBe(revision);
});
