import { expect, test } from "vitest";

test("resolves global and project Horsepower paths without consulting process globals", async () => {
  const module = await import("../../src/config/paths.js").catch(() => undefined);

  expect(module?.resolveHorsepowerPaths({
    homeDir: "/home/captain",
    projectDir: "/work/project",
  })).toEqual({
    global: {
      root: "/home/captain/.pi/agent/horsepower",
      modelSlots: "/home/captain/.pi/agent/horsepower/model-slots.json",
      settings: "/home/captain/.pi/agent/horsepower/settings.json",
      agents: "/home/captain/.pi/agent/horsepower/agents",
    },
    project: {
      root: "/work/project/.pi/horsepower",
      modelSlots: "/work/project/.pi/horsepower/model-slots.json",
      settings: "/work/project/.pi/horsepower/settings.json",
      agents: "/work/project/.pi/horsepower/agents",
    },
  });
});
