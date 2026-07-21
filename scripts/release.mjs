import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRelease } from "../dist/release/release-builder.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const version = process.argv[2] ?? packageJson.version;
const outputDir = resolve(repositoryRoot, process.argv[3] ?? "release");

const result = await buildRelease({
  repositoryRoot,
  outputDir,
  version,
  runBuild: async () => {},
});

process.stdout.write(`${result.archivePath}\n${result.checksumPath}\n`);
