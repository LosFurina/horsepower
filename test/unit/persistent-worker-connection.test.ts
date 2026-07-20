import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killSignals: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    return true;
  }
}

test("starts a persistent RPC child with a private prompt and cleans resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-connection-test-"));
  roots.push(root);
  const child = new FakeChild();
  const invocations: unknown[] = [];
  const { createPersistentWorkerStarter } = await import("../../src/runtime/persistent-worker-connection.js");
  const start = createPersistentWorkerStarter({
    executable: "/usr/local/bin/pi",
    temporaryRoot: root,
    spawnProcess: (command, args, options) => {
      invocations.push({ command, args, options });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  const connection = await start({
    name: "reviewer-1",
    agent: "reviewer",
    modelSlot: "judgment",
    model: "provider/model",
    thinking: "high",
    cwd: "/project",
    prompt: "Private prompt.",
    tools: ["read"],
  });
  const invocation = invocations[0] as { args: string[]; options: { shell: boolean } };
  const promptPath = invocation.args[invocation.args.indexOf("--append-system-prompt") + 1]!;

  expect(invocation.options.shell).toBe(false);
  expect(await readFile(promptPath, "utf8")).toBe("Private prompt.");
  expect((await stat(promptPath)).mode & 0o777).toBe(0o600);
  await connection.cleanup();
  await expect(stat(promptPath)).rejects.toMatchObject({ code: "ENOENT" });
});
