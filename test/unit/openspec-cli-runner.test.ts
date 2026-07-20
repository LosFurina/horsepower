import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, test } from "vitest";

class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
}

test("returns a not-found result instead of leaking spawn ENOENT", async () => {
  const child = new FakeChild();
  const { createOpenSpecCliRunner } = await import("../../src/openspec/cli-runner.js");
  const run = createOpenSpecCliRunner({
    spawnProcess: () => {
      queueMicrotask(() => child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })));
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run(["--version"], { cwd: "/project" })).resolves.toMatchObject({
    code: 127,
    stderr: "OpenSpec CLI not found",
  });
});

test("runs the official OpenSpec CLI with shell disabled and bounded output", async () => {
  const child = new FakeChild();
  const invocations: unknown[] = [];
  const { createOpenSpecCliRunner } = await import("../../src/openspec/cli-runner.js").catch(() => ({
    createOpenSpecCliRunner: undefined,
  }));
  const run = createOpenSpecCliRunner?.({
    stdoutByteLimit: 100,
    spawnProcess: (command, args, options) => {
      invocations.push({ command, args, options });
      queueMicrotask(() => {
        child.stdout.write("x".repeat(101));
        child.emit("close", 0, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(run?.(["doctor", "--json"], { cwd: "/project" })).resolves.toEqual({
    code: 0,
    stdout: "x".repeat(100),
    stderr: "",
    truncated: true,
  });
  expect(invocations).toEqual([{
    command: "openspec",
    args: ["doctor", "--json"],
    options: { cwd: "/project", shell: false, stdio: ["pipe", "pipe", "pipe"] },
  }]);
});
