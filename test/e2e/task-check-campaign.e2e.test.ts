import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, expect, test } from "vitest";
import { selectedE2ELocales } from "../fixtures/e2e-locales.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const extensionHref = pathToFileURL(join(repositoryRoot, "dist", "extension", "index.js")).href;
const roots: string[] = [];
beforeAll(async () => { await import("node:child_process").then(({ execFile }) => new Promise<void>((done, reject) => execFile(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot }, (error) => error ? reject(error) : done()))); });
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function run(locale: "en" | "zh-CN", confirm: boolean) {
  const root = await mkdtemp(join(tmpdir(), "horsepower-task-check-")); roots.push(root);
  const agentDir = join(root, ".pi", "agent"); await mkdir(agentDir, { recursive: true });
  const extension = join(root, "fixture.mjs");
  await writeFile(extension, `import { registerHorsepowerExtension } from ${JSON.stringify(extensionHref)};
export default function(pi) {
  registerHorsepowerExtension(pi, {
    acquireRuntime: () => ({ value: {
      execute: async () => [],
      discoverImplementationChanges: async () => [{ changeId: "strict-valid-change", completedTasks: 0, totalTasks: 2 }],
      loadImplementationTaskInventory: async () => ({ changeId: "strict-valid-change", projectRoot: process.cwd(), digest: "${"a".repeat(64)}", sections: [{ id: "1", title: "Work", tasks: [
        { id: "1.1", description: "Implement behavior", status: "pending", sectionId: "1", checks: ["Run focused integration test"] },
        { id: "1.2", description: "Document behavior", status: "pending", sectionId: "1", checks: [] }
      ] }] }),
      beginImplementationCampaign: async (input) => ({ campaignId: "campaign-task-check", ...input }),
    }, cleanup: async () => {}, abandon: () => {} }),
    resolveOutputLocale: async () => ${JSON.stringify(locale)},
  });
}`);
  const child = spawn("pi", ["--mode", "rpc", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions", "--extension", extension], {
    cwd: root, env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const events: any[] = []; let stderr = ""; child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const event = JSON.parse(line); events.push(event);
    if (event.type === "extension_ui_request") {
      if (event.method === "select") child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, value: event.options[0] })}\n`);
      if (event.method === "input") child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, value: "Run focused tests and available E2E" })}\n`);
      if (event.method === "confirm") child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: confirm })}\n`);
    }
    if (event.type === "response" && event.id === "campaign") child.stdin.end();
  });
  child.stdin.write(`${JSON.stringify({ id: "campaign", type: "prompt", message: "/horsepower-campaign" })}\n`);
  const code = await new Promise<number | null>((done, reject) => { child.once("error", reject); child.once("close", done); });
  return { code, stderr, text: JSON.stringify(events) };
}

test.each(selectedE2ELocales())("production campaign confirms task checks and free-form intensity in %s", async (locale) => {
  const accepted = await run(locale, true);
  expect(accepted.code).toBe(0); expect(accepted.stderr).toBe("");
  for (const token of ["strict-valid-change", "1.1", "Run focused integration test", "Run focused tests and available E2E", "campaign-task-check"]) expect(accepted.text).toContain(token);
  expect(accepted.text).not.toContain("testIntensity"); expect(accepted.text).not.toContain("gateStrictness"); expect(accepted.text).not.toContain("planDigest");
  const canceled = await run(locale, false);
  expect(canceled.text).not.toContain("campaign-task-check");
});
