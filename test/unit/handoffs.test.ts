import { chmod, link, lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "horsepower-handoffs-test-")); roots.push(root);
  const { createHandoffStore } = await import("../../src/handoffs/store.js");
  return { root, store: createHandoffStore({ stateRoot: root }), project: join(root, "project") };
}
const producer = { kind: "captain" as const, id: "captain" };

test("creates private opaque workspace and validates a worker report", async () => {
  const { root, store, project } = await fixture();
  const created = await store.create({ projectPath: project, runId: "run-1", brief: "Do the bounded task.", producer });
  expect(created.reference.projectId).toMatch(/^[a-f0-9]{32}$/u);
  expect(created.reference).not.toHaveProperty("path");
  expect(created.worker.briefPath).toContain(join("handoffs", created.reference.projectId, "run-1", "brief.md"));
  expect((await lstat(join(root, "handoffs"))).mode & 0o777).toBe(0o700);
  expect((await lstat(created.worker.briefPath)).mode & 0o777).toBe(0o600);
  expect((await lstat(created.worker.reportPath)).mode & 0o777).toBe(0o600);
  expect(await readFile(created.worker.reportPath, "utf8")).toBe("");
  await writeFile(created.worker.reportPath, "Completed safely.\n");
  const reference = await store.validateReport({ projectPath: project, runId: "run-1", producer: { kind: "worker", id: "worker-1" } });
  expect(reference).toMatchObject({ artifactId: "report", bytes: 18, mediaType: "text/markdown; charset=utf-8" });
  expect(reference.sha256).toMatch(/^[a-f0-9]{64}$/u);
  expect(reference.summary).toBe("Completed safely.");
  expect(JSON.stringify(reference)).not.toContain(root);
  const manifest = JSON.parse(await readFile(join(root, "handoffs", created.reference.projectId, "run-1", "manifest.json"), "utf8"));
  expect(manifest.report).toMatchObject({ path: "report.md", bytes: 18, producer: { kind: "worker", id: "worker-1" } });
  expect(manifest.terminal).toEqual({ status: "completed", reportPresent: true });
});

test("enforces UTF-8 and exact brief/report byte boundaries", async () => {
  const { store, project } = await fixture();
  await expect(store.create({ projectPath: project, runId: "too-large", brief: "x".repeat(1024 * 1024 + 1), producer })).rejects.toThrow("1 MiB");
  const created = await store.create({ projectPath: project, runId: "boundary", brief: "x".repeat(1024 * 1024), producer });
  await writeFile(created.worker.reportPath, Buffer.from([0xff]), { mode: 0o600 });
  await expect(store.validateReport({ projectPath: project, runId: "boundary", producer: { kind: "worker", id: "w" } })).rejects.toThrow("UTF-8");
});

test("rejects traversal, links, non-regular reports, and cross-project access", async () => {
  const { root, store, project } = await fixture();
  for (const runId of ["../escape", "/absolute", "a/b", "a\\b", "nul\0id"]) {
    await expect(store.create({ projectPath: project, runId, brief: "brief", producer })).rejects.toThrow(/run ID/u);
  }
  const created = await store.create({ projectPath: project, runId: "run-links", brief: "brief", producer });
  await rm(created.worker.reportPath);
  await symlink(join(root, "outside"), created.worker.reportPath);
  await expect(store.validateReport({ projectPath: project, runId: "run-links", producer: { kind: "worker", id: "w" } })).rejects.toThrow(/symbolic link|regular file/u);
  await rm(created.worker.reportPath);
  const outside = join(root, "outside"); await writeFile(outside, "report", { mode: 0o600 }); await link(outside, created.worker.reportPath);
  await expect(store.validateReport({ projectPath: project, runId: "run-links", producer: { kind: "worker", id: "w" } })).rejects.toThrow("hard link");
  await rm(created.worker.reportPath); await mkdir(created.worker.reportPath);
  await expect(store.validateReport({ projectPath: project, runId: "run-links", producer: { kind: "worker", id: "w" } })).rejects.toThrow("regular file");
  await expect(store.inspect({ projectPath: join(root, "other-project"), runId: "run-links" })).rejects.toThrow("Unknown handoff run");
});

test("bounds attachments and total run size, and records truthful terminal absence", async () => {
  const { store, project } = await fixture();
  await store.create({ projectPath: project, runId: "run-a", brief: "brief", producer });
  for (let index = 0; index < 16; index += 1) {
    await store.addAttachment({ projectPath: project, runId: "run-a", name: `a-${index}.txt`, content: "a", mediaType: "text/plain", producer });
  }
  await expect(store.addAttachment({ projectPath: project, runId: "run-a", name: "a-16.txt", content: "a", mediaType: "text/plain", producer })).rejects.toThrow("16 attachments");
  await expect(store.addAttachment({ projectPath: project, runId: "run-a", name: "huge.bin", content: Buffer.alloc(10 * 1024 * 1024 + 1), mediaType: "application/octet-stream", producer })).rejects.toThrow("10 MiB");
  await store.recordTerminal({ projectPath: project, runId: "run-a", status: "failed" });
  expect(await store.inspect({ projectPath: project, runId: "run-a" })).toMatchObject({ terminal: { status: "failed", reportPresent: false }, report: null });
  await store.create({ projectPath: project, runId: "total", brief: "brief", producer });
  await store.addAttachment({ projectPath: project, runId: "total", name: "first.bin", content: Buffer.alloc(10 * 1024 * 1024), mediaType: "application/octet-stream", producer });
  await expect(store.addAttachment({ projectPath: project, runId: "total", name: "second.bin", content: Buffer.alloc(10 * 1024 * 1024), mediaType: "application/octet-stream", producer })).rejects.toThrow("20 MiB");
});

test("canceled managed handoff without a report records truthful absence and rejects later completion", async () => {
  const { store, project } = await fixture();
  await store.create({ projectPath: project, runId: "esc-canceled", brief: "slow work", producer });

  await expect(store.recordTerminal({ projectPath: project, runId: "esc-canceled", status: "canceled" }))
    .resolves.toEqual({ status: "canceled", reportPresent: false });
  expect(await store.inspect({ projectPath: project, runId: "esc-canceled" })).toMatchObject({
    terminal: { status: "canceled", reportPresent: false }, report: null,
  });
  await expect(store.recordTerminal({ projectPath: project, runId: "esc-canceled", status: "failed" }))
    .rejects.toThrow("already terminal as canceled");
});

test("invalid worker report cannot prevent failed terminal truth", async () => {
  const { store, project } = await fixture();
  const created = await store.create({ projectPath: project, runId: "invalid-report-terminal", brief: "brief", producer });
  await writeFile(created.worker.reportPath, "unsafe mode");
  await chmod(created.worker.reportPath, 0o644);

  await expect(store.recordTerminal({ projectPath: project, runId: "invalid-report-terminal", status: "failed" }))
    .resolves.toEqual({ status: "failed", reportPresent: false });
  expect(await store.inspect({ projectPath: project, runId: "invalid-report-terminal" })).toMatchObject({
    terminal: { status: "failed", reportPresent: false }, report: null,
  });
});

test("terminal recording is idempotent for the same status and rejects conflicting terminal truth", async () => {
  const { store, project } = await fixture();
  await store.create({ projectPath: project, runId: "idempotent-terminal", brief: "brief", producer });

  await store.recordTerminal({ projectPath: project, runId: "idempotent-terminal", status: "failed" });
  await expect(store.recordTerminal({ projectPath: project, runId: "idempotent-terminal", status: "failed" })).resolves.toMatchObject({
    status: "failed", reportPresent: false,
  });
  await expect(store.recordTerminal({ projectPath: project, runId: "idempotent-terminal", status: "canceled" }))
    .rejects.toThrow("already terminal as failed");
  expect(await store.inspect({ projectPath: project, runId: "idempotent-terminal" })).toMatchObject({
    terminal: { status: "failed", reportPresent: false }, report: null,
  });
});

test("records a worker-written report truthfully when failure happens before validation", async () => {
  const { store, project } = await fixture();
  const created = await store.create({ projectPath: project, runId: "failed-report", brief: "brief", producer });
  await writeFile(created.worker.reportPath, "partial evidence", { mode: 0o600 });
  await store.recordTerminal({ projectPath: project, runId: "failed-report", status: "failed", producer: { kind: "worker", id: "w" } });
  expect(await store.inspect({ projectPath: project, runId: "failed-report" })).toMatchObject({
    terminal: { status: "failed", reportPresent: true },
    report: { path: "report.md", producer: { kind: "worker", id: "w" } },
  });
});

test("rejects duplicate attachment names without corrupting the run", async () => {
  const { store, project } = await fixture();
  await store.create({ projectPath: project, runId: "duplicates", brief: "brief", producer });
  await store.addAttachment({ projectPath: project, runId: "duplicates", name: "same.txt", content: "first", mediaType: "text/plain", producer });
  await expect(store.addAttachment({ projectPath: project, runId: "duplicates", name: "same.txt", content: "second", mediaType: "text/plain", producer })).rejects.toThrow("already exists");
  expect(await store.inspect({ projectPath: project, runId: "duplicates" })).toMatchObject({ attachments: [{ path: "same.txt", bytes: 5 }] });
});

test("lists, inspects and cleans only verified terminal owned runs", async () => {
  const { root, store, project } = await fixture();
  await store.create({ projectPath: project, runId: "running", brief: "brief", producer });
  const done = await store.create({ projectPath: project, runId: "done", brief: "brief", producer });
  await writeFile(done.worker.reportPath, "done", { mode: 0o600 });
  await store.validateReport({ projectPath: project, runId: "done", producer: { kind: "worker", id: "w" } });
  expect((await store.list({ projectPath: project })).map((item) => item.runId)).toEqual(["done", "running"]);
  expect(await store.cleanTerminal({ projectPath: project })).toEqual({ removed: ["done"] });
  expect((await store.list({ projectPath: project })).map((item) => item.runId)).toEqual(["running"]);
  await store.clean({ projectPath: project, runId: "running" });
  expect(await store.list({ projectPath: project })).toEqual([]);
  expect(JSON.stringify(await store.list({ projectPath: project }))).not.toContain(root);
});

test("rejects malformed or tampered manifests and unexpected cleanup entries", async () => {
  const { root, store, project } = await fixture();
  const created = await store.create({ projectPath: project, runId: "tampered", brief: "brief", producer });
  const manifestPath = join(created.worker.briefPath, "..", "manifest.json");
  await writeFile(manifestPath, "{}\n", { mode: 0o600 });
  await expect(store.inspect({ projectPath: project, runId: "tampered" })).rejects.toThrow("manifest");
  await rm(join(created.worker.briefPath, ".."), { recursive: true });
  const clean = await store.create({ projectPath: project, runId: "unexpected", brief: "brief", producer });
  await writeFile(join(clean.worker.briefPath, "..", "extra"), "outside", { mode: 0o600 });
  await expect(store.clean({ projectPath: project, runId: "unexpected" })).rejects.toThrow("Unexpected object");
  expect(await readFile(join(clean.worker.briefPath, "..", "extra"), "utf8")).toBe("outside");
  expect(JSON.stringify(await store.list({ projectPath: join(root, "elsewhere") }))).not.toContain(project);
});
