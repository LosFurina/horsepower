import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createCli } from "../../src/cli/app.js";

const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function harness(locale?: "en" | "zh-CN") {
  const root = await mkdtemp(join(tmpdir(), "horsepower-cli-help-"));
  temporaryDirectories.push(root);
  const homeDir = join(root, "home");
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });
  if (locale) {
    const settings = join(homeDir, ".pi/agent/horsepower/settings.json");
    await mkdir(join(homeDir, ".pi/agent/horsepower"), { recursive: true });
    await writeFile(settings, `${JSON.stringify({ outputLocale: locale })}\n`, { mode: 0o600 });
  }
  const fetch = vi.fn<typeof globalThis.fetch>();
  const runOpenSpec = vi.fn(async () => ({ code: 1, stdout: "", stderr: "must not run" }));
  const cli = createCli({ homeDir, cwd, platform: "win32", fetch, runOpenSpec });
  return { root, homeDir, cwd, fetch, runOpenSpec, run: (args: string[]) => cli.run(args) };
}

const paths = [
  "help", "configure", "setup", "slots", "set", "unset",
  "webhook", "webhook configure", "webhook skip", "webhook disable", "webhook test",
  "skill-audit", "doctor", "update", "preflight", "enable", "disable", "uninstall", "purge",
  "handoff", "handoff list", "handoff inspect", "handoff clean", "handoff clean-terminal",
] as const;

describe("TC-1 recursive CLI help", () => {
  test("every public first-level and nested path supports long, short, and explicit help", async () => {
    const { run, fetch, runOpenSpec } = await harness();
    for (const path of paths) {
      const parts = path.split(" ");
      for (const flag of ["--help", "-h"] as const) {
        const result = await run([...parts, flag]);
        expect(result.exitCode, `${path} ${flag}: ${result.stderr}`).toBe(0);
        expect(result.stdout).toContain(`horsepower ${path}`);
      }
      const explicit = await run(["help", ...parts]);
      expect(explicit.exitCode, `help ${path}: ${explicit.stderr}`).toBe(0);
      expect(explicit.stdout).toContain(`horsepower ${path}`);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(runOpenSpec).not.toHaveBeenCalled();
  });

  test("top-level help is complete and registry JSON has bounded stable fields", async () => {
    const { run } = await harness();
    const top = JSON.parse((await run(["--help", "--json"])).stdout);
    expect(top.ok).toBe(true);
    expect(top.data).toMatchObject({ commandPath: "horsepower", usage: "horsepower <command> [options]" });
    expect(top.data.subcommands.map((item: { name: string }) => item.name)).toEqual(paths.filter((path) => !path.includes(" ")));
    for (const path of paths) {
      const result = await run([...path.split(" "), "--help", "--json"]);
      const envelope = JSON.parse(result.stdout);
      expect(Object.keys(envelope.data).sort()).toEqual(["arguments", "commandPath", "description", "examples", "options", "subcommands", "usage"]);
      expect(envelope.data.commandPath).toBe(`horsepower ${path}`);
      expect(envelope.data.description.length).toBeGreaterThan(0);
      expect(envelope.data.usage.startsWith(`horsepower ${path.split(" ")[0]}`)).toBe(true);
    }
  });

  test("unknown first-level and nested help paths fail without substituting unrelated help", async () => {
    const { run } = await harness();
    for (const args of [["unknown", "--help"], ["webhook", "unknown", "-h"], ["help", "handoff", "unknown"]]) {
      const result = await run(args);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Unknown help path");
    }
  });

  test("help resolves before unsupported-platform actions, validation, network, or mutation", async () => {
    const { homeDir, run, fetch, runOpenSpec } = await harness();
    const before = await access(join(homeDir, ".pi/agent/horsepower/versions")).then(() => true, () => false);
    const result = await run(["update", "--version", "not-a-version", "--help"]);
    const after = await access(join(homeDir, ".pi/agent/horsepower/versions")).then(() => true, () => false);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(result.stdout).toContain("horsepower update");
    expect(before).toBe(false);
    expect(after).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(runOpenSpec).not.toHaveBeenCalled();
  });

  test("Chinese help localizes human text and preserves machine tokens", async () => {
    const { homeDir, run } = await harness("zh-CN");
    const text = await run(["webhook", "configure", "--help"]);
    expect(text.stdout).toContain("配置 webhook 投递");
    expect(text.stdout).toContain("horsepower webhook configure");
    expect(text.stdout).toContain("--provider generic|discord");
    const json = JSON.parse((await run(["update", "--help", "--json"])).stdout);
    expect(json.outputLocale).toBe("zh-CN");
    expect(json.data).toMatchObject({ commandPath: "horsepower update", description: "更新到官方 release" });
    expect(await readFile(join(homeDir, ".pi/agent/horsepower/settings.json"), "utf8")).toContain("zh-CN");
  });
});
