import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

const roots: string[] = [];
afterEach(async () => {
  delete process.env.HORSEPOWER_TTY_INPUT;
  delete process.env.HORSEPOWER_TTY_OUTPUT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("guided setup uses installer-provided TTY streams", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-setup-terminal-"));
  roots.push(root);
  const input = join(root, "input");
  const output = join(root, "output");
  await writeFile(input, "provider/judge\nhigh\n");
  await writeFile(output, "");
  process.env.HORSEPOWER_TTY_INPUT = input;
  process.env.HORSEPOWER_TTY_OUTPUT = output;
  const { createSetupTerminal } = await import("../../src/cli/terminal.js");
  const terminal = createSetupTerminal();

  await terminal.showModels(["provider/judge"]);
  await expect(terminal.chooseModel({ slot: "judgment", modelIds: ["provider/judge"] })).resolves.toBe("provider/judge");
  await expect(terminal.chooseThinking({ slot: "judgment", model: "provider/judge", thinkingLevels: ["high"] })).resolves.toBe("high");
  expect(await readFile(output, "utf8")).toContain("Current Pi models:");
});
