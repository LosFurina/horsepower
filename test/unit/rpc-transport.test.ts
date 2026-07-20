import { PassThrough } from "node:stream";
import { expect, test } from "vitest";

test("writes LF JSON requests and correlates out-of-order responses", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: string[] = [];
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => written.push(chunk));
  const module = await import("../../src/runtime/rpc-transport.js").catch(() => undefined);
  const transport = module?.createRpcTransport({ stdin, stdout, stderr });

  const first = transport?.request("get_state", { detail: "first" });
  const second = transport?.request("get_state", { detail: "second" });
  const requests = written.join("").trimEnd().split("\n").map((line) => JSON.parse(line));
  stdout.write(`${JSON.stringify({ id: requests[1].id, success: true, data: "second" })}\n`);
  stdout.write(`${JSON.stringify({ id: requests[0].id, success: true, data: "first" })}\n`);

  await expect(first).resolves.toEqual({ id: requests[0].id, success: true, data: "first" });
  await expect(second).resolves.toEqual({ id: requests[1].id, success: true, data: "second" });
  expect(requests).toEqual([
    { id: requests[0].id, type: "get_state", detail: "first" },
    { id: requests[1].id, type: "get_state", detail: "second" },
  ]);
  expect(requests[0].id).not.toBe(requests[1].id);
});

test("frames fragmented UTF-8 responses and emits unrelated Pi events", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: string[] = [];
  const events: unknown[] = [];
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => written.push(chunk));
  const { createRpcTransport } = await import("../../src/runtime/rpc-transport.js");
  const transport = createRpcTransport({ stdin, stdout, stderr }, { onEvent: (event) => events.push(event) });
  const pending = transport.request("get_state");
  const request = JSON.parse(written.join("").trim());
  const event = Buffer.from(`${JSON.stringify({ type: "agent_start", text: "你好" })}\n`);
  const response = Buffer.from(`${JSON.stringify({ id: request.id, success: true, data: "完成" })}\n`);

  stdout.write(event.subarray(0, event.length - 2));
  stdout.write(event.subarray(event.length - 2));
  for (const byte of response) stdout.write(Buffer.from([byte]));

  await expect(pending).resolves.toMatchObject({ data: "完成" });
  expect(events).toEqual([{ type: "agent_start", text: "你好" }]);
});

test("does not let request payload override transport-owned id or type", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const written: string[] = [];
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string) => written.push(chunk));
  const { createRpcTransport } = await import("../../src/runtime/rpc-transport.js");
  const transport = createRpcTransport({ stdin, stdout, stderr });

  const pending = transport.request("get_state", { id: "forged", type: "prompt", detail: true });
  const request = JSON.parse(written.join("").trim());
  stdout.write(`${JSON.stringify({ id: request.id, success: true })}\n`);

  await expect(pending).resolves.toMatchObject({ success: true });
  expect(request).toMatchObject({ type: "get_state", detail: true });
  expect(request.id).not.toBe("forged");
});

test("rejects every pending request after malformed stdout", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const { createRpcTransport } = await import("../../src/runtime/rpc-transport.js");
  const transport = createRpcTransport({ stdin, stdout, stderr });
  const first = transport.request("get_state");
  const second = transport.request("get_state");

  stdout.write("{not-json}\n");

  await expect(first).rejects.toThrow("Malformed JSON received from Pi RPC stdout");
  await expect(second).rejects.toThrow("Malformed JSON received from Pi RPC stdout");
});

test("rejects pending requests when stderr closes", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const { createRpcTransport } = await import("../../src/runtime/rpc-transport.js");
  const transport = createRpcTransport({ stdin, stdout, stderr });
  const pending = transport.request("get_state");

  stderr.destroy();

  await expect(pending).rejects.toThrow("Pi RPC stderr closed");
});

test("rejects pending requests when stderr errors", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const { createRpcTransport } = await import("../../src/runtime/rpc-transport.js");
  const transport = createRpcTransport({ stdin, stdout, stderr });
  const pending = transport.request("get_state");

  stderr.emit("error", new Error("stderr broke"));

  await expect(pending).rejects.toThrow("stderr broke");
});

test("bounds stderr by bytes and rejects pending requests when streams close", async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const { createRpcTransport } = await import("../../src/runtime/rpc-transport.js");
  const transport = createRpcTransport({ stdin, stdout, stderr });
  stderr.write(Buffer.alloc(70 * 1024, "x"));
  const pending = transport.request("get_state");

  stdout.destroy();

  await expect(pending).rejects.toThrow(/Pi RPC stdout (?:ended|closed)/);
  expect(Buffer.byteLength(transport.stderrText())).toBe(64 * 1024);
});
