import { chmod, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/cli", { recursive: true });
await mkdir("dist/extension", { recursive: true });

await build({
  entryPoints: ["src/cli/main.ts"],
  outfile: "dist/cli/horsepower.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
});

await build({
  entryPoints: ["src/extension/index.ts"],
  outfile: "dist/extension/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: [
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
  ],
});

await chmod("dist/cli/horsepower.js", 0o755);
