import { join, resolve } from "node:path";

export interface HorsepowerPathOptions {
  homeDir: string;
  projectDir: string;
}

export interface HorsepowerScopePaths {
  root: string;
  modelSlots: string;
  settings: string;
  agents: string;
}

export interface HorsepowerPaths {
  global: HorsepowerScopePaths;
  project: HorsepowerScopePaths;
}

function scopePaths(root: string): HorsepowerScopePaths {
  return {
    root,
    modelSlots: join(root, "model-slots.json"),
    settings: join(root, "settings.json"),
    agents: join(root, "agents"),
  };
}

export function resolveHorsepowerPaths(options: HorsepowerPathOptions): HorsepowerPaths {
  const homeDir = resolve(options.homeDir);
  const projectDir = resolve(options.projectDir);

  return {
    global: scopePaths(join(homeDir, ".pi", "agent", "horsepower")),
    project: scopePaths(join(projectDir, ".pi", "horsepower")),
  };
}
