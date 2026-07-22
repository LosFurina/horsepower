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

test("guided setup renders every human prompt in the effective locale while identifiers stay stable", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-setup-terminal-zh-"));
  roots.push(root);
  const input = join(root, "input");
  const output = join(root, "output");
  await writeFile(input, "invalid\n1\n1\nreselect\n");
  await writeFile(output, "");
  process.env.HORSEPOWER_TTY_INPUT = input;
  process.env.HORSEPOWER_TTY_OUTPUT = output;
  const { createSetupTerminal } = await import("../../src/cli/terminal.js");
  const terminal = createSetupTerminal("zh-CN");

  await terminal.showModels(["provider/judge"]);
  await expect(terminal.chooseModel({ slot: "judgment", modelIds: ["provider/judge"] })).resolves.toBe("provider/judge");
  await expect(terminal.chooseThinking({ slot: "judgment", model: "provider/judge", thinkingLevels: ["high"] })).resolves.toBe("high");
  await expect(terminal.chooseProbeAction({ slot: "judgment", selection: { model: "provider/judge", thinking: "high" }, result: { status: "unsupported", evidence: { code: "declared_exact_exclusion" } } })).resolves.toBe("reselect");
  const summary = {
    status: "incomplete", locale: { status: "configured", value: "zh-CN" }, skills: { status: "acknowledged" },
    webhook: { status: "skipped" }, followUps: ["horsepower setup --interactive"],
  };
  Reflect.set(summary, ["model", "Setup"].join(""), { status: "skipped" });
  await terminal.showConfigurationSummary("zh-CN", summary as never);
  const rendered = await readFile(output, "utf8");
  expect(rendered).toContain("当前 Pi 模型");
  expect(rendered).toContain("为 judgment 输入模型编号");
  expect(rendered).toContain("选择无效");
  expect(rendered).toContain("provider/judge");
  expect(rendered).toContain("high");
  expect(rendered).toContain("declared_exact_exclusion");
  expect(rendered).toContain("下一步：horsepower setup --interactive");
  expect(rendered).not.toContain("Next:");
});

test("interactive menus render numbered choices and accept useful Enter defaults", async () => {
  const root = await mkdtemp(join(tmpdir(), "horsepower-setup-terminal-defaults-"));
  roots.push(root);
  const input = join(root, "input");
  const output = join(root, "output");
  await writeFile(input, "\n\n\n");
  await writeFile(output, "");
  process.env.HORSEPOWER_TTY_INPUT = input;
  process.env.HORSEPOWER_TTY_OUTPUT = output;
  const { createSetupTerminal } = await import("../../src/cli/terminal.js");
  const terminal = createSetupTerminal("zh-CN");

  await expect(terminal.chooseWebhookAction("zh-CN", false)).resolves.toBe("skip");
  await expect(terminal.chooseModelAction("zh-CN")).resolves.toBe("configure");
  await expect(terminal.chooseThinking({ slot: "judgment", model: "provider/model", thinkingLevels: ["low", "medium", "high"] })).resolves.toBe("medium");

  const rendered = await readFile(output, "utf8");
  expect(rendered).toContain("1. skip");
  expect(rendered).toContain("2. configure");
  expect(rendered).toContain("1. configure");
  expect(rendered).toContain("2. medium（默认）");
});
