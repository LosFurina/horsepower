import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { createOpenSpecBoundary } from "../../src/openspec/boundary.js";
import { createOpenSpecCliRunner } from "../../src/openspec/cli-runner.js";

test("authorizes this repository through the real official OpenSpec CLI and Pi integration", async () => {
  const cwd = resolve(import.meta.dirname, "../..");
  const boundary = createOpenSpecBoundary({
    run: createOpenSpecCliRunner(),
    readText: (path) => readFile(path, "utf8"),
  });

  const changeId = "add-live-model-capability-setup";
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
