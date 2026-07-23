import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";

export interface OpenSpecCliRunnerOptions {
  executable?: string;
  stdoutByteLimit?: number;
  stderrByteLimit?: number;
  timeoutMs?: number;
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams;
}

function appendBounded(current: Buffer, chunk: Buffer, limit: number): { value: Buffer; truncated: boolean } {
  const combined = Buffer.concat([current, chunk]);
  return combined.length <= limit
    ? { value: combined, truncated: false }
    : { value: combined.subarray(0, limit), truncated: true };
}

export function createOpenSpecCliRunner(options: OpenSpecCliRunnerOptions = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  const stdoutLimit = options.stdoutByteLimit ?? 1024 * 1024;
  const stderrLimit = options.stderrByteLimit ?? 64 * 1024;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return async (args: readonly string[], context: { cwd: string }) => {
    const child = spawnProcess(options.executable ?? "openspec", args, {
      cwd: context.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end();
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;
    child.stdout.on("data", (chunk: Buffer | string) => {
      const result = appendBounded(stdout, typeof chunk === "string" ? Buffer.from(chunk) : chunk, stdoutLimit);
      stdout = result.value;
      truncated ||= result.truncated;
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = appendBounded(stderr, typeof chunk === "string" ? Buffer.from(chunk) : chunk, stderrLimit).value;
    });
    const { code, notFound, timedOut } = await new Promise<{ code: number; notFound?: true; timedOut?: true }>((resolve, reject) => {
      let settled = false;
      const finish = (result: { code: number; notFound?: true; timedOut?: true }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({ code: 124, timedOut: true });
      }, timeoutMs);
      child.once("error", (cause: NodeJS.ErrnoException) => {
        if (cause.code === "ENOENT") finish({ code: 127, notFound: true });
        else { clearTimeout(timer); reject(cause); }
      });
      child.once("close", (code) => finish({ code: code ?? 1 }));
    });
    if (notFound) {
      return { code: 127, stdout: "", stderr: "OpenSpec CLI not found", truncated: false };
    }
    return {
      code,
      stdout: stdout.toString("utf8"),
      stderr: stderr.toString("utf8"),
      truncated,
      ...(timedOut ? { timedOut: true } : {}),
    };
  };
}
