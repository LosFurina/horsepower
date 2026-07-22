import { open, readFile } from "node:fs/promises";
import { fstatSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { createCli } from "./app.js";
import { createOpenSpecCliRunner } from "../openspec/cli-runner.js";
import { createPiModelCatalog, parsePiListModelRows } from "../capabilities/model-catalog.js";
import { createPiCapabilityProbe } from "../runtime/pi-capability-probe.js";
import { createSetupTerminal } from "./terminal.js";
import { getAgentDir, hasTrustRequiringProjectResources, ProjectTrustStore, resolveModelScope, SettingsManager } from "../capabilities/pi-model-registry.js";

const execFileAsync = promisify(execFile);

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

async function verifiedInstallerContext(): Promise<boolean> {
  const descriptorText = process.env.HORSEPOWER_INSTALLER_CONTEXT_FD;
  const expectedNonce = process.env.HORSEPOWER_INSTALLER_NONCE;
  if (!descriptorText || !/^\d+$/u.test(descriptorText) || !expectedNonce) return false;
  try {
    const descriptor = Number(descriptorText);
    if (!Number.isSafeInteger(descriptor) || descriptor < 3 || descriptor > 64 || !fstatSync(descriptor).isFIFO()) return false;
    const proof = JSON.parse(readFileSync(descriptor, "utf8")) as { nonce?: unknown; parentPid?: unknown };
    return typeof proof.nonce === "string" && proof.nonce.length >= 32 && proof.nonce === expectedNonce
      && proof.parentPid === process.ppid;
  } catch { return false; }
}

const interactive = Boolean((process.stdin.isTTY && process.stderr.isTTY) || process.platform !== "win32");
async function loadModelCatalog() {
  try {
    const { stdout } = await execFileAsync("pi", ["--list-models"], { cwd: process.cwd(), encoding: "utf8" });
    const agentDir = getAgentDir();
    const declaredMaps = new Map<string, Record<string, string | null>>();
    try {
      const document = JSON.parse(await readFile(join(agentDir, "models.json"), "utf8")) as { providers?: Record<string, { models?: Array<{ id?: unknown; thinkingLevelMap?: unknown }> }> };
      for (const [provider, definition] of Object.entries(document.providers ?? {})) {
        for (const model of definition.models ?? []) {
          if (typeof model.id === "string" && model.thinkingLevelMap && typeof model.thinkingLevelMap === "object") {
            declaredMaps.set(`${provider}/${model.id}`, model.thinkingLevelMap as Record<string, string | null>);
          }
        }
      }
    } catch { /* Built-in models may have no user declaration; exact support remains unverified. */ }
    const models = parsePiListModelRows(stdout).map((model) => {
      const thinkingLevelMap = declaredMaps.get(`${model.provider}/${model.id}`);
      return thinkingLevelMap ? { ...model, thinkingLevelMap } : model;
    });
    let selected = models;
    try {
      const cwd = process.cwd();
      const projectTrusted = !hasTrustRequiringProjectResources(cwd) || new ProjectTrustStore(agentDir).get(cwd) === true;
      const enabledModels = SettingsManager.create(cwd, agentDir, { projectTrusted }).getEnabledModels();
      if (enabledModels && enabledModels.length > 0) {
        const scoped = (await resolveModelScope([...enabledModels], { getAvailable: async () => models } as never)).map(({ model }) => model);
        if (scoped.length > 0) selected = scoped;
      }
    } catch { /* Optional scope filtering cannot erase an established current Pi catalog. */ }
    return createPiModelCatalog({ getAll: () => selected });
  } catch {
    return { status: "unavailable" as const, reason: "registry-error" as const };
  }
}
const terminal = createSetupTerminal();
const cli = createCli({
  homeDir: homedir(),
  cwd: process.cwd(),
  platform: process.platform,
  runOpenSpec: createOpenSpecCliRunner(),
  interactive,
  confirm,
  loadModelCatalog,
  capabilityProbe: createPiCapabilityProbe(),
  terminal,
  configurationTerminal: terminal,
  installerContext: await verifiedInstallerContext(),
});
const result = await cli.run(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
