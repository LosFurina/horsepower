import { chmod, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const narrowPiSdk = {
  name: "narrow-pi-static-resolver",
  setup(build) {
    build.onResolve({ filter: /^@earendil-works\/pi-coding-agent$/ }, () => ({ path: resolve("src/skills/pi-static-sdk.ts") }));
  },
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist/cli", { recursive: true });
await mkdir("dist/extension", { recursive: true });
await mkdir("dist/release", { recursive: true });

await build({
  entryPoints: ["src/cli/main.ts"],
  outfile: "dist/cli/horsepower.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  plugins: [narrowPiSdk],
  minify: true,
  legalComments: "none",
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __horsepowerCreateRequire } from 'node:module'; const require = __horsepowerCreateRequire(import.meta.url);" },
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

await build({
  entryPoints: ["src/release/index.ts"],
  outfile: "dist/release/release-builder.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["yaml"],
});

await chmod("dist/cli/horsepower.js", 0o755);
