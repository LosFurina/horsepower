import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { CapabilityProbeObservation, CapabilityProbeResult, ModelCapabilityProbe } from "./model-capability-probe.js";
import { classifyCapabilityProbe } from "./model-capability-probe.js";

export const PI_CAPABILITY_PROBE_PROMPT = "Reply with OK.";

export interface PiCapabilityProbeOptions {
  executable?: string;
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  outputByteLimit?: number;
  evidenceByteLimit?: number;
  gracefulShutdownMs?: number;
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams;
}

interface StructuredPiError {
  kind?: unknown;
  parameter?: unknown;
  rejectedValue?: unknown;
  acceptedValues?: unknown;
  acceptedValuesAuthoritative?: unknown;
  code?: unknown;
}

const credentialPattern = /((?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/giu;

function signalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function boundedEvidence(value: string, byteLimit: number): string {
  const redacted = value.replaceAll(credentialPattern, "$1[REDACTED]");
  const bytes = Buffer.from(redacted, "utf8");
  if (bytes.length <= byteLimit) return redacted;
  let start = bytes.length - byteLimit;
  while (start < bytes.length && (bytes[start] ?? 0) >> 6 === 2) start += 1;
  return bytes.subarray(start).toString("utf8");
}

function errorObservation(event: Record<string, unknown>): CapabilityProbeObservation | undefined {
  if (event.type !== "error" || event.error === null || typeof event.error !== "object") return undefined;
  const error = event.error as StructuredPiError;
  if (error.kind === "capability_rejection" && error.parameter === "thinking") {
    return {
      kind: "capability-rejection",
      ...(typeof error.code === "string" ? { code: error.code } : {}),
      ...(typeof error.rejectedValue === "string" ? { rejectedValue: error.rejectedValue } : {}),
      ...(Array.isArray(error.acceptedValues) && error.acceptedValues.every((value) => typeof value === "string")
        ? { acceptedValues: error.acceptedValues as string[] } : {}),
      ...(error.acceptedValuesAuthoritative === true ? { acceptedValuesAuthoritative: true } : {}),
    };
  }
  return { kind: "failure", category: "unknown", ...(typeof error.code === "string" ? { code: error.code } : {}) };
}

function successfulMessage(event: Record<string, unknown>): boolean {
  if (event.type !== "message_end" || event.message === null || typeof event.message !== "object") return false;
  const message = event.message as Record<string, unknown>;
  return message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted";
}

export function createPiCapabilityProbe(options: PiCapabilityProbeOptions = {}): ModelCapabilityProbe {
  const spawnProcess = options.spawnProcess ?? spawn;
  return {
    async probe(request): Promise<CapabilityProbeResult> {
      if (signalAborted(request.signal)) {
        return { status: "inconclusive", evidence: { code: "aborted" } };
      }
      const outputLimit = options.outputByteLimit ?? 64 * 1024;
      const evidenceLimit = options.evidenceByteLimit ?? 1024;
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawnProcess(options.executable ?? "pi", [
          "--mode", "json", "--no-session", "--no-skills", "--no-tools",
          "--model", request.model, "--thinking", request.thinking,
          PI_CAPABILITY_PROBE_PROMPT,
        ], {
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          ...(options.environment ? { env: options.environment } : {}),
        });
      } catch {
        return { status: "inconclusive", evidence: { code: "transport" } };
      }

      const decoder = new StringDecoder("utf8");
      let stdout = "";
      let stderr = Buffer.alloc(0);
      let outputBytes = 0;
      let observation: CapabilityProbeObservation | undefined;
      let forcedCode: "aborted" | "timeout" | "output_limit" | undefined;
      let escalation: NodeJS.Timeout | undefined;
      let settled = false;

      const closedPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child.once("error", (cause: Error) => {
          if (!settled) {
            settled = true;
            observation = { kind: "failure", category: "transport", code: cause.name || "transport" };
            resolve({ code: null, signal: null });
          }
        });
        child.once("close", (code, signal) => {
          if (!settled) {
            settled = true;
            resolve({ code, signal });
          }
        });
      });
      const terminate = (code: typeof forcedCode) => {
        if (forcedCode) return;
        forcedCode = code;
        child.kill("SIGTERM");
        if (!settled) escalation = setTimeout(() => child.kill("SIGKILL"), options.gracefulShutdownMs ?? 1000);
      };
      const abort = () => terminate("aborted");
      request.signal?.addEventListener("abort", abort, { once: true });
      if (signalAborted(request.signal)) abort();
      const timeout = setTimeout(() => terminate("timeout"), options.timeoutMs ?? 15_000);

      const account = (chunk: Buffer | string): Buffer => {
        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        outputBytes += bytes.length;
        if (outputBytes > outputLimit) terminate("output_limit");
        return bytes;
      };
      child.stdout.on("data", (chunk: Buffer | string) => {
        if (forcedCode) return;
        stdout += decoder.write(account(chunk));
        let newline = stdout.indexOf("\n");
        while (newline >= 0 && !forcedCode) {
          const line = stdout.slice(0, newline).replace(/\r$/u, "");
          stdout = stdout.slice(newline + 1);
          if (line) {
            try {
              const event = JSON.parse(line) as Record<string, unknown>;
              observation = errorObservation(event) ?? (successfulMessage(event) ? { kind: "success", code: "completed" } : observation);
            } catch {
              observation = { kind: "failure", category: "malformed-response", code: "malformed_response" };
            }
          }
          newline = stdout.indexOf("\n");
        }
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        const bytes = account(chunk);
        stderr = Buffer.concat([stderr, bytes]).subarray(-evidenceLimit * 2);
      });

      const closed = await closedPromise.finally(() => {
        clearTimeout(timeout);
        if (escalation) clearTimeout(escalation);
        request.signal?.removeEventListener("abort", abort);
      });

      if (forcedCode) return { status: "inconclusive", evidence: { code: forcedCode } };
      if (observation?.kind === "success" && (closed.code !== 0 || closed.signal !== null)) {
        observation = { kind: "failure", category: "unknown", code: "process_failed" };
      }
      const classified = classifyCapabilityProbe(request, observation ?? {
        kind: "failure",
        category: closed.code === 0 && closed.signal === null ? "malformed-response" : "unknown",
        code: closed.code === 0 && closed.signal === null ? "missing_result" : "process_failed",
      });
      if (classified.status !== "inconclusive") {
        const detail = classified.status === "unsupported" ? `thinking=${request.thinking}` : undefined;
        return { ...classified, evidence: { ...classified.evidence, ...(detail ? { detail } : {}) } };
      }
      const detail = boundedEvidence(stderr.toString("utf8"), evidenceLimit);
      return { ...classified, evidence: { ...classified.evidence, ...(detail ? { detail } : {}) } };
    },
  };
}
