/**
 * Node-only helper for the official-Pi auto-compaction E2E production path.
 *
 * Builds (or reuses) a thin esbuild bundle that re-exports production
 * HorsepowerRuntime and official OpenSpec parsers. The Pi child process
 * imports this helper so the fixture exercises real campaign authority and
 * OpenSpec revalidation rather than hard-coded current/prepare stubs.
 */
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundlePath = resolve(repositoryRoot, "test/fixtures/.pi-auto-compaction-runtime.bundle.mjs");
const builderPath = resolve(repositoryRoot, "scripts/build-pi-auto-compaction-helper.mjs");

async function ensureBundle() {
  try {
    await access(bundlePath);
  } catch {
    const result = spawnSync(process.execPath, [builderPath], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`failed to build production runtime helper: ${result.stderr || result.stdout}`);
    }
  }
  return import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`);
}

const module = await ensureBundle();
export const createHorsepowerRuntime = module.createHorsepowerRuntime;
export const parseOpenSpecTaskInventory = module.parseOpenSpecTaskInventory;
