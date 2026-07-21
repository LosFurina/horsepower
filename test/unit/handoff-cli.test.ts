import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "horsepower-handoff-cli-"));
  const home = join(root, "home"), project = join(root, "project"); await mkdir(project, { recursive: true });
  const { createHandoffStore } = await import("../../src/handoffs/store.js");
  const store = createHandoffStore({ stateRoot: join(home, ".pi", "agent", "horsepower", "state") });
  const created = await store.create({ projectPath: project, runId: "run-1", brief: "private brief", producer: { kind: "captain", id: "captain" } });
  await writeFile(created.worker.reportPath, "private full report", { mode: 0o600 });
  await store.validateReport({ projectPath: project, runId: "run-1", producer: { kind: "worker", id: "w" } });
  const { createCli } = await import("../../src/cli/app.js");
  const runOpenSpec = vi.fn(async () => ({ code: 127, stdout: "", stderr: "missing" }));
  return { root, home, project, runOpenSpec, cli: createCli({ homeDir: home, cwd: project, platform: "linux", runOpenSpec }) };
}

test("handoff list and inspect are deterministic, opaque, and do not require OpenSpec", async () => {
  const { root, cli, runOpenSpec } = await fixture();
  const listed = await cli.run(["handoff", "list", "--json"]); const inspected = await cli.run(["handoff", "inspect", "run-1", "--json"]);
  expect(listed.exitCode).toBe(0); expect(inspected.exitCode).toBe(0); expect(runOpenSpec).not.toHaveBeenCalled();
  expect(listed.stdout).toContain("run-1"); expect(inspected.stdout).toContain('"sha256"');
  expect(`${listed.stdout}${inspected.stdout}`).not.toContain(root);
  expect(inspected.stdout).not.toContain("private full report"); expect(inspected.stdout).not.toContain("private brief");
});

test("purge removes retained handoffs with existing purge semantics", async () => {
  const { cli, home } = await fixture();
  const result = await cli.run(["purge", "--yes", "--json"]);
  expect(result.exitCode).toBe(0);
  await expect((await import("node:fs/promises")).lstat(join(home, ".pi", "agent", "horsepower"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("handoff clean removes one verified run and clean-terminal removes terminal runs", async () => {
  const { cli, home, project } = await fixture();
  const { createHandoffStore } = await import("../../src/handoffs/store.js"); const store = createHandoffStore({ stateRoot: join(home, ".pi", "agent", "horsepower", "state") });
  await store.create({ projectPath: project, runId: "running", brief: "b", producer: { kind: "captain", id: "c" } });
  expect((await cli.run(["handoff", "clean-terminal", "--json"])).exitCode).toBe(0);
  expect((await store.list({ projectPath: project })).map((x) => x.runId)).toEqual(["running"]);
  expect((await cli.run(["handoff", "clean", "running", "--json"])).exitCode).toBe(0);
  expect(await store.list({ projectPath: project })).toEqual([]);
});
