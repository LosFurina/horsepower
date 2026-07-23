#!/usr/bin/env node
import { createInterface } from "node:readline";

const history = [];
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
function send(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
for await (const line of lines) {
  if (!line.trim()) continue;
  const request = JSON.parse(line);
  if (request.type === "get_state") {
    send({ id: request.id, type: "response", command: "get_state", success: true, data: { state: "idle" } });
    continue;
  }
  if (request.type === "prompt") {
    history.push(request.message);
    send({ id: request.id, type: "response", command: "prompt", success: true });
    const text = history.length === 1 ? `remembered:${history[0]}` : `prior:${history[0]};current:${history[1]}`;
    send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop", usage: { input: history.length, output: history.length * 2 } } });
    send({ type: "agent_end", messages: [] });
    continue;
  }
  if (request.type === "abort") {
    send({ id: request.id, type: "response", command: "abort", success: true });
    continue;
  }
  send({ id: request.id, type: "response", command: request.type, success: false, error: "unsupported" });
}
