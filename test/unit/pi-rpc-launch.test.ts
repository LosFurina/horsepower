import { expect, test } from "vitest";

test("builds a shell-free persistent Pi launch and removes delegation tools", async () => {
  const module = await import("../../src/runtime/pi-launch.js").catch(() => undefined);

  expect(module?.buildPersistentPiLaunch({
    executable: "/usr/local/bin/pi",
    model: "provider/model",
    thinking: "high",
    promptFile: "/private/prompt.md",
    tools: ["read", "bash", "horsepower", "horsepower_subagent", "subagent"],
  })).toEqual({
    command: "/usr/local/bin/pi",
    args: [
      "--mode", "rpc",
      "--no-session",
      "--model", "provider/model",
      "--thinking", "high",
      "--append-system-prompt", "/private/prompt.md",
      "--tools", "read,bash",
    ],
    options: {
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    },
  });
});

test("rejects non-canonical tool entries that could smuggle delegation", async () => {
  const { buildPersistentPiLaunch } = await import("../../src/runtime/pi-launch.js");
  const base = {
    executable: "pi",
    model: "provider/model",
    thinking: "off" as const,
    promptFile: "/private/prompt.md",
  };

  expect(() => buildPersistentPiLaunch({ ...base, tools: ["read,horsepower_subagent"] }))
    .toThrow("Invalid Pi tool name: read,horsepower_subagent");
  expect(() => buildPersistentPiLaunch({ ...base, tools: [" horsepower_subagent"] }))
    .toThrow("Invalid Pi tool name:  horsepower_subagent");
});

test("uses no-tools when every explicitly allowed tool is excluded", async () => {
  const { buildPersistentPiLaunch } = await import("../../src/runtime/pi-launch.js");

  expect(buildPersistentPiLaunch({
    executable: "pi",
    model: "provider/model",
    thinking: "off",
    promptFile: "/private/prompt.md",
    tools: ["subagent"],
  }).args).toContain("--no-tools");
});
