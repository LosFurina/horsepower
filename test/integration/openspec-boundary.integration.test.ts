import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createOpenSpecBoundary } from "../../src/openspec/boundary.js";
import { createOpenSpecCliRunner } from "../../src/openspec/cli-runner.js";

const temporary: string[] = [];
afterEach(async () => Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

test("authorizes a complete change through the real official OpenSpec CLI and Pi integration", async () => {
  const repository = resolve(import.meta.dirname, "../..");
  const cwd = await mkdtemp(join(tmpdir(), "horsepower-openspec-boundary-"));
  temporary.push(cwd);
  await Promise.all([
    cp(join(repository, ".pi"), join(cwd, ".pi"), { recursive: true }),
    cp(join(repository, "openspec"), join(cwd, "openspec"), { recursive: true }),
  ]);
  const changeId = "integration-boundary-fixture";
  await cp(
    join(cwd, "openspec/changes/archive/2026-07-21-add-live-model-capability-setup"),
    join(cwd, "openspec/changes", changeId),
    { recursive: true },
  );
  const boundary = createOpenSpecBoundary({
    run: createOpenSpecCliRunner(),
    readText: (path) => readFile(path, "utf8"),
  });

  await expect(boundary.authorize({
    action: "create",
    changeId,
    cwd,
  })).resolves.toMatchObject({
    allowed: true,
    openspecRequired: true,
    version: "1.6.0",
    changeId,
  });
}, 15_000);
