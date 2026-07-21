import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createHandoffStore } from "../../src/handoffs/store.js";
import { createRunLifecycle } from "../../src/lifecycle/run-lifecycle.js";
import { createWebhookNotifier } from "../../src/lifecycle/webhook-notifier.js";
import { selectedE2ELocales } from "../fixtures/e2e-locales.js";

const roots: string[] = [];

test("locale-sensitive E2E uses the selected CI locale or both locales locally", () => {
  expect(selectedE2ELocales({})).toEqual(["en", "zh-CN"]);
  expect(selectedE2ELocales({ HORSEPOWER_E2E_LOCALE: "en" })).toEqual(["en"]);
  expect(selectedE2ELocales({ HORSEPOWER_E2E_LOCALE: "zh-CN" })).toEqual(["zh-CN"]);
  expect(() => selectedE2ELocales({ HORSEPOWER_E2E_LOCALE: "fr" })).toThrow("HORSEPOWER_E2E_LOCALE");
});
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

test("managed brief/report survives a new store instance and remains until explicit cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-handoff-e2e-")); roots.push(root);
  const projectPath = join(root, "project");
  const first = createHandoffStore({ stateRoot: root });
  const created = await first.create({ projectPath, runId: "run-retained", brief: "English implementation brief", producer: { kind: "captain", id: "captain" } });
  await writeFile(created.worker.reportPath, "English worker report", { mode: 0o600 });
  const reference = await first.validateReport({ projectPath, runId: "run-retained", producer: { kind: "worker", id: "worker" } });
  expect(reference).not.toHaveProperty("path");
  const afterRestart = createHandoffStore({ stateRoot: root });
  expect(await afterRestart.inspect({ projectPath, runId: "run-retained" })).toMatchObject({ terminal: { status: "completed", reportPresent: true }, report: { path: "report.md" } });
  expect(await readFile(created.worker.reportPath, "utf8")).toBe("English worker report");
  await afterRestart.clean({ projectPath, runId: "run-retained" });
  expect(await afterRestart.list({ projectPath })).toEqual([]);
});

test("Captain completion gate rejects unit-only completion and a real receiver gets English and Chinese terminal webhooks", async () => {
  const received: Array<Record<string, unknown>> = [];
  const server = createServer((request, response) => {
    let body = ""; request.setEncoding("utf8"); request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => { received.push(JSON.parse(body)); response.writeHead(204); response.end(); });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("receiver did not bind");
  const notifier = createWebhookNotifier({ config: { url: `http://127.0.0.1:${address.port}/terminal`, auth: { mode: "none" } }, retryDelaysMs: [] });
  const lifecycle = createRunLifecycle({ notifications: { change: true } });
  const english = lifecycle.beginChange({ changeId: "change-english", projectId: "project-public" }, { enabled: true, outputLocale: "en", notify: notifier.notify });
  await lifecycle.reportChangeTerminal({ runId: english.runId, status: "completed", summary: "English internal completion", evidence: { e2e: [{ command: "npm run test:e2e", exitCode: 0, summary: "passed" }] } });
  await lifecycle.waitForDelivery(english.runId);
  const run = lifecycle.beginChange({ changeId: "change-public", projectId: "project-public" }, { enabled: true, outputLocale: "zh-CN", notify: notifier.notify });
  await expect(lifecycle.reportChangeTerminal({ runId: run.runId, status: "completed", summary: "English internal completion", evidence: { unit: [{ command: "npm test", exitCode: 0, summary: "passed" }] } })).rejects.toThrow("E2E evidence");
  expect(lifecycle.status(run.runId).status).toBe("running");
  await lifecycle.reportChangeTerminal({ runId: run.runId, status: "completed", summary: "English internal completion", evidence: { e2e: [{ command: "npm run test:e2e", exitCode: 0, summary: "passed" }] }, evidenceRefs: ["artifact-public"] });
  await expect(lifecycle.waitForDelivery(run.runId)).resolves.toMatchObject({ delivered: true });
  expect(received).toHaveLength(2);
  expect(received[0]).toMatchObject({ scope: "change", status: "completed", outputLocale: "en", summary: "change completed." });
  expect(received[1]).toMatchObject({ scope: "change", status: "completed", outputLocale: "zh-CN", summary: "change 已完成。" });
  expect(JSON.stringify(received)).not.toContain("English internal completion");
  notifier.abandon(); await lifecycle.shutdown(); await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});
