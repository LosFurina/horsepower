import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { capabilityRejectionError, type CapabilityRejectionError } from "./capability-rejection.js";
import { safePiTools } from "./pi-launch.js";
import type { OneShotInvocation, OneShotResult, OneShotUsage } from "./one-shot.js";

const noDelegationInstruction = [
  "Horsepower worker restriction:",
  "Do not create or invoke subagents, Horsepower, or another Pi process.",
  "Complete only the assigned task directly with the provided tools.",
].join("\n");

export interface PiJsonRunnerOptions {
  executable?: string;
  environment?: NodeJS.ProcessEnv;
  temporaryRoot?: string;
  stderrByteLimit?: number;
  stdoutByteLimit?: number;
  structuredTextByteLimit?: number;
  gracefulShutdownMs?: number;
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams;
}

interface AssistantEventResult {
  text: string;
  usage: OneShotUsage;
  error?: string;
}

function assistantResult(event: Record<string, unknown>): AssistantEventResult | undefined {
  if (event.type !== "message_end") return undefined;
  const message = event.message as Record<string, unknown> | undefined;
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return undefined;
  const text = message.content
    .filter((part): part is { type: "text"; text: string } =>
      part !== null && typeof part === "object" &&
      (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string"
    )
    .map((part) => part.text)
    .join("\n");
  const usage = message.usage as Record<string, unknown> | undefined;
  const cost = usage?.cost as Record<string, unknown> | undefined;
  return {
    text,
    usage: {
      ...(typeof usage?.input === "number" ? { input: usage.input } : {}),
      ...(typeof usage?.output === "number" ? { output: usage.output } : {}),
      ...(typeof cost?.total === "number" ? { totalCost: cost.total } : {}),
    },
    ...(message.stopReason === "error" || message.stopReason === "aborted"
      ? { error: typeof message.errorMessage === "string" ? message.errorMessage : `Assistant ${String(message.stopReason)}` }
      : {}),
  };
}

function addUsage(total: OneShotUsage, next: OneShotUsage): OneShotUsage {
  return {
    ...((total.input !== undefined || next.input !== undefined)
      ? { input: (total.input ?? 0) + (next.input ?? 0) } : {}),
    ...((total.output !== undefined || next.output !== undefined)
      ? { output: (total.output ?? 0) + (next.output ?? 0) } : {}),
    ...((total.totalCost !== undefined || next.totalCost !== undefined)
      ? { totalCost: (total.totalCost ?? 0) + (next.totalCost ?? 0) } : {}),
  };
}

function validateInvocation(invocation: OneShotInvocation): void {
  if (!invocation.modelSlot?.trim()) throw new Error("One-shot modelSlot is required");
  if (!invocation.model?.trim()) throw new Error("One-shot model is required");
  if (!invocation.thinking?.trim()) throw new Error("One-shot thinking is required");
  if (!invocation.task?.trim()) throw new Error("One-shot task is required");
}

export function createPiJsonRunner(options: PiJsonRunnerOptions = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  return async (invocation: OneShotInvocation): Promise<OneShotResult> => {
    validateInvocation(invocation);
    const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "horsepower-one-shot-"));
    await chmod(directory, 0o700);
    const promptPath = join(directory, "prompt.md");
    await writeFile(promptPath, `${invocation.prompt.trim()}\n\n${noDelegationInstruction}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(promptPath, 0o600);
    try {
      const tools = safePiTools(invocation.tools);
      const args = [
        "--mode", "json", "--no-session", "--no-skills",
        "--model", invocation.model,
        "--thinking", invocation.thinking,
        "--append-system-prompt", promptPath,
        ...(tools.length > 0 ? ["--tools", tools.join(",")] : ["--no-tools"]),
        invocation.task,
      ];
      const child = spawnProcess(options.executable ?? "pi", args, {
        cwd: invocation.cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        ...(options.environment ? { env: options.environment } : {}),
      });
      const stdoutLimit = options.stdoutByteLimit ?? 10 * 1024 * 1024;
      const textLimit = options.structuredTextByteLimit ?? 10 * 1024 * 1024;
      const decoder = new StringDecoder("utf8");
      let stdout = "";
      let stderr = Buffer.alloc(0);
      let finalText = "";
      let usage: OneShotUsage = {};
      let assistantError: string | undefined;
      let capabilityRejection: CapabilityRejectionError | undefined;
      let parseError: Error | undefined;

      child.stdout.on("data", (chunk: Buffer | string) => {
        if (parseError) return;
        stdout += decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
        if (Buffer.byteLength(stdout, "utf8") > stdoutLimit && !stdout.includes("\n")) {
          parseError = new Error(`Pi JSON stdout line exceeds ${stdoutLimit} bytes`);
          child.kill("SIGTERM");
          return;
        }
        let newline = stdout.indexOf("\n");
        while (newline >= 0) {
          const line = stdout.slice(0, newline).replace(/\r$/u, "");
          stdout = stdout.slice(newline + 1);
          if (Buffer.byteLength(line, "utf8") > stdoutLimit) {
            parseError = new Error(`Pi JSON stdout line exceeds ${stdoutLimit} bytes`);
            child.kill("SIGTERM");
            return;
          }
          if (line) {
            try {
              const event = JSON.parse(line) as Record<string, unknown>;
              capabilityRejection ??= event.type === "error" ? capabilityRejectionError(event.error) : undefined;
              const result = assistantResult(event);
              if (result) {
                if (Buffer.byteLength(result.text, "utf8") > textLimit) {
                  parseError = new Error(`Pi JSON assistant output exceeds ${textLimit} bytes`);
                  child.kill("SIGTERM");
                  return;
                }
                finalText = result.text;
                usage = addUsage(usage, result.usage);
                assistantError = result.error ?? assistantError;
              }
            } catch (cause) {
              parseError = cause instanceof Error ? cause : new Error(String(cause));
              child.kill("SIGTERM");
              return;
            }
          }
          newline = stdout.indexOf("\n");
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr = Buffer.concat([stderr, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
        stderr = stderr.subarray(-1 * (options.stderrByteLimit ?? 64 * 1024));
      });

      let aborted = invocation.signal?.aborted === true;
      let escalation: NodeJS.Timeout | undefined;
      const abort = () => {
        aborted = true;
        child.kill("SIGTERM");
        escalation = setTimeout(() => child.kill("SIGKILL"), options.gracefulShutdownMs ?? 1000);
      };
      invocation.signal?.addEventListener("abort", abort, { once: true });
      if (aborted) abort();
      const { code, signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      }).finally(() => {
        if (escalation) clearTimeout(escalation);
        invocation.signal?.removeEventListener("abort", abort);
      });

      if (parseError) throw parseError;
      if (aborted) throw new Error("One-shot task aborted");
      if (capabilityRejection) throw capabilityRejection;
      if (assistantError) throw new Error(assistantError);
      if (code !== 0 || signal !== null) {
        throw new Error(`Pi JSON worker failed (code=${code ?? "null"}, signal=${signal ?? "null"}): ${stderr.toString("utf8")}`);
      }
      if (finalText === "" && Object.keys(usage).length === 0) {
        throw new Error("Pi JSON worker exited without an assistant result");
      }
      return {
        name: invocation.name,
        text: finalText,
        ...(Object.keys(usage).length === 0 ? {} : { usage }),
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
}
