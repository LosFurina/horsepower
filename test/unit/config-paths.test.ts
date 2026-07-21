import { expect, test } from "vitest";

test("resolves global and project Horsepower paths without consulting process globals", async () => {
  const module = await import("../../src/config/paths.js").catch(() => undefined);
  const homeDir = ["", "home", "captain"].join("/");

  expect(module?.resolveHorsepowerPaths({
    homeDir,
    projectDir: "/work/project",
  })).toEqual({
    global: {
      root: `${homeDir}/.pi/agent/horsepower`,
      modelSlots: `${homeDir}/.pi/agent/horsepower/model-slots.json`,
      settings: `${homeDir}/.pi/agent/horsepower/settings.json`,
      agents: `${homeDir}/.pi/agent/horsepower/agents`,
    },
    project: {
      root: "/work/project/.pi/horsepower",
      modelSlots: "/work/project/.pi/horsepower/model-slots.json",
      settings: "/work/project/.pi/horsepower/settings.json",
      agents: "/work/project/.pi/horsepower/agents",
    },
  });
});
