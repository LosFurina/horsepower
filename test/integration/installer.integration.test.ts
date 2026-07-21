import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, readlink, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const version = "0.1.0-alpha.1";
let releaseDir: string;

beforeAll(async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot });
  await execFileAsync(process.execPath, ["scripts/release.mjs", version], { cwd: repositoryRoot });
  releaseDir = join(repositoryRoot, "release");
});

async function fixture(options: { failInstallationDoctor?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "horsepower-installer-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  const openspec = join(bin, "openspec");
  await writeFile(openspec, "#!/bin/sh\nprintf '%s\\n' '1.6.0'\n", { mode: 0o755 });
  if (options.failInstallationDoctor) {
    const realNode = process.execPath;
    await writeFile(join(bin, "node"), `#!/bin/sh\ncase \"$*\" in *\"doctor --installation-only\"*) exit 42 ;; esac\nexec ${JSON.stringify(realNode)} \"$@\"\n`, { mode: 0o755 });
  }
  return { root, home, bin, openspec };
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

test("failed interactive setup restores the exact prior settings and existing topology", async () => {
  const fixturePaths = await fixture();
  await runInstaller(fixturePaths);
  const managed = join(fixturePaths.home, ".pi", "agent", "horsepower");
  const settingsPath = join(managed, "settings.json");
  const before = await readFile(settingsPath);
  const ttyInput = join(fixturePaths.root, "tty-input-invalid");
  const ttyOutput = join(fixturePaths.root, "tty-output-invalid");
  await writeFile(ttyInput, "https://example.test/hook\ninvalid-auth\n");
  await writeFile(ttyOutput, "");
  await expect(execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--version", version, "--locale", "zh-CN"], {
    cwd: fixturePaths.root,
    env: { ...process.env, HOME: fixturePaths.home, PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`, HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}`, HORSEPOWER_TTY_INPUT: ttyInput, HORSEPOWER_TTY_OUTPUT: ttyOutput },
  })).rejects.toMatchObject({ stderr: expect.stringMatching(/Horsepower 安装程序失败：.*invalid webhook authentication mode/u) });
  expect(await readFile(settingsPath)).toEqual(before);
  expect(await readlink(join(managed, "current"))).toBe(`versions/v${version}`);
  expect(await readlink(join(fixturePaths.home, ".local/bin/horsepower"))).toBe(join(managed, "current/bin/horsepower"));
});

test("interactive Bearer webhook setup stores a private token with dispatch disabled by default", async () => {
  const fixturePaths = await fixture();
  const ttyInput = join(fixturePaths.root, "tty-input-bearer");
  const ttyOutput = join(fixturePaths.root, "tty-output-bearer");
  const token = "installer-bearer-token";
  await writeFile(ttyInput, `1\nhttps://example.test/hook\nbearer\n${token}\n\n`);
  await writeFile(ttyOutput, "");
  const result = await execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--version", version], {
    cwd: fixturePaths.root,
    env: { ...process.env, HOME: fixturePaths.home, PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`, HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}`, HORSEPOWER_TTY_INPUT: ttyInput, HORSEPOWER_TTY_OUTPUT: ttyOutput },
  });
  expect(`${await readFile(ttyOutput, "utf8")}${result.stdout}${result.stderr}`).not.toContain(token);
  const settings = JSON.parse(await readFile(join(fixturePaths.home, ".pi", "agent", "horsepower", "settings.json"), "utf8"));
  expect(settings.webhook).toMatchObject({ auth: { mode: "bearer", token }, notifications: { change: true, dispatch: false } });
});

test("unsupported OpenSpec is rejected before any managed filesystem mutation", async () => {
  const fixturePaths = await fixture();
  await writeFile(fixturePaths.openspec, "#!/bin/sh\nprintf '%s\\n' '1.5.9'\n", { mode: 0o755 });
  await expect(runInstaller(fixturePaths)).rejects.toMatchObject({ stderr: expect.stringContaining("OpenSpec 1.6.0 or newer is required") });
  await expect(access(join(fixturePaths.home, ".pi"))).rejects.toThrow();
});

test("interactive HMAC webhook setup stores private credentials and dispatch opt-in without echoing secrets", async () => {
  const fixturePaths = await fixture();
  const ttyInput = join(fixturePaths.root, "tty-input-hmac");
  const ttyOutput = join(fixturePaths.root, "tty-output-hmac");
  const secret = "installer-hmac-secret";
  await writeFile(ttyInput, `1\nhttps://example.test/hook\nhmac\n${secret}\ny\n`);
  await writeFile(ttyOutput, "");
  const result = await execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--version", version], {
    cwd: fixturePaths.root,
    env: { ...process.env, HOME: fixturePaths.home, PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`, HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}`, HORSEPOWER_TTY_INPUT: ttyInput, HORSEPOWER_TTY_OUTPUT: ttyOutput },
  });
  const output = `${await readFile(ttyOutput, "utf8")}\n${result.stdout}\n${result.stderr}`;
  expect(output).not.toContain(secret);
  const settingsPath = join(fixturePaths.home, ".pi", "agent", "horsepower", "settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  expect(settings).toMatchObject({ outputLocale: "en", webhook: { enabled: true, url: "https://example.test/hook", auth: { mode: "hmac", secret }, notifications: { change: true, dispatch: true } } });
  expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
});

test("interactive installation starts bilingual, selects Chinese, and permits skipped webhook", async () => {
  const fixturePaths = await fixture();
  const ttyInput = join(fixturePaths.root, "tty-input");
  const ttyOutput = join(fixturePaths.root, "tty-output");
  await writeFile(ttyInput, "2\n\n");
  await writeFile(ttyOutput, "");
  const result = await execFileAsync("sh", [join(repositoryRoot, "install.sh"), "--version", version], {
    cwd: fixturePaths.root,
    env: { ...process.env, HOME: fixturePaths.home, PATH: `${fixturePaths.bin}:${process.env.PATH ?? ""}`, HORSEPOWER_RELEASE_BASE_URL: `file://${releaseDir}`, HORSEPOWER_TTY_INPUT: ttyInput, HORSEPOWER_TTY_OUTPUT: ttyOutput },
  });
  const output = `${await readFile(ttyOutput, "utf8")}\n${result.stdout}`;
  expect(output).toContain("Choose language / 选择语言");
  expect(output).toContain("Webhook URL（留空跳过）");
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
