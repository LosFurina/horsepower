import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPersistentPiLaunch } from "./pi-launch.js";
import type { WorkerConnection, WorkerLaunchInput } from "./persistent-manager.js";
import { createRpcTransport } from "./rpc-transport.js";

export interface PersistentWorkerStarterOptions {
  executable?: string;
  environment?: NodeJS.ProcessEnv;
  temporaryRoot?: string;
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams;
}

export function createPersistentWorkerStarter(options: PersistentWorkerStarterOptions = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  return async (input: WorkerLaunchInput): Promise<WorkerConnection> => {
    const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "horsepower-worker-"));
    await chmod(directory, 0o700);
    const promptPath = join(directory, "prompt.md");
    await writeFile(promptPath, input.prompt, { encoding: "utf8", mode: 0o600 });
    await chmod(promptPath, 0o600);

    try {
      const launch = buildPersistentPiLaunch({
        executable: options.executable ?? "pi",
        model: input.model,
        thinking: input.thinking,
        promptFile: promptPath,
        tools: input.tools,
      });
      const child = spawnProcess(
        launch.command,
        launch.args,
        {
          ...launch.options,
          cwd: input.cwd,
          ...(options.environment ? { env: options.environment } : {}),
        },
      ) as ChildProcessWithoutNullStreams;
      const emitter = new EventEmitter();
      const transport = createRpcTransport(
        { stdin: child.stdin, stdout: child.stdout, stderr: child.stderr },
        { onEvent: (event) => emitter.emit("event", event) },
      );
      child.on("exit", (code, signal) => emitter.emit("exit", code, signal));
      child.on("error", (cause) => transport.close(cause));

      return Object.assign(emitter, {
        request: transport.request,
        kill(signal: NodeJS.Signals) { child.kill(signal); },
        async cleanup() {
          transport.close();
          await rm(directory, { recursive: true, force: true });
        },
      }) as WorkerConnection;
    } catch (cause) {
      await rm(directory, { recursive: true, force: true });
      throw cause;
    }
  };
}
