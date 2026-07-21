import { open } from "node:fs/promises";
import type { Readable, Writable } from "node:stream";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { createCli } from "./app.js";
import { createOpenSpecCliRunner } from "../openspec/cli-runner.js";
import { createPiModelCatalog } from "../capabilities/model-catalog.js";
import { createPiCapabilityProbe } from "../runtime/pi-capability-probe.js";
import { createSetupTerminal } from "./terminal.js";
import { ModelRegistry, ModelRuntime } from "../capabilities/pi-model-registry.js";

async function confirm(message: string): Promise<boolean | undefined> {
  let input: Readable = process.stdin;
  let output: Writable = process.stderr;
  let tty: Awaited<ReturnType<typeof open>> | undefined;
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    try {
      tty = await open("/dev/tty", "r+");
      input = tty.createReadStream({ autoClose: false });
      output = tty.createWriteStream({ autoClose: false });
    } catch {
      return undefined;
    }
  }
  const prompt = createInterface({ input, output });
  try { return (await prompt.question(message)).trim().toLowerCase() === "yes"; }
  finally { prompt.close(); await tty?.close(); }
}

const interactive = Boolean((process.stdin.isTTY && process.stderr.isTTY) || process.platform !== "win32");
let modelCatalog;
try {
  const runtime = await ModelRuntime.create();
  const registry = new ModelRegistry(runtime);
  await registry.refresh();
  modelCatalog = createPiModelCatalog(registry);
} catch {
  modelCatalog = { status: "unavailable" as const, reason: "registry-error" as const };
}
const cli = createCli({
  homeDir: homedir(),
  cwd: process.cwd(),
  platform: process.platform,
  runOpenSpec: createOpenSpecCliRunner(),
  interactive,
  confirm,
  modelCatalog,
  capabilityProbe: createPiCapabilityProbe(),
  terminal: createSetupTerminal(),
});
const result = await cli.run(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
