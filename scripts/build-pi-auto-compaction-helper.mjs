import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(root, "test/fixtures/.pi-auto-compaction-runtime.bundle.mjs");
await mkdir(dirname(outfile), { recursive: true });
await build({
  stdin: {
    contents: `
export { createHorsepowerRuntime } from ${JSON.stringify(resolve(root, "src/extension/runtime.ts"))};
export { parseOpenSpecTaskInventory } from ${JSON.stringify(resolve(root, "src/openspec/task-inventory.ts"))};
export { parseTestAndGatePlan } from ${JSON.stringify(resolve(root, "src/openspec/test-and-gate-plan.ts"))};
`,
    resolveDir: root,
    sourcefile: "pi-auto-compaction-runtime-entry.ts",
    loader: "ts",
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: false,
  write: true,
});
process.stdout.write(`${outfile}\n`);
