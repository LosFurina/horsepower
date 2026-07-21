import { lstat, mkdir, mkdtemp, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const temporaryDirectories: string[] = [];
async function temp(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "horsepower-cli-"));
  temporaryDirectories.push(path);
  return path;
}
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

const models = {
  "provider/judge": { thinkingLevels: ["high"] },
  "provider/craft": { thinkingLevels: ["medium"] },
  "provider/util": { thinkingLevels: ["low"] },
  "project/craft": { thinkingLevels: ["max"] },
} as const;

async function harness(options: Record<string, unknown> = {}) {
  const root = await temp();
  const homeDir = join(root, "home");
  const cwd = join(root, "project");
  await mkdir(cwd, { recursive: true });
  const { createCli } = await import("../../src/cli/app.js");
  const cli = createCli({
    homeDir,
    cwd,
    platform: "linux",
    models,
    runOpenSpec: async (args: readonly string[]) => {
      if (args[0] === "--version") return { code: 0, stdout: "1.6.0\n", stderr: "" };
      return { code: 0, stdout: JSON.stringify({ root: { path: cwd, healthy: true } }), stderr: "" };
    },
    fetch: async () => new Response(null, { status: 204 }),
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    ...options,
  });
  return { root, homeDir, cwd, run: (args: string[]) => cli.run(args) };
}

const setupArgs = [
  "setup", "--judgment", "provider/judge", "--judgment-thinking", "high",
  "--craft", "provider/craft", "--craft-thinking", "medium",
  "--utility", "provider/util", "--utility-thinking", "low", "--json",
];

test("strictly parses commands and emits deterministic JSON with stable exit codes", async () => {
  const { run } = await harness();
  expect(await run(["unknown", "--json"])).toEqual({
    exitCode: 2,
    stdout: "",
    stderr: '{"error":{"code":"USAGE","message":"Unknown command: unknown"},"ok":false}\n',
  });
  expect((await run(setupArgs)).stdout).toBe((await run(setupArgs)).stdout);
  expect((await run(["slots", "--bogus"]))).toMatchObject({ exitCode: 2 });
});

test("setup initializes missing private files and later writes preserve unknown fields", async () => {
  const { homeDir, run } = await harness();
  const result = await run(setupArgs);
  expect(result.exitCode).toBe(0);
  const root = join(homeDir, ".pi/agent/horsepower");
  expect((await stat(join(root, "model-slots.json"))).mode & 0o777).toBe(0o600);
  expect((await stat(join(root, "settings.json"))).mode & 0o777).toBe(0o600);
  await writeFile(join(root, "model-slots.json"), JSON.stringify({ future: { keep: true }, slots: JSON.parse(await readFile(join(root, "model-slots.json"), "utf8")).slots }));
  expect((await run(["set", "vision", "--fallback", "utility", "--json"])).exitCode).toBe(0);
  expect(JSON.parse(await readFile(join(root, "model-slots.json"), "utf8"))).toMatchObject({ future: { keep: true }, slots: { vision: { fallback: "utility" } } });
});

test("configure transactionally updates selected global bindings", async () => {
  const { run } = await harness();
  await run(setupArgs);
  const changed = await run(["configure", "--craft", "project/craft", "--craft-thinking", "max", "--json"]);
  expect(changed.exitCode).toBe(0);
  expect(JSON.parse(changed.stdout).data.effective).toMatchObject({
    judgment: { model: "provider/judge", thinking: "high" },
    craft: { model: "project/craft", thinking: "max" },
    utility: { model: "provider/util", thinking: "low" },
  });
  expect((await run(["configure", "--craft", "project/craft", "--json"])).exitCode).toBe(2);
});

test("slot set/unset validates through the registry and reports deterministic precedence/revision", async () => {
  const { run } = await harness();
  await run(setupArgs);
  expect((await run(["set", "craft", "--model", "project/craft", "--thinking", "max", "--scope", "project", "--json"])).exitCode).toBe(0);
  const listed = JSON.parse((await run(["slots", "--json"])).stdout);
  expect(listed.data.effective.craft).toEqual({ model: "project/craft", thinking: "max" });
  expect(listed.data.resolved.craft).toMatchObject({ requestedSlot: "craft", resolvedSlot: "craft", model: "project/craft", thinking: "max" });
  expect(listed.data.revision).toMatch(/^[a-f0-9]{64}$/u);
  expect((await run(["set", "Bad Slot", "--fallback", "utility", "--json"]))).toMatchObject({ exitCode: 1 });
  expect((await run(["unset", "craft", "--scope", "project", "--json"]))).toMatchObject({ exitCode: 0 });
  expect(JSON.parse((await run(["slots", "--json"])).stdout).data.effective.craft.model).toBe("provider/craft");
  expect((await run(["unset", "utility", "--json"]))).toMatchObject({ exitCode: 1 });
});

test("webhook configuration supports skip, scopes and all auth modes without exposing credentials", async () => {
  const secret = "never-print-this";
  const token = "also-never-print";
  const fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const { homeDir, run } = await harness({ fetch });
  await run(setupArgs);
  for (const args of [
    ["webhook", "configure", "--url", "https://example.test/hook", "--auth", "hmac", "--secret", secret],
    ["webhook", "configure", "--url", "https://example.test/hook", "--auth", "bearer", "--token", token, "--dispatch"],
    ["webhook", "configure", "--url", "https://example.test/hook", "--auth", "none", "--no-change"],
  ]) {
    const output = await run([...args, "--json"]);
    expect(output.exitCode).toBe(0);
    expect(output.stdout + output.stderr).not.toContain(secret);
    expect(output.stdout + output.stderr).not.toContain(token);
  }
  const path = join(homeDir, ".pi/agent/horsepower/settings.json");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  const delivered = await run(["webhook", "test", "--json"]);
  expect(delivered.exitCode).toBe(0);
  expect(fetch).toHaveBeenCalledOnce();
  expect(await run(["webhook", "skip", "--json"])).toMatchObject({ exitCode: 0 });
  const disabled = JSON.parse((await run(["configure", "--json"])).stdout).data.webhook;
  expect(disabled).toMatchObject({ enabled: false, auth: { mode: "none" } });
  expect(JSON.stringify(disabled)).not.toContain(secret);
  expect(JSON.stringify(disabled)).not.toContain(token);
});

test("doctor reports configuration, notifications, OpenSpec, skipped models, and ownership actionably", async () => {
  const { run } = await harness({ models: undefined, runOpenSpec: async (args: readonly string[]) => args[0] === "--version"
    ? { code: 127, stdout: "", stderr: "not found" }
    : { code: 1, stdout: "", stderr: "" } });
  const result = JSON.parse((await run(["doctor", "--json"])).stdout);
  expect(result.ok).toBe(false);
  expect(result.data.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "configuration", status: "error" }),
    expect.objectContaining({ id: "notification", status: "skipped" }),
    expect.objectContaining({ id: "openspec", status: "error", action: expect.stringContaining("official") }),
    expect.objectContaining({ id: "model-registry", status: "skipped" }),
    expect.objectContaining({ id: "installation", status: "error" }),
  ]));
});

test("doctor distinguishes healthy, missing, and stale official OpenSpec integration", async () => {
  for (const [kind, expected] of [["healthy", "ok"], ["missing", "error"], ["stale", "error"]] as const) {
    const { cwd, run } = await harness();
    if (kind !== "missing") {
      const generated = kind === "healthy" ? "1.6.0" : "1.5.0";
      await mkdir(join(cwd, ".pi/skills/openspec-apply-change"), { recursive: true });
      await mkdir(join(cwd, ".pi/prompts"), { recursive: true });
      await writeFile(join(cwd, ".pi/skills/openspec-apply-change/SKILL.md"), `name: openspec-apply-change\nauthor: openspec\ngeneratedBy: \"${generated}\"`);
      await writeFile(join(cwd, ".pi/prompts/opsx-apply.md"), "official");
    }
    const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
    expect(checks.find((check: { id: string }) => check.id === "openspec").status).toBe(expected);
  }
});

test("staged-release preflight validates manifest, version, layout, and current/link ownership", async () => {
  const { homeDir, root, run } = await harness();
  const staged = join(root, "horsepower");
  for (const path of ["bin/horsepower", "pi/extensions/horsepower/index.js", "pi/skills/horsepower/SKILL.md"]) {
    await mkdir(dirname(join(staged, path)), { recursive: true }); await writeFile(join(staged, path), "ok");
  }
  await writeFile(join(staged, "release-manifest.json"), JSON.stringify({ version: "0.1.0-alpha.1", entryPoints: { cli: "bin/horsepower", extension: "pi/extensions/horsepower/index.js", skill: "pi/skills/horsepower/SKILL.md" } }));
  expect(await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 0 });
  await writeFile(join(staged, "release-manifest.json"), JSON.stringify({ version: "wrong", entryPoints: {} }));
  expect(await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 1 });
  const cliLink = join(homeDir, ".local/bin/horsepower"); await mkdir(dirname(cliLink), { recursive: true }); await symlink("/unrelated", cliLink);
  expect(await run(["preflight", staged, "--version", "wrong", "--json"])).toMatchObject({ exitCode: 1 });
});

test("safe uninstall removes only owned topology while preserving user data", async () => {
  const { homeDir, cwd, run } = await harness();
  const hp = join(homeDir, ".pi/agent/horsepower");
  const version = join(hp, "versions/v0.1.0-alpha.1");
  await mkdir(join(version, "pi/extensions/horsepower"), { recursive: true });
  await mkdir(join(version, "pi/skills/horsepower"), { recursive: true });
  await mkdir(join(version, "bin"), { recursive: true });
  await writeFile(join(version, "bin/horsepower"), "x");
  await writeFile(join(version, "release-manifest.json"), JSON.stringify({ version: "0.1.0-alpha.1" }));
  await symlink("versions/v0.1.0-alpha.1", join(hp, "current"));
  const links = [[join(homeDir, ".pi/agent/extensions/horsepower"), join(hp, "current/pi/extensions/horsepower")], [join(homeDir, ".pi/agent/skills/horsepower"), join(hp, "current/pi/skills/horsepower")], [join(homeDir, ".local/bin/horsepower"), join(hp, "current/bin/horsepower")]];
  for (const [path, target] of links) { await mkdir(dirname(path!), { recursive: true }); await symlink(target!, path!); }
  for (const name of ["model-slots.json", "settings.json"]) await writeFile(join(hp, name), "{}\n");
  for (const name of ["memory", "state", "standards", "workflows", "personas"]) await mkdir(join(hp, name));
  await mkdir(join(cwd, ".pi/horsepower"), { recursive: true }); await writeFile(join(cwd, ".pi/horsepower/model-slots.json"), "{}\n");

  expect(await run(["uninstall", "--json"])).toMatchObject({ exitCode: 0 });
  for (const [path] of links) await expect(lstat(path!)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(hp, "current"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(hp, "versions"))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(join(hp, "settings.json"), "utf8")).toBe("{}\n");
  expect(await readFile(join(cwd, ".pi/horsepower/model-slots.json"), "utf8")).toBe("{}\n");
});

test("uninstall refuses regular, unrelated, and hostile symlink targets without following them", async () => {
  const { homeDir, root, run } = await harness();
  const outside = join(root, "outside"); await mkdir(outside); await writeFile(join(outside, "keep"), "safe");
  const hp = join(homeDir, ".pi/agent/horsepower"); await mkdir(hp, { recursive: true }); await symlink(outside, join(hp, "current"));
  const extension = join(homeDir, ".pi/agent/extensions/horsepower"); await mkdir(dirname(extension), { recursive: true }); await writeFile(extension, "foreign");
  const result = await run(["uninstall", "--json"]);
  expect(result.exitCode).toBe(1);
  expect(await readFile(extension, "utf8")).toBe("foreign");
  expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
  expect(await readlink(join(hp, "current"))).toBe(outside);
});

test("uninstall and purge refuse a symlinked Horsepower root without following it", async () => {
  const { homeDir, root, run } = await harness();
  const outside = join(root, "outside-root"); await mkdir(outside); await writeFile(join(outside, "keep"), "safe");
  const hp = join(homeDir, ".pi/agent/horsepower"); await mkdir(dirname(hp), { recursive: true }); await symlink(outside, hp);
  expect((await run(["uninstall", "--json"])).exitCode).toBe(1);
  expect((await run(["purge", "--yes", "--json"])).exitCode).toBe(1);
  expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
  expect(await readlink(hp)).toBe(outside);
});

test("uninstall refuses an unowned versions tree and never follows a versions symlink", async () => {
  for (const hostile of ["symlink", "unmanaged"] as const) {
    const { homeDir, root, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    await mkdir(hp, { recursive: true });
    if (hostile === "symlink") {
      const outside = join(root, "outside-versions");
      await mkdir(outside); await writeFile(join(outside, "keep"), "safe");
      await symlink(outside, join(hp, "versions"));
      expect((await run(["uninstall", "--json"])).exitCode).toBe(1);
      expect(await readFile(join(outside, "keep"), "utf8")).toBe("safe");
    } else {
      await mkdir(join(hp, "versions/not-a-managed-release"), { recursive: true });
      await writeFile(join(hp, "versions/not-a-managed-release/keep"), "safe");
      expect((await run(["uninstall", "--json"])).exitCode).toBe(1);
      expect(await readFile(join(hp, "versions/not-a-managed-release/keep"), "utf8")).toBe("safe");
    }
  }
});

test("purge requires confirmation and --yes noninteractively, then removes only Horsepower data", async () => {
  const { homeDir, cwd, run } = await harness({ interactive: false });
  await mkdir(join(homeDir, ".pi/agent/horsepower/memory"), { recursive: true });
  await mkdir(join(cwd, ".pi/horsepower"), { recursive: true });
  expect(await run(["purge", "--json"])).toMatchObject({ exitCode: 2 });
  expect(await stat(join(homeDir, ".pi/agent/horsepower/memory"))).toBeTruthy();
  expect(await run(["purge", "--yes", "--json"])).toMatchObject({ exitCode: 0 });
  await expect(lstat(join(homeDir, ".pi/agent/horsepower"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(join(cwd, ".pi/horsepower"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("CLI never mutates Pi model/provider configuration or API keys", async () => {
  const { homeDir, run } = await harness();
  const provider = join(homeDir, ".pi/agent/models.json");
  const auth = join(homeDir, ".pi/agent/auth.json");
  await mkdir(dirname(provider), { recursive: true }); await writeFile(provider, '{"private":"model"}'); await writeFile(auth, '{"apiKey":"secret"}');
  await run(setupArgs); await run(["doctor", "--json"]); await run(["uninstall", "--json"]);
  expect(await readFile(provider, "utf8")).toBe('{"private":"model"}');
  expect(await readFile(auth, "utf8")).toBe('{"apiKey":"secret"}');
});
