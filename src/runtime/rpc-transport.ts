import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";

export interface RpcResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface RpcTransportStreams {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
}

export interface RpcTransport {
  request(type: string, payload?: Readonly<Record<string, unknown>>): Promise<RpcResponse>;
  close(cause?: Error): void;
  stderrText(): string;
}

export interface RpcTransportOptions {
  onEvent?: (event: Readonly<Record<string, unknown>>) => void;
}

interface PendingRequest {
  resolve: (response: RpcResponse) => void;
  reject: (cause: Error) => void;
}

const stderrLimit = 64 * 1024;

export function createRpcTransport(
  streams: RpcTransportStreams,
  options: RpcTransportOptions = {},
): RpcTransport {
  const pending = new Map<string, PendingRequest>();
  const decoder = new StringDecoder("utf8");
  let stdoutBuffer = "";
  let stderrBuffer = Buffer.alloc(0);
  let closed: Error | undefined;

  function rejectAll(cause: Error): void {
    if (closed) return;
    closed = cause;
    for (const request of pending.values()) request.reject(cause);
    pending.clear();
  }

  function consumeLine(line: string): void {
    if (!line) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      rejectAll(new Error("Malformed JSON received from Pi RPC stdout"));
      return;
    }
    if (value === null || typeof value !== "object") return;
    const response = value as Partial<RpcResponse>;
    if (typeof response.id !== "string" || typeof response.success !== "boolean") {
      options.onEvent?.(value as Readonly<Record<string, unknown>>);
      return;
    }
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.success) request.resolve(response as RpcResponse);
    else request.reject(new Error(response.error ?? `Pi RPC request failed: ${response.id}`));
  }

  streams.stdout.on("data", (chunk: Buffer | string) => {
    stdoutBuffer += decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).replace(/\r$/u, "");
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      consumeLine(line);
      newline = stdoutBuffer.indexOf("\n");
    }
  });
  streams.stdout.on("end", () => rejectAll(new Error("Pi RPC stdout ended")));
  streams.stdout.on("close", () => rejectAll(new Error("Pi RPC stdout closed")));
  streams.stdout.on("error", (cause: Error) => rejectAll(cause));
  streams.stdin.on("close", () => rejectAll(new Error("Pi RPC stdin closed")));
  streams.stdin.on("error", (cause: Error) => rejectAll(cause));
  streams.stderr.on("data", (chunk: Buffer | string) => {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    stderrBuffer = Buffer.concat([stderrBuffer, bytes]);
    if (stderrBuffer.length > stderrLimit) stderrBuffer = stderrBuffer.subarray(-stderrLimit);
  });
  streams.stderr.on("end", () => rejectAll(new Error("Pi RPC stderr ended")));
  streams.stderr.on("close", () => rejectAll(new Error("Pi RPC stderr closed")));
  streams.stderr.on("error", (cause: Error) => rejectAll(cause));

  return {
    request(type, payload = {}) {
      if (closed) return Promise.reject(closed);
      const id = randomUUID();
      return new Promise<RpcResponse>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        streams.stdin.write(`${JSON.stringify({ ...payload, id, type })}\n`, (cause) => {
          if (!cause) return;
          pending.delete(id);
          reject(cause);
        });
      });
    },
    close(cause = new Error("Pi RPC transport closed")) {
      rejectAll(cause);
    },
    stderrText() {
      return stderrBuffer.toString("utf8");
    },
  };
}
