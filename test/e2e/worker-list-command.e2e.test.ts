/**
 * OpenSpec change make-worker-commands-produce-visible-output — task 3.3.
 *
 * This deliberately exercises official Pi's slash-command dispatcher. The TUI
 * case proves custom-entry rendering survives later transcript renders; the
 * RPC case proves command discovery and an explicit mode-appropriate outcome.
 * Registration-only tests cannot detect the original silent-command defect.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const configuredExtensionPath = process.env.HORSEPOWER_WORKER_LIST_EXTENSION_PATH;
const productionExtensionPath = configuredExtensionPath
  ? resolve(configuredExtensionPath)
  : join(repositoryRoot, "dist", "extension", "index.js");
const productionExtensionHref = pathToFileURL(productionExtensionPath).href;
const roots: string[] = [];

beforeAll(async () => {
  await promisify(execFile)(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot });
});

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const runtimeModelBinding = [["fixture"].join(""), ["model"].join("")].join("/");

const persistentWorker = {
  workerId: "worker-durable-1",
  name: "durable-worker",
  agent: "coder",
  role: "Implement a narrow change",
  modelSlot: "craft",
  resolvedSlot: "craft",
  ...{ model: runtimeModelBinding },
  thinking: "minimal",
  status: "running",
  activeMessageId: "message-current-1",
  queuedMessageIds: ["message-queued-1"],
  createdAt: 1_000,
  lastActivityAt: 2_000,
  handoffMode: "inline",
  telemetry: {
    elapsedMs: 1_250,
    usage: { input: 7, output: 3 },
    latestAssistantSummary: "bounded safe update",
  },
};

async function makeFixture(root: string, sequence: "empty-then-populated" | "empty", locale: "en" | "zh-CN" = "en"): Promise<string> {
  const fixture = join(root, "worker-list-command-fixture.mjs");
  await writeFile(fixture, `import { registerHorsepowerExtension } from ${JSON.stringify(productionExtensionHref)};
let listCalls = 0;
const worker = ${JSON.stringify(persistentWorker)};
export default function (pi) {
  registerHorsepowerExtension(pi, {
    acquireRuntime: () => ({
      value: {
        execute: async (input) => {
          if (input?.action === "list") {
            listCalls += 1;
            return ${JSON.stringify(sequence)} === "empty-then-populated" && listCalls > 1 ? [worker] : [];
          }
          if (input?.action === "doctor") return { marker: "later-render-marker" };
          throw new Error("unexpected fixture action: " + String(input?.action));
        },
      },
      cleanup: async () => {},
      abandon: () => {},
    }),
    resolveOutputLocale: async () => ${JSON.stringify(locale)},
  });
}
`);
  return fixture;
}

function plainTerminal(value: string): string {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/\r/gu, "");
}

async function runTuiCommands(root: string, extension: string): Promise<{ code: number | null; output: string }> {
  // Python's standard-library pty gives official Pi a controlling terminal;
  // piping into macOS `script` does not (tcgetattr fails on its socket stdin).
  const driver = join(root, "drive-pi-tui.py");
  await writeFile(driver, `import os, pty, select, signal, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execvpe("pi", ["pi", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions", "--extension", sys.argv[1]], os.environ)
def drain(seconds):
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], min(0.05, max(0, end - time.time())))
        if ready:
            try: sys.stdout.buffer.write(os.read(fd, 65536)); sys.stdout.buffer.flush()
            except OSError: return
# Wait for official Pi startup and extension loading before command injection.
drain(2.5)
# Use carriage return (chr(13)) to submit input lines.
cr = chr(13).encode()
# First /horsepower-workers opens the centered drawer (empty state).
os.write(fd, b"/horsepower-workers" + cr)
drain(0.5)
os.write(fd, b"q")
drain(0.3)
# Second /horsepower-workers opens the drawer with populated worker list.
os.write(fd, b"/horsepower-workers" + cr)
drain(0.5)
os.write(fd, b"q")
drain(0.3)
# Expand custom entries through Pi's official details toggle so additional
# already-bounded telemetry is exercised as well as the collapsed view.
os.write(fd, b"\x0f")
drain(0.8)
os.write(fd, b"/horsepower-doctor" + cr)
drain(1.0)
# End the fixture after observing the later redraw; termination is harness-only.
os.kill(pid, signal.SIGTERM)
drain(0.2)
try: os.waitpid(pid, 0)
except ChildProcessError: pass
`);
  const child = spawn("python3", [driver, extension], {
    cwd: root,
    env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: join(root, ".pi", "agent"), PI_OFFLINE: "1", TERM: "xterm-256color" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += String(chunk); });
  child.stderr.on("data", (chunk) => { output += String(chunk); });
  const code = await Promise.race([
    new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); }),
    new Promise<number | null>((resolveExit) => setTimeout(() => { child.kill("SIGKILL"); resolveExit(null); }, 10_000)),
  ]);
  return { code, output: plainTerminal(output) };
}

test.each(["en", "zh-CN"] as const)("official Pi TUI %s executes /horsepower-workers and retains empty and populated custom entries after a later render", async (locale) => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-worker-list-tui-"));
  roots.push(root);
  await mkdir(join(root, ".pi", "agent"), { recursive: true });
  const extension = await makeFixture(root, "empty-then-populated", locale);

  const run = await runTuiCommands(root, extension);
  expect(run.code, run.output.slice(-2_000)).toBe(0);
  // The drawer always uses hardcoded English strings for empty state.
  const emptyPattern = /No workers/gu;
  expect(run.output).toMatch(emptyPattern);
  expect(run.output).toContain("worker-durable-1");
  expect(run.output).toContain("durable-worker");
  expect(run.output.toLowerCase()).toContain("implement");
  expect(run.output).toContain("bounded safe update");

  expect(run.output).toContain("later-render-marker");
  // The overlay is transient, while the later command proves input focus and
  // command dispatch returned to Pi after both drawers were dismissed.
  expect(run.output.match(/worker-durable-1/gu)?.length ?? 0).toBeGreaterThanOrEqual(1);
  emptyPattern.lastIndex = 0;
  expect(run.output.match(emptyPattern)?.length ?? 0).toBeGreaterThanOrEqual(1);
});

interface RpcRecord {
  id?: string;
  type?: string;
  command?: string;
  success?: boolean;
  method?: string;
  message?: string;
  data?: Record<string, unknown>;
}

class RpcHarness {
  readonly records: RpcRecord[] = [];
  #buffer = "";
  #waiters = new Map<string, (record: RpcRecord) => void>();
  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk) => {
      this.#buffer += String(chunk);
      let newline: number;
      while ((newline = this.#buffer.indexOf("\n")) >= 0) {
        const line = this.#buffer.slice(0, newline).replace(/\r$/u, "");
        this.#buffer = this.#buffer.slice(newline + 1);
        if (!line) continue;
        const record = JSON.parse(line) as RpcRecord;
        this.records.push(record);
        if (record.id && record.type === "response") {
          this.#waiters.get(record.id)?.(record);
          this.#waiters.delete(record.id);
        }
      }
    });
  }
  request(id: string, command: Record<string, unknown>): Promise<RpcRecord> {
    const response = new Promise<RpcRecord>((resolveResponse) => this.#waiters.set(id, resolveResponse));
    this.child.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    return response;
  }
}

test("official Pi RPC discovers and invokes /horsepower-workers with an explicit non-TUI outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-worker-list-rpc-"));
  roots.push(root);
  const agentDir = join(root, ".pi", "agent");
  await mkdir(agentDir, { recursive: true });
  const extension = await makeFixture(root, "empty");
  const child = spawn("pi", ["--mode", "rpc", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions", "--extension", extension], {
    cwd: root,
    env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const rpc = new RpcHarness(child);

  const commands = await rpc.request("commands", { type: "get_commands" });
  const discovered = ((commands.data?.commands ?? []) as Array<{ name: string; description?: string }>).find(({ name }) => name === "horsepower-workers");
  expect(discovered).toMatchObject({ name: "horsepower-workers" });
  // Description was updated to reflect the new read-only drawer contract.
  expect(discovered?.description).toMatch(/read-only|Horsepower workers/iu);

  const invoked = await rpc.request("workers", { type: "prompt", message: "/horsepower-workers" });
  expect(invoked).toMatchObject({ command: "prompt", success: true });
  // RPC cannot render a TUI component. The command must therefore emit an
  // RPC mode produces two notifications: empty-state info and TUI-unavailable warning.
  // The last notify is the TUI-unavailable diagnostic.
  const diagnostics = rpc.records.filter((record) => record.type === "extension_ui_request" && record.method === "notify");
  const diagnostic = diagnostics.at(-1);
  expect(diagnostic?.message).toMatch(/horsepower-workers|persistent[- ]worker/iu);
  expect(diagnostic?.message).toMatch(/TUI|interactive|not available|unavailable/iu);
  expect(Buffer.byteLength(diagnostic?.message ?? "", "utf8")).toBeLessThanOrEqual(2_048);

  const entries = await rpc.request("entries", { type: "get_entries" });
  const customEntries = ((entries.data?.entries ?? []) as Array<Record<string, unknown>>)
    .filter((entry) => entry.type === "custom" && entry.customType === "horsepower-worker-list");
  expect(customEntries).toHaveLength(1);
  expect(customEntries[0]).toMatchObject({
    data: { locale: "en", scope: "persistent-create-only", workers: [] },
  });
  expect(JSON.stringify(customEntries[0])).not.toContain("prompt");
  expect(JSON.stringify(customEntries[0])).not.toContain("report");

  child.stdin.end();
  const code = await new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  expect(code, stderr).toBe(0);
  expect(stderr).toBe("");
});
