import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readlink, rename, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";
import { selectedE2ELocales } from "../fixtures/e2e-locales.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const version = (JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8")) as { version: string }).version;
let releaseDir: string;

beforeAll(async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot });
  await execFileAsync(process.execPath, ["scripts/release.mjs", version], { cwd: repositoryRoot });
  releaseDir = join(repositoryRoot, "release");
});

async function fixture(options: { failInstallationDoctor?: boolean; failLocalePersist?: boolean; guidedSetup?: "configured" | "probe-failure" | "canceled"; latestVersion?: string; latestUrl?: string; failLatest?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "horsepower-installer-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  const openspec = join(bin, "openspec");
  const pi = join(bin, "pi");
  await writeFile(openspec, "#!/bin/sh\nprintf '%s\\n' '1.6.0'\n", { mode: 0o755 });
  await writeFile(pi, "#!/bin/sh\nprintf '%s\\n' '0.80.10'\n", { mode: 0o755 });
  if (options.latestVersion || options.latestUrl || options.failLatest) {
    const realCurl = (await execFileAsync("sh", ["-c", "command -v curl"])).stdout.trim();
    const latestUrl = options.latestUrl ?? `https://github.com/LosFurina/horsepower/releases/tag/v${options.latestVersion ?? version}`;
    await writeFile(join(bin, "curl"), `#!/bin/sh\nlast=\"\"\nfor argument do last=$argument; done\nif [ \"$last\" = \"https://github.com/LosFurina/horsepower/releases/latest\" ]; then : > ${JSON.stringify(join(root, "latest-requested"))}; ${options.failLatest ? "exit 22" : `printf '%s' ${JSON.stringify(latestUrl)}; exit 0`}; fi\nexec ${JSON.stringify(realCurl)} \"$@\"\n`, { mode: 0o755 });
  }
  if (options.failInstallationDoctor || options.failLocalePersist || options.guidedSetup) {
    const realNode = process.execPath;
    const modelSetupKey = ["model", "Setup"].join("");
    const setup = options.guidedSetup === "configured"
      ? `mkdir -p "$HOME/.pi/agent/horsepower"; printf '%s\\n' '{"slots":{"judgment":{"model":"provider/judge","thinking":"high"},"craft":{"model":"provider/craft","thinking":"medium"},"utility":{"model":"provider/util","thinking":"low"}}}' > "$HOME/.pi/agent/horsepower/model-slots.json"; printf '%s\\n' '{"data":{"status":"complete","${modelSetupKey}":{"status":"configured"}},"ok":true}'; exit 0`
      : options.guidedSetup === "probe-failure" ? "exit 1"
        : options.guidedSetup === "canceled" ? "exit 1" : "";
    await writeFile(join(bin, "node"), `#!/bin/sh\ncase \"$*\" in *\"doctor --installation-only\"*) ${options.failInstallationDoctor ? "exit 42" : `exec ${JSON.stringify(realNode)} \"$@\"`} ;; *\"configure --locale\"*) ${options.failLocalePersist ? "exit 23" : `exec ${JSON.stringify(realNode)} \"$@\"`} ;; *\"configure --interactive\"*) ${setup || `exec ${JSON.stringify(realNode)} \"$@\"`} ;; esac\nexec ${JSON.stringify(realNode)} \"$@\"\n`, { mode: 0o755 });
  }
  return { root, home, bin, openspec, pi };
}

async function runInstaller(fixturePaths: Awaited<ReturnType<typeof fixture>>, args: string[] = [], baseUrl = `file://${releaseDir}`) {
  return execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--version", version, "--no-setup", ...args], {
    cwd: fixturePaths.root,
    env: {
      ...process.env,
      HOME: fixturePaths.home,
      PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`,
      HORSEPOWER_RELEASE_BASE_URL: baseUrl,
    },
  });
}

async function install(args: string[] = []) {
  const fixturePaths = await fixture();
  const result = await runInstaller(fixturePaths, args);
  return { ...fixturePaths, ...result };
}

test("installer resolves the latest GitHub Release when no version override is supplied", async () => {
  const fixturePaths = await fixture({ latestVersion: version });
  const result = await execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--no-setup"], {
    cwd: fixturePaths.root,
    env: {
      ...process.env,
      HOME: fixturePaths.home,
      PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`,
      HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}`,
    },
  });
  expect(result.stdout).toContain("Horsepower installed successfully.");
  await expect(access(join(fixturePaths.root, "latest-requested"))).resolves.toBeUndefined();
  expect(await readlink(join(fixturePaths.home, ".pi/agent/horsepower/current"))).toBe(`versions/v${version}`);
});

test.each([
  ["resolver failure", { failLatest: true }, "unable to resolve the latest GitHub Release"],
  ["unexpected redirect", { latestUrl: "https://example.test/releases/tag/v0.1.0" }, "latest GitHub Release resolved to an unexpected URL"],
])("installer refuses latest resolution errors before downloading assets: %s", async (_label, options, error) => {
  const fixturePaths = await fixture(options);
  await expect(execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--no-setup"], {
    cwd: fixturePaths.root,
    env: { ...process.env, HOME: fixturePaths.home, PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`, HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}` },
  })).rejects.toMatchObject({ stderr: expect.stringContaining(error) });
  await expect(access(join(fixturePaths.home, ".pi"))).rejects.toThrow();
});

test.each([
  ["environment pin", [] as string[], version],
  ["command-line pin wins", ["--version", version] as string[], "invalid-environment-version"],
])("installer %s skips latest resolution", async (_label, args, environmentVersion) => {
  const fixturePaths = await fixture({ latestVersion: version });
  const result = await execFileAsync("sh", [join(repositoryRoot, "install.sh"), ...args, "--no-setup"], {
    cwd: fixturePaths.root,
    env: {
      ...process.env, HOME: fixturePaths.home, PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`,
      HORSEPOWER_VERSION: environmentVersion, HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}`,
    },
  });
  expect(result.stdout).toContain("Horsepower installed successfully.");
  await expect(access(join(fixturePaths.root, "latest-requested"))).rejects.toThrow();
});

async function runInstallerWithoutTty(
  fixturePaths: Awaited<ReturnType<typeof fixture>>,
  args: string[] = [],
) {
  return execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--version", version, ...args], {
    cwd: fixturePaths.root,
    env: {
      ...process.env,
      HOME: fixturePaths.home,
      PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`,
      HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}`,
      HORSEPOWER_TTY_INPUT: join(fixturePaths.root, "missing-tty-input"),
      HORSEPOWER_TTY_OUTPUT: join(fixturePaths.root, "missing-tty-output"),
    },
  });
}

async function runInteractiveInstaller(
  fixturePaths: Awaited<ReturnType<typeof fixture>>,
  ttyInput: string,
  ttyOutput: string,
  args: string[] = [],
) {
  return execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--version", version, ...args], {
    cwd: fixturePaths.root,
    env: {
      ...process.env,
      HOME: fixturePaths.home,
      PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`,
      HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}`,
      HORSEPOWER_TTY_INPUT: ttyInput,
      HORSEPOWER_TTY_OUTPUT: ttyOutput,
    },
  });
}

test("installer optionally runs guided model setup after activation and reports configuration separately", async () => {
  const fixturePaths = await fixture({ guidedSetup: "configured" });
  const ttyInput = join(fixturePaths.root, "tty-model-success");
  const ttyOutput = join(fixturePaths.root, "tty-model-success-output");
  await writeFile(ttyInput, "\ny\n");
  await writeFile(ttyOutput, "");

  const result = await runInteractiveInstaller(fixturePaths, ttyInput, ttyOutput, ["--locale", "en"]);

  expect(await readFile(ttyOutput, "utf8")).toContain("External Skills such as Superpowers");
  expect(result.stdout).toContain("Horsepower installed successfully.");
  expect(result.stdout).toContain("Model setup completed.");
  expect(result.stdout).not.toContain("horsepower setup --interactive");
  expect(JSON.parse(await readFile(join(fixturePaths.home, ".pi/agent/horsepower/model-slots.json"), "utf8"))).toHaveProperty("slots.judgment.model", "provider/judge");
});

test.each([
  ["skip", undefined, "\nn\n"],
  ["probe failure", "probe-failure" as const, "\ny\n"],
  ["cancel", "canceled" as const, "\ny\n"],
])("installer preserves prior model-slot bytes on incomplete guided setup: %s", async (_label, guidedSetup, input) => {
  const fixturePaths = await fixture(guidedSetup ? { guidedSetup } : {});
  const slotsPath = join(fixturePaths.home, ".pi/agent/horsepower/model-slots.json");
  const before = Buffer.from('{ "prior": "exact model slot bytes" }\n');
  await mkdir(dirname(slotsPath), { recursive: true });
  await writeFile(slotsPath, before);
  const ttyInput = join(fixturePaths.root, "tty-model-incomplete");
  const ttyOutput = join(fixturePaths.root, "tty-model-incomplete-output");
  await writeFile(ttyInput, input);
  await writeFile(ttyOutput, "");

  const result = await runInteractiveInstaller(fixturePaths, ttyInput, ttyOutput, ["--locale", "en"]);

  expect(result.stdout).toContain("Horsepower installed successfully.");
  expect(result.stdout).toContain("Model setup incomplete.");
  expect(result.stdout).toContain("horsepower setup --interactive");
  expect(await readFile(slotsPath)).toEqual(before);
});

test("no-TTY and --no-setup installs skip model setup with the exact follow-up command", async () => {
  const noTty = await fixture();
  const noTtyResult = await runInstallerWithoutTty(noTty, ["--locale", "en"]);
  expect(noTtyResult.stdout).toContain("Horsepower installed successfully.");
  expect(noTtyResult.stdout).toContain("horsepower setup --interactive");

  const disabled = await install();
  expect(disabled.stdout).toContain("horsepower setup --interactive");
});

test("interactive external Skill audit defaults to No before activation and affirmative input continues", async () => {
  const fixturePaths = await fixture();
  const external = join(fixturePaths.root, ".pi/skills/external/SKILL.md");
  await mkdir(dirname(external), { recursive: true });
  await writeFile(external, "---\nname: external\ndescription: fixture\n---\nprivate body");
  const managed = join(fixturePaths.home, ".pi", "agent", "horsepower");

  const declineInput = join(fixturePaths.root, "tty-audit-decline"), declineOutput = join(fixturePaths.root, "tty-audit-decline-output");
  await writeFile(declineInput, "\n"); await writeFile(declineOutput, "");
  await expect(runInteractiveInstaller(fixturePaths, declineInput, declineOutput, ["--locale", "en"])).rejects.toMatchObject({ stderr: expect.stringContaining("Skill audit declined") });
  expect(await readFile(declineOutput, "utf8")).toContain("external");
  await expect(access(join(managed, "current"))).rejects.toThrow();
  await expect(access(join(managed, "settings.json"))).rejects.toThrow();

  const acceptInput = join(fixturePaths.root, "tty-audit-accept"), acceptOutput = join(fixturePaths.root, "tty-audit-accept-output");
  await writeFile(acceptInput, "yes\n\n"); await writeFile(acceptOutput, "");
  await expect(runInteractiveInstaller(fixturePaths, acceptInput, acceptOutput, ["--locale", "en"])).resolves.toMatchObject({ stdout: expect.stringContaining("installed successfully") });
  expect(await readFile(acceptOutput, "utf8")).toContain("workers use --no-skills");
  expect(await readlink(join(managed, "current"))).toBe(`versions/v${version}`);
});

test("non-interactive exposure warns on stderr and continues without changing Skill configuration", async () => {
  const fixturePaths = await fixture();
  const external = join(fixturePaths.root, ".pi/skills/external/SKILL.md");
  await mkdir(dirname(external), { recursive: true });
  await writeFile(external, "---\nname: external\ndescription: fixture\n---\nprivate body");
  const result = await runInstaller(fixturePaths);
  expect(result.stderr).toContain("Skill exposure audit");
  expect(result.stderr).toContain('find "$HOME"');
  expect(await readFile(external, "utf8")).toContain("private body");
  expect(await readlink(join(fixturePaths.home, ".pi/agent/horsepower/current"))).toBe(`versions/v${version}`);
});

test("post-activation configuration failure preserves prior webhook bytes and installed topology", async () => {
  const fixturePaths = await fixture();
  await runInstaller(fixturePaths);
  const managed = join(fixturePaths.home, ".pi", "agent", "horsepower");
  const settingsPath = join(managed, "settings.json");
  const before = await readFile(settingsPath);
  const ttyInput = join(fixturePaths.root, "tty-input-invalid");
  const ttyOutput = join(fixturePaths.root, "tty-output-invalid");
  await writeFile(ttyInput, "configure\ngeneric\nhttps://example.test/hook\ninvalid-auth\n");
  await writeFile(ttyOutput, "");
  await expect(runInteractiveInstaller(fixturePaths, ttyInput, ttyOutput, ["--locale", "zh-CN"])).resolves.toMatchObject({ stdout: expect.stringContaining("Horsepower 安装成功") });
  expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({ ...JSON.parse(before.toString("utf8")), outputLocale: "zh-CN" });
  expect(await readlink(join(managed, "current"))).toBe(`versions/v${version}`);
  expect(await readlink(join(fixturePaths.home, ".local/bin/horsepower"))).toBe(join(managed, "current/bin/horsepower"));
});

test("interactive locale persistence failure reports incomplete configuration without blocking", async () => {
  const fixturePaths = await fixture({ failLocalePersist: true });
  const ttyInput = join(fixturePaths.root, "tty-locale-failure");
  const ttyOutput = join(fixturePaths.root, "tty-locale-failure-output");
  await writeFile(ttyInput, "\n");
  await writeFile(ttyOutput, "");
  const result = await runInteractiveInstaller(fixturePaths, ttyInput, ttyOutput, ["--locale", "en"]);
  expect(result.stdout).toContain("Horsepower installed successfully.");
  expect(result.stderr).toContain("output locale could not be persisted");
  expect(result.stdout).toContain("horsepower configure --interactive");
});

test("interactive Bearer webhook setup stores a private token with dispatch disabled by default", async () => {
  const fixturePaths = await fixture();
  const ttyInput = join(fixturePaths.root, "tty-input-bearer");
  const ttyOutput = join(fixturePaths.root, "tty-output-bearer");
  const sampleValue = "fixture-bearer-value-123";
  await writeFile(ttyInput, `1\nconfigure\ngeneric\nhttps://example.test/hook\nbearer\n${sampleValue}\n\nskip\n`);
  await writeFile(ttyOutput, "");
  const result = await runInteractiveInstaller(fixturePaths, ttyInput, ttyOutput);
  expect(`${await readFile(ttyOutput, "utf8")}${result.stdout}${result.stderr}`).not.toContain(sampleValue);
  const settings = JSON.parse(await readFile(join(fixturePaths.home, ".pi", "agent", "horsepower", "settings.json"), "utf8"));
  expect(settings.webhook).toMatchObject({ auth: { mode: "bearer", token: sampleValue }, notifications: { change: true, dispatch: false } });
});

test.each(["0.80.9", "0.81.1-beta.1"])("incompatible Pi %s is rejected before release download or managed filesystem mutation", async (piVersion) => {
  const fixturePaths = await fixture();
  await writeFile(fixturePaths.pi, `#!/bin/sh\nprintf '%s\\n' '${piVersion}'\n`, { mode: 0o755 });
  await expect(runInstaller(fixturePaths, [], "file:///release-must-not-be-read"))
    .rejects.toMatchObject({ stderr: expect.stringContaining("Pi >=0.80.10 is required") });
  await expect(access(join(fixturePaths.home, ".pi"))).rejects.toThrow();
});

test.each(["0.81.1", "0.82.0", "1.0.0"])("installer accepts Pi %s without an upper-bound ceiling", async (piVersion) => {
  const fixturePaths = await fixture();
  await writeFile(fixturePaths.pi, `#!/bin/sh\nprintf '%s\\n' '${piVersion}'\n`, { mode: 0o755 });
  await expect(runInstaller(fixturePaths)).resolves.toMatchObject({
    stdout: expect.stringContaining("Horsepower installed successfully."),
  });
});

async function preparePreviousInstallation(fixturePaths: Awaited<ReturnType<typeof fixture>>) {
  const managedRoot = join(fixturePaths.home, ".pi/agent/horsepower");
  await runInstaller(fixturePaths);
  const previousRoot = join(managedRoot, "versions/v0.1.0-previous");
  await rename(join(managedRoot, `versions/v${version}`), previousRoot);
  const previousManifestPath = join(previousRoot, "release-manifest.json");
  const previousManifest = JSON.parse(await readFile(previousManifestPath, "utf8")) as { version: string; compatibility: { pi: string } };
  previousManifest.version = "0.1.0-previous";
  previousManifest.compatibility.pi = "0.80.10";
  await writeFile(previousManifestPath, `${JSON.stringify(previousManifest)}\n`);
  await symlink("versions/v0.1.0-previous", join(managedRoot, "current.previous"));
  await rename(join(managedRoot, "current.previous"), join(managedRoot, "current"));
  return { managedRoot, previousRoot };
}

test("installer atomically replaces an existing current symlink during an upgrade", async () => {
  const fixturePaths = await fixture();
  const { managedRoot, previousRoot } = await preparePreviousInstallation(fixturePaths);
  await expect(runInstaller(fixturePaths)).resolves.toMatchObject({
    stdout: expect.stringContaining("Horsepower installed successfully."),
  });
  expect(await readlink(join(managedRoot, "current"))).toBe(`versions/v${version}`);
  await expect(access(join(managedRoot, "current.new"))).rejects.toThrow();
  await expect(access(join(previousRoot, "current.new"))).rejects.toThrow();
});

test("failed upgrade doctor atomically restores the previous current symlink", async () => {
  const fixturePaths = await fixture();
  const { managedRoot, previousRoot } = await preparePreviousInstallation(fixturePaths);
  const settingsPath = join(managedRoot, "settings.json");
  const settingsBefore = await readFile(settingsPath);
  const links = [
    join(fixturePaths.home, ".pi/agent/extensions/horsepower"),
    join(fixturePaths.home, ".pi/agent/skills/horsepower"),
    join(fixturePaths.home, ".local/bin/horsepower"),
  ];
  const linkTargetsBefore = await Promise.all(links.map((link) => readlink(link)));
  await writeFile(join(fixturePaths.bin, "node"), `#!/bin/sh\ncase "$*" in *"doctor --installation-only"*) exit 42 ;; esac\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });

  await expect(runInstaller(fixturePaths)).rejects.toMatchObject({
    stderr: expect.stringContaining("post-install doctor failed"),
  });

  expect(await readlink(join(managedRoot, "current"))).toBe("versions/v0.1.0-previous");
  expect(await readFile(settingsPath)).toEqual(settingsBefore);
  await expect(Promise.all(links.map((link) => readlink(link)))).resolves.toEqual(linkTargetsBefore);
  for (const root of [managedRoot, previousRoot, join(managedRoot, `versions/v${version}`)]) {
    await expect(access(join(root, "current.rollback"))).rejects.toThrow();
  }
});

test.each(["1.5.9", "1.6.0-beta.1", "OpenSpec 1.6.0", "01.6.0"])(
  "unsupported OpenSpec %s is rejected before release download or managed filesystem mutation",
  async (openSpecVersion) => {
    const fixturePaths = await fixture();
    await writeFile(fixturePaths.openspec, `#!/bin/sh\nprintf '%s\\n' '${openSpecVersion}'\n`, { mode: 0o755 });
    await expect(runInstaller(fixturePaths, [], "file:///release-must-not-be-read"))
      .rejects.toMatchObject({ stderr: expect.stringContaining("OpenSpec >=1.6.0 is required") });
    await expect(access(join(fixturePaths.home, ".pi"))).rejects.toThrow();
  },
);

test.each(["1.6.0", "2.0.0", "3.1.4"])(
  "installer accepts OpenSpec %s without an upper-bound ceiling",
  async (openSpecVersion) => {
    const fixturePaths = await fixture();
    await writeFile(fixturePaths.openspec, `#!/bin/sh\nprintf '%s\\n' '${openSpecVersion}'\n`, { mode: 0o755 });
    await expect(runInstaller(fixturePaths)).resolves.toMatchObject({
      stdout: expect.stringContaining("Horsepower installed successfully."),
    });
  },
);

test("interactive HMAC webhook setup stores private credentials and dispatch opt-in without echoing secrets", async () => {
  const fixturePaths = await fixture();
  const ttyInput = join(fixturePaths.root, "tty-input-hmac");
  const ttyOutput = join(fixturePaths.root, "tty-output-hmac");
  const sampleValue = "fixture-hmac-value-1234";
  await writeFile(ttyInput, `1\nconfigure\ngeneric\nhttps://example.test/hook\nhmac\n${sampleValue}\ny\nskip\n`);
  await writeFile(ttyOutput, "");
  const result = await runInteractiveInstaller(fixturePaths, ttyInput, ttyOutput);
  const output = `${await readFile(ttyOutput, "utf8")}\n${result.stdout}\n${result.stderr}`;
  expect(output).not.toContain(sampleValue);
  const settingsPath = join(fixturePaths.home, ".pi", "agent", "horsepower", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  expect(settings).toMatchObject({ outputLocale: "en", webhook: { enabled: true, url: "https://example.test/hook", auth: { mode: "hmac", secret: sampleValue }, notifications: { change: true, dispatch: true } } });
  expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
});

test("interactive installation starts bilingual, selects Chinese, and permits skipped webhook", async () => {
  const fixturePaths = await fixture();
  const ttyInput = join(fixturePaths.root, "tty-input");
  const ttyOutput = join(fixturePaths.root, "tty-output");
  await writeFile(ttyInput, "2\nskip\nskip\n");
  await writeFile(ttyOutput, "");
  const result = await runInteractiveInstaller(fixturePaths, ttyInput, ttyOutput);
  const output = `${await readFile(ttyOutput, "utf8")}\n${result.stdout}`;
  expect(output).toContain("Choose language / 选择语言");
  expect(output).toContain("Webhook 操作");
  expect(output).toContain("Horsepower 安装成功。");
  const settings = JSON.parse(await readFile(join(fixturePaths.home, ".pi", "agent", "horsepower", "settings.json"), "utf8"));
  expect(settings).toMatchObject({ outputLocale: "zh-CN", webhook: { enabled: false } });
});

test("failed post-install doctor rolls back current and only links created by that run", async () => {
  const fixturePaths = await fixture({ failInstallationDoctor: true });
  await expect(runInstaller(fixturePaths)).rejects.toMatchObject({ stderr: expect.stringContaining("post-install doctor failed") });
  const managed = join(fixturePaths.home, ".pi", "agent", "horsepower");
  await expect(access(join(managed, "versions", `v${version}`, "release-manifest.json"))).resolves.toBeUndefined();
  for (const path of [
    join(managed, "current"),
    join(fixturePaths.home, ".pi", "agent", "extensions", "horsepower"),
    join(fixturePaths.home, ".pi", "agent", "skills", "horsepower"),
    join(fixturePaths.home, ".local", "bin", "horsepower"),
    join(managed, "settings.json"),
  ]) await expect(access(path), path).rejects.toThrow();
});

test("explicit Chinese locale persists privately and localizes installer conclusions", async () => {
  const result = await install(["--locale", "zh-CN"]);
  const settings = join(result.home, ".pi", "agent", "horsepower", "settings.json");
  expect(JSON.parse(await readFile(settings, "utf8"))).toMatchObject({ outputLocale: "zh-CN" });
  expect((await stat(settings)).mode & 0o777).toBe(0o600);
  expect(result.stdout).toContain("Horsepower 安装成功。");
  expect(result.stdout).toContain("horsepower setup");
});

test("a checksummed archive with an unexpected extra file is rejected before activation", async () => {
  const fixturePaths = await fixture();
  const hostile = join(fixturePaths.root, "extra-asset");
  const unpacked = join(fixturePaths.root, "unpacked");
  await mkdir(hostile);
  await mkdir(unpacked);
  await execFileAsync("tar", ["-xzf", join(releaseDir, `horsepower-v${version}.tar.gz`), "-C", unpacked]);
  await writeFile(join(unpacked, "horsepower", "unexpected.txt"), "not in the release layout");
  const archive = join(hostile, `horsepower-v${version}.tar.gz`);
  await execFileAsync("tar", ["-czf", archive, "horsepower"], { cwd: unpacked });
  const bytes = await readFile(archive);
  await writeFile(`${archive}.sha256`, `${createHash("sha256").update(bytes).digest("hex")}  ${archive.split("/").at(-1)}\n`);
  await expect(runInstaller(fixturePaths, [], `file://${hostile}`)).rejects.toMatchObject({ stderr: expect.stringContaining("unexpected archive entry") });
  await expect(access(join(fixturePaths.home, ".pi", "agent", "horsepower"))).rejects.toThrow();
});

test("a checksummed archive containing a symlink is rejected before extraction or activation", async () => {
  const fixturePaths = await fixture();
  const hostile = join(fixturePaths.root, "hostile");
  const unpacked = join(fixturePaths.root, "hostile-unpacked");
  await mkdir(hostile);
  await mkdir(unpacked);
  await execFileAsync("tar", ["-xzf", join(releaseDir, `horsepower-v${version}.tar.gz`), "-C", unpacked]);
  const replaced = join(unpacked, "horsepower", "LICENSE");
  await execFileAsync("rm", [replaced]);
  await execFileAsync("ln", ["-s", "/etc/passwd", replaced]);
  const archive = join(hostile, `horsepower-v${version}.tar.gz`);
  await execFileAsync("tar", ["-czf", archive, "horsepower"], { cwd: unpacked });
  const bytes = await readFile(archive);
  await writeFile(`${archive}.sha256`, `${createHash("sha256").update(bytes).digest("hex")}  ${archive.split("/").at(-1)}\n`);
  await expect(runInstaller(fixturePaths, [], `file://${hostile}`)).rejects.toMatchObject({ stderr: expect.stringContaining("unsafe link or entry type") });
  await expect(access(join(fixturePaths.home, ".pi", "agent", "horsepower"))).rejects.toThrow();
});

test("symlinked installation ancestors are rejected without mutating the external target", async () => {
  const fixturePaths = await fixture();
  const external = join(fixturePaths.root, "external");
  await mkdir(external);
  await mkdir(fixturePaths.home, { recursive: true });
  await symlink(external, join(fixturePaths.home, ".pi"));
  await expect(runInstaller(fixturePaths)).rejects.toMatchObject({ stderr: expect.stringContaining("unsafe installation ancestor") });
  await expect(access(join(external, "agent"))).rejects.toThrow();
});

test("a conflicting stable path is rejected before any managed installation mutation", async () => {
  const fixturePaths = await fixture();
  const conflict = join(fixturePaths.home, ".pi", "agent", "extensions", "horsepower");
  await mkdir(dirname(conflict), { recursive: true });
  await writeFile(conflict, "unrelated extension");
  await expect(runInstaller(fixturePaths)).rejects.toMatchObject({ stderr: expect.stringContaining(`conflicting path: ${conflict}`) });
  expect(await readFile(conflict, "utf8")).toBe("unrelated extension");
  await expect(access(join(fixturePaths.home, ".pi", "agent", "horsepower"))).rejects.toThrow();
});

test("repeated installation safely reuses the same immutable verified release", async () => {
  const fixturePaths = await fixture();
  await runInstaller(fixturePaths);
  const managedRoot = join(fixturePaths.home, ".pi", "agent", "horsepower");
  const before = await readFile(join(managedRoot, "versions", `v${version}`, "release-manifest.json"));
  await expect(runInstaller(fixturePaths)).resolves.toMatchObject({ stdout: expect.stringContaining("Horsepower installed successfully.") });
  expect(await readFile(join(managedRoot, "versions", `v${version}`, "release-manifest.json"))).toEqual(before);
  expect(await readlink(join(managedRoot, "current"))).toBe(`versions/v${version}`);
});

test("installed bundled CLI covers selected locales while retaining English internal state", async () => {
  for (const locale of selectedE2ELocales()) {
    const result = await install();
    const managed = join(result.home, ".pi", "agent", "horsepower");
    const cli = join(result.home, ".local", "bin", "horsepower");
    const extension = join(result.home, ".pi", "agent", "extensions", "horsepower");
    const skill = join(result.home, ".pi", "agent", "skills", "horsepower");
    const handoff = join(managed, "state", "handoffs", "retained-evidence");
    await mkdir(dirname(handoff), { recursive: true }); await writeFile(handoff, "English internal evidence");
    const env = { ...process.env, HOME: result.home, PATH: `${result.bin}:${process.env.PATH ?? ""}` };
    await execFileAsync(cli, ["configure", "--locale", locale, "--json"], { cwd: result.root, env });
    const doctor = JSON.parse((await execFileAsync(cli, ["doctor", "--installation-only", "--json"], { cwd: result.root, env })).stdout);
    expect(doctor, locale).toMatchObject({ outputLocale: locale, summary: locale === "zh-CN" ? "Horsepower 诊断已完成。" : "Horsepower diagnostics completed." });
    const disabled = JSON.parse((await execFileAsync(cli, ["disable", "--json"], { cwd: result.root, env })).stdout);
    expect(disabled, locale).toMatchObject({ ok: true, outputLocale: locale, summary: locale === "zh-CN" ? "Horsepower 已禁用；请运行 /reload 或重启 Pi。" : "Horsepower disabled; run /reload or restart Pi.", data: { integrationStatus: "disabled", reloadRequired: true } });
    await expect(access(extension), locale).rejects.toThrow(); await expect(access(skill), locale).rejects.toThrow();
    expect(await readFile(handoff, "utf8"), locale).toBe("English internal evidence");
    expect(await readlink(join(managed, "current")), locale).toBe(`versions/v${version}`);
    const enabled = JSON.parse((await execFileAsync(cli, ["enable", "--json"], { cwd: result.root, env })).stdout);
    expect(enabled, locale).toMatchObject({ ok: true, outputLocale: locale, summary: locale === "zh-CN" ? "Horsepower 已启用；请运行 /reload 或重启 Pi。" : "Horsepower enabled; run /reload or restart Pi.", data: { integrationStatus: "enabled", reloadRequired: true } });
    expect(await readlink(extension), locale).toBe(join(managed, "current/pi/extensions/horsepower"));
    expect(await readlink(skill), locale).toBe(join(managed, "current/pi/skills/horsepower"));
  }
});

test("clean non-interactive install verifies and activates stable symlinks with English guidance", async () => {
  const result = await install();
  const managedRoot = join(result.home, ".pi", "agent", "horsepower");
  expect(await readlink(join(managedRoot, "current"))).toBe(`versions/v${version}`);
  expect(await readlink(join(result.home, ".pi", "agent", "extensions", "horsepower"))).toBe(join(managedRoot, "current", "pi", "extensions", "horsepower"));
  expect(await readlink(join(result.home, ".pi", "agent", "skills", "horsepower"))).toBe(join(managedRoot, "current", "pi", "skills", "horsepower"));
  expect(await readlink(join(result.home, ".local", "bin", "horsepower"))).toBe(join(managedRoot, "current", "bin", "horsepower"));
  expect((await stat(join(managedRoot, "versions", `v${version}`, "bin", "horsepower"))).mode & 0o777).toBe(0o755);
  expect(JSON.parse(await readFile(join(managedRoot, "settings.json"), "utf8"))).toMatchObject({ outputLocale: "en" });
  expect(result.stdout).toContain("Horsepower installed successfully.");
  expect(result.stdout).toContain("horsepower setup");
  expect(result.stdout).toContain("horsepower configure --locale zh-CN");
});
