#!/usr/bin/env node
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

const statePath = process.env.HORSEPOWER_FIXTURE_STATE;
const logPath = process.env.HORSEPOWER_FIXTURE_LOG;
if (!statePath || !logPath) throw new Error("Local capability fixture paths are required");

const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const thinking = valueAfter("--thinking");
const mode = valueAfter("--mode");
const state = JSON.parse(await readFile(statePath, "utf8"));
const accepted = Array.isArray(state.acceptedThinking) && state.acceptedThinking.includes(thinking);
const rejection = {
  kind: "capability_rejection",
  parameter: "thinking",
  rejectedValue: thinking,
  acceptedValues: state.acceptedThinking,
  acceptedValuesAuthoritative: true,
  code: "INVALID_THINKING",
};
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const record = async (kind) => appendFile(logPath, `${JSON.stringify({ kind, thinking })}\n`);

if (mode === "json") {
  const probe = !args.includes("--append-system-prompt");
  await record(probe ? "probe" : "one-shot");
  const rejectWorker = !probe && state.rejectNextOneShot === true;
  if (rejectWorker) {
    state.rejectNextOneShot = false;
    await writeFile(statePath, JSON.stringify(state));
  }
  if (!accepted || rejectWorker) {
    send({ type: "error", error: rejection });
    process.exitCode = 1;
  } else {
    send({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: probe ? "OK" : "fixture completed" }],
        stopReason: "stop",
        usage: { input: 1, output: 1 },
      },
    });
  }
} else if (mode === "rpc") {
  await record("persistent");
  const rejectWorker = state.rejectNextPersistent === true;
  if (rejectWorker) {
    state.rejectNextPersistent = false;
    await writeFile(statePath, JSON.stringify(state));
  }
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const request = JSON.parse(line);
    if (request.type === "get_state") {
      if (!accepted || rejectWorker) send({ id: request.id, type: "response", command: "get_state", success: false, error: rejection });
      else send({ id: request.id, type: "response", command: "get_state", success: true, data: { state: "idle" } });
      continue;
    }
    if (request.type === "prompt") {
      send({ id: request.id, type: "response", command: "prompt", success: true });
      send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "fixture completed" }], stopReason: "stop" } });
      send({ type: "agent_end", messages: [] });
      continue;
    }
    if (request.type === "abort") {
      send({ id: request.id, type: "response", command: "abort", success: true });
      continue;
    }
    send({ id: request.id, type: "response", command: request.type, success: false, error: "unsupported request" });
  }
} else {
  throw new Error(`Unsupported local fixture mode: ${String(mode)}`);
}
