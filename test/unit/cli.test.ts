import { createHash } from "node:crypto";
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

const releaseEntryPoints = {
  cli: "bin/horsepower",
  extension: "pi/extensions/horsepower/index.js",
  skill: "pi/skills/horsepower/SKILL.md",
};

async function writeRelease(root: string, version: string): Promise<void> {
  for (const path of Object.values(releaseEntryPoints)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), `owned:${path}\n`);
  }
  const digests = Object.fromEntries(await Promise.all(Object.values(releaseEntryPoints).map(async (path) => [
    path,
    createHash("sha256").update(await readFile(join(root, path))).digest("hex"),
  ])));
  await writeFile(join(root, "release-manifest.json"), JSON.stringify({
    version,
    compatibility: { node: ">=22.19.0", pi: "0.80.10", openspec: ">=1.6.0" },
    entryPoints: releaseEntryPoints,
    digests,
  }));
}

test("strictly parses commands and emits deterministic JSON with stable exit codes", async () => {
  const { run } = await harness();
  expect(await run(["unknown", "--json"])).toEqual({
    exitCode: 2,
    stdout: "",
    stderr: '{"error":{"code":"USAGE","message":"Unknown command: unknown"},"ok":false}\n',
  });
  expect((await run(setupArgs)).stdout).toBe((await run(setupArgs)).stdout);
  expect((await run(["slots", "--bogus"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["slots", "--json", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["--json", "slots"]))).toMatchObject({ exitCode: 0, stderr: "" });
  expect((await run(["webhook", "--json", "configure", "--url", "https://example.test", "--auth", "none"]))).toMatchObject({ exitCode: 0, stderr: "" });
  expect((await run(["webhook", "configure", "--url", "https://example.test", "--auth", "none", "--change", "--no-change", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["webhook", "configure", "--url", "https://example.test", "--auth", "none", "--dispatch", "--no-dispatch", "--json"]))).toMatchObject({ exitCode: 2 });
  for (const incompatible of [
    ["--auth", "none", "--secret", "secret-byte"],
    ["--auth", "none", "--token", "token-byte"],
    ["--auth", "hmac", "--secret", "secret-byte", "--token", "token-byte"],
    ["--auth", "bearer", "--token", "token-byte", "--secret", "secret-byte"],
  ]) {
    expect((await run(["webhook", "configure", "--url", "https://example.test", ...incompatible, "--json"]))).toMatchObject({ exitCode: 2 });
  }
});

test("invalid webhook auth argv never appears in text or JSON diagnostics", async () => {
  const { run } = await harness();
  const supplied = "attacker-secret-auth-bytes";
  for (const argv of [
    ["webhook", "configure", "--url", "https://example.test", "--auth", supplied],
    ["webhook", "configure", "--url", "https://example.test", "--auth", supplied, "--json"],
  ]) {
    const result = await run(argv);
    expect(result.exitCode).toBe(2);
    expect(result.stdout + result.stderr).not.toContain(supplied);
    expect(result.stderr).toContain("Invalid webhook auth mode");
  }
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
  expect((await run(["set", "Bad Slot", "--fallback", "utility", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["set", "vision", "--model", "missing/model", "--thinking", "low", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["set", "vision", "--model", "provider/util", "--thinking", "extreme", "--json"]))).toMatchObject({ exitCode: 2 });
  expect((await run(["configure", "--utility", "missing/model", "--utility-thinking", "low", "--json"]))).toMatchObject({ exitCode: 2 });
  const invalidSetup = [...setupArgs];
  invalidSetup[invalidSetup.indexOf("high")] = "extreme";
  expect((await run(invalidSetup)).exitCode).toBe(2);
  expect((await run(["unset", "craft", "--scope", "project", "--json"]))).toMatchObject({ exitCode: 0 });
  expect(JSON.parse((await run(["slots", "--json"])).stdout).data.effective.craft.model).toBe("provider/craft");
  expect((await run(["unset", "utility", "--json"]))).toMatchObject({ exitCode: 2 });
});

test("webhook configure and disable deep-patch unknown nested settings", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  await writeFile(settingsPath, JSON.stringify({
    futureTopLevel: { keep: true },
    webhook: {
      future: { metadata: { keep: true } },
      notifications: { change: false, dispatch: false, futurePolicy: { retries: 7 } },
      auth: { mode: "none", futureMetadata: { keep: true } },
      headers: { authorization: "remove-this-credential", futureHeaderMetadata: { keep: true } },
    },
  }));

  expect(await run(["webhook", "configure", "--url", "https://example.test/hook", "--auth", "none", "--dispatch", "--json"])).toMatchObject({ exitCode: 0 });
  const configured = JSON.parse(await readFile(settingsPath, "utf8"));
  expect(configured).toMatchObject({
    futureTopLevel: { keep: true },
    webhook: {
      future: { metadata: { keep: true } },
      notifications: { change: false, dispatch: true, futurePolicy: { retries: 7 } },
      auth: { mode: "none", futureMetadata: { keep: true } },
      headers: { authorization: "remove-this-credential", futureHeaderMetadata: { keep: true } },
    },
  });

  expect(await run(["webhook", "disable", "--json"])).toMatchObject({ exitCode: 0 });
  const disabled = JSON.parse(await readFile(settingsPath, "utf8"));
  expect(disabled).toMatchObject({
    futureTopLevel: { keep: true },
    webhook: {
      enabled: false,
      future: { metadata: { keep: true } },
      notifications: { change: false, dispatch: true, futurePolicy: { retries: 7 } },
      headers: { futureHeaderMetadata: { keep: true } },
    },
  });
  expect(disabled.webhook).not.toHaveProperty("auth");
  expect(JSON.stringify(disabled)).not.toContain("remove-this-credential");
});

test("webhook disable removes credentials nested in unknown arrays while preserving safe metadata", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const credentialBytes = ["nested-token-bytes", "nested-auth-bytes", "nested-password-bytes"];
  await writeFile(settingsPath, JSON.stringify({
    webhook: {
      enabled: true,
      url: "https://example.test/hook",
      unknown: [
        "safe-label",
        { safe: "keep", token: credentialBytes[0] },
        [{ authentication: credentialBytes[1], nested: { password: credentialBytes[2], safe: 7 } }],
      ],
    },
  }));

  expect(await run(["webhook", "disable", "--json"])).toMatchObject({ exitCode: 0 });
  const persistedBytes = await readFile(settingsPath, "utf8");
  for (const credential of credentialBytes) expect(persistedBytes).not.toContain(credential);
  expect(JSON.parse(persistedBytes).webhook.unknown).toEqual([
    "safe-label",
    { safe: "keep" },
    [{ nested: { safe: 7 } }],
  ]);
});

test("CLI webhook settings exactly match runtime parsing and disabled settings remove credentials", async () => {
  const secret = "never-print-this";
  const { homeDir, cwd, run } = await harness();
  await run(setupArgs);
  const configured = await run([
    "webhook", "configure", "--url", "https://example.test/hook", "--auth", "hmac", "--secret", secret,
    "--change", "--dispatch", "--json",
  ]);
  expect(configured.exitCode).toBe(0);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  expect((await stat(settingsPath)).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(settingsPath, "utf8"))).toMatchObject({
    webhook: { url: "https://example.test/hook", notifications: { change: true, dispatch: true }, auth: { mode: "hmac", secret } },
  });
  const { webhookOptions } = await import("../../src/extension/index.js");
  expect(webhookOptions(homeDir, cwd)).toEqual({
    config: { url: "https://example.test/hook", auth: { mode: "hmac", secret } },
    notifications: { change: true, dispatch: true },
  });

  const withFuture = JSON.parse(await readFile(settingsPath, "utf8"));
  withFuture.webhook.future = { keep: true };
  withFuture.webhook.headers = { authorization: "stale-credential" };
  await writeFile(settingsPath, JSON.stringify(withFuture));
  expect(await run(["webhook", "skip", "--json"])).toMatchObject({ exitCode: 0 });
  expect(webhookOptions(homeDir, cwd)).toBeUndefined();
  const disabled = JSON.parse(await readFile(settingsPath, "utf8")).webhook;
  expect(disabled).toMatchObject({ enabled: false, future: { keep: true } });
  expect(JSON.stringify(disabled)).not.toContain(secret);
  expect(JSON.stringify(disabled)).not.toContain("stale-credential");
  expect(disabled).not.toHaveProperty("url");
  expect(disabled).not.toHaveProperty("auth");
});

test("webhook diagnostics recursively redact malformed and future credential fields", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const credentials = ["deep-secret", "future-token", "raw-authorization", "auth-value", "future-value"];
  await writeFile(settingsPath, JSON.stringify({
    webhook: {
      enabled: true,
      url: "https://example.test/hook",
      auth: { mode: "future", secret: credentials[0], value: credentials[4], nested: { refreshToken: credentials[1] } },
      headers: { Authorization: credentials[2], authentication: credentials[3] },
      notifications: { change: true, dispatch: false },
    },
  }));
  for (const args of [["configure", "--json"], ["doctor", "--json"]]) {
    const output = await run(args);
    for (const credential of credentials) expect(output.stdout + output.stderr).not.toContain(credential);
  }
  const shown = JSON.parse((await run(["configure", "--json"])).stdout).data;
  expect(shown.webhook.auth.secret).toBe("[REDACTED]");
  expect(shown.webhook.auth.value).toBe("[REDACTED]");
  expect(shown.webhook.auth.nested.refreshToken).toBe("[REDACTED]");
  expect(shown.webhook.headers.Authorization).toBe("[REDACTED]");
  expect(shown.webhook.headers.authentication).toBe("[REDACTED]");
  const notification = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks.find((check: { id: string }) => check.id === "notification");
  expect(notification).toMatchObject({ status: "error", action: expect.stringContaining("webhook configure") });
});

test("webhook diagnostics redact every primitive in malformed authentication structures and URL userinfo", async () => {
  const { homeDir, run } = await harness();
  await run(setupArgs);
  const settingsPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const secrets = ["array-secret", "object-secret", "bad-mode-secret", "url-user", "url-password"];
  await writeFile(settingsPath, JSON.stringify({
    webhook: {
      enabled: true,
      url: `https://${secrets[3]}:${secrets[4]}@example.test/hook`,
      authentication: {
        mode: secrets[2],
        unknown: [secrets[0], { future: secrets[1] }],
      },
    },
  }));
  for (const args of [["configure", "--json"], ["doctor", "--json"], ["webhook", "test", "--json"]]) {
    const output = await run(args);
    for (const secret of secrets) expect(output.stdout + output.stderr).not.toContain(secret);
  }

  const attempted = await run(["webhook", "configure", "--url", "https://url-user:url-password@example.test/hook", "--auth", "none", "--json"]);
  expect(attempted).toMatchObject({ exitCode: 2 });
  expect(attempted.stderr).not.toContain("url-user");
  expect(attempted.stderr).not.toContain("url-password");
});

test("doctor and webhook test use effective project-over-global webhook settings", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), authorization: new Headers(init?.headers).get("authorization") });
    return new Response(null, { status: 204 });
  });
  const { homeDir, cwd, run } = await harness({ fetch });
  await run(setupArgs);
  const globalPath = join(homeDir, ".pi/agent/horsepower/settings.json");
  const projectPath = join(cwd, ".pi/horsepower/settings.json");
  await mkdir(dirname(projectPath), { recursive: true });
  await writeFile(globalPath, JSON.stringify({ webhook: { enabled: true, url: "https://global.test/hook", auth: { mode: "bearer", token: "global-token" }, future: { safe: true } } }));
  await writeFile(projectPath, JSON.stringify({ webhook: { url: "https://project.test/hook", auth: { mode: "bearer", token: "project-token" }, unknown: ["safe-label"] } }));

  expect((await run(["webhook", "test", "--json"])).exitCode).toBe(0);
  expect(requests).toEqual([{ url: "https://project.test/hook", authorization: "Bearer project-token" }]);

  await writeFile(projectPath, JSON.stringify({ webhook: { enabled: false, unknown: { keep: true } } }));
  const disabledChecks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
  expect(disabledChecks.find((check: { id: string }) => check.id === "notification")).toMatchObject({ status: "skipped" });

  for (const auth of [
    { mode: "hmac", secret: ["malformed-project-secret"] },
    { mode: "none", secret: "incompatible-project-secret" },
    { mode: "hmac", secret: "valid-secret", token: "incompatible-project-token" },
  ]) {
    await writeFile(projectPath, JSON.stringify({ webhook: { enabled: true, auth } }));
    const invalid = await run(["doctor", "--json"]);
    expect(invalid.exitCode).toBe(1);
    expect(invalid.stdout + invalid.stderr).not.toContain("malformed-project-secret");
    expect(invalid.stdout + invalid.stderr).not.toContain("incompatible-project-secret");
    expect(invalid.stdout + invalid.stderr).not.toContain("incompatible-project-token");
    expect(JSON.parse(invalid.stdout).data.checks.find((check: { id: string }) => check.id === "notification")).toMatchObject({ status: "error" });
  }
});

test("webhook test sends HMAC and Bearer authentication headers", async () => {
  const requests: RequestInit[] = [];
  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => { requests.push(init ?? {}); return new Response(null, { status: 204 }); });
  const { run } = await harness({ fetch });
  await run(setupArgs);
  await run(["webhook", "configure", "--url", "https://example.test/hook", "--auth", "hmac", "--secret", "hmac-value", "--json"]);
  expect((await run(["webhook", "test", "--json"])).exitCode).toBe(0);
  expect(new Headers(requests[0]!.headers).get("x-horsepower-signature")).toMatch(/^[a-f0-9]{64}$/u);
  expect(new Headers(requests[0]!.headers).get("authorization")).toBeNull();
  await run(["webhook", "configure", "--url", "https://example.test/hook", "--auth", "bearer", "--token", "bearer-value", "--json"]);
  expect((await run(["webhook", "test", "--json"])).exitCode).toBe(0);
  expect(new Headers(requests[1]!.headers).get("authorization")).toBe("Bearer bearer-value");
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

test("doctor absorbs malformed global and project settings into stable redacted checks", async () => {
  for (const scope of ["global", "project"] as const) {
    const { homeDir, cwd, run } = await harness();
    await run(setupArgs);
    const settingsPath = scope === "global"
      ? join(homeDir, ".pi/agent/horsepower/settings.json")
      : join(cwd, ".pi/horsepower/settings.json");
    await mkdir(dirname(settingsPath), { recursive: true });
    const secret = `${scope}-settings-secret`;
    await writeFile(settingsPath, `{"webhook":{"auth":{"token":"${secret}"}`);

    const first = await run(["doctor", "--json"]);
    const second = await run(["doctor", "--json"]);
    expect(first, scope).toEqual(second);
    expect(first, scope).toMatchObject({ exitCode: 1, stderr: "" });
    expect(first.stdout, scope).not.toContain(secret);
    const checks = JSON.parse(first.stdout).data.checks;
    expect(checks.map((check: { id: string }) => check.id), scope).toEqual([
      "configuration", "notification", "openspec", "model-registry", "installation",
    ]);
    expect(checks.find((check: { id: string }) => check.id === "notification"), scope).toMatchObject({
      status: "error",
      message: `Malformed JSON in ${settingsPath}`,
      action: expect.stringContaining(settingsPath),
    });
  }
});

test("doctor absorbs unreadable global and project settings into path-specific checks", async () => {
  for (const scope of ["global", "project"] as const) {
    const { homeDir, cwd, run } = await harness();
    await run(setupArgs);
    const settingsPath = scope === "global"
      ? join(homeDir, ".pi/agent/horsepower/settings.json")
      : join(cwd, ".pi/horsepower/settings.json");
    await rm(settingsPath, { force: true });
    await mkdir(settingsPath, { recursive: true });

    const result = await run(["doctor", "--json"]);
    expect(result, scope).toMatchObject({ exitCode: 1, stderr: "" });
    const checks = JSON.parse(result.stdout).data.checks;
    expect(checks.map((check: { id: string }) => check.id), scope).toEqual([
      "configuration", "notification", "openspec", "model-registry", "installation",
    ]);
    expect(checks.find((check: { id: string }) => check.id === "notification"), scope).toMatchObject({
      status: "error",
      message: expect.stringContaining(settingsPath),
      action: expect.stringContaining(settingsPath),
    });
  }
});

test("doctor distinguishes healthy, missing, stale, and unofficial OpenSpec integration", async () => {
  for (const [kind, expected] of [["healthy", "ok"], ["missing", "error"], ["stale", "error"], ["unofficial", "error"]] as const) {
    const { cwd, run } = await harness();
    if (kind !== "missing") {
      const generated = kind === "stale" ? "1.5.0" : "1.6.0";
      await mkdir(join(cwd, ".pi/skills/openspec-apply-change"), { recursive: true });
      await mkdir(join(cwd, ".pi/prompts"), { recursive: true });
      await writeFile(join(cwd, ".pi/skills/openspec-apply-change/SKILL.md"), kind === "unofficial"
        ? `name: arbitrary\ngeneratedBy: \"${generated}\"`
        : `name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: \"${generated}\"`);
      await writeFile(join(cwd, ".pi/prompts/opsx-apply.md"), kind === "unofficial"
        ? "arbitrary file"
        : "Implement tasks from an OpenSpec change.");
    }
    const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
    expect(checks.find((check: { id: string }) => check.id === "openspec").status).toBe(expected);
  }
});

test("doctor rejects malformed partial OpenSpec semver", async () => {
  const { run } = await harness({ runOpenSpec: async (args: readonly string[]) => args[0] === "--version"
    ? { code: 0, stdout: "1.6.\n", stderr: "" }
    : { code: 0, stdout: JSON.stringify({ root: { path: "/project", healthy: true } }), stderr: "" } });
  const checks = JSON.parse((await run(["doctor", "--json"])).stdout).data.checks;
  expect(checks.find((check: { id: string }) => check.id === "openspec")).toMatchObject({ status: "error", message: expect.stringContaining("1.6.0") });
});

test("staged-release preflight validates manifest, version, layout, and current/link ownership", async () => {
  const { homeDir, root, run } = await harness();
  const staged = join(root, "horsepower");
  await writeRelease(staged, "0.1.0-alpha.1");
  expect(await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 0 });

  const linkedStage = join(root, "linked-stage");
  await symlink(staged, linkedStage);
  expect(await run(["preflight", linkedStage, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 1 });

  const hp = join(homeDir, ".pi/agent/horsepower");
  const externalRoot = join(root, "external-install");
  await mkdir(externalRoot);
  await mkdir(dirname(hp), { recursive: true });
  await symlink(externalRoot, hp);
  expect(await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 1 });
  await rm(hp);

  const cliLink = join(homeDir, ".local/bin/horsepower");
  await mkdir(dirname(cliLink), { recursive: true });
  await symlink("/unrelated", cliLink);
  const ownership = await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"]);
  expect(ownership).toMatchObject({ exitCode: 1 });
  expect(ownership.stderr).toContain("unrelated symlink");

  await writeFile(join(staged, "release-manifest.json"), JSON.stringify({ version: "wrong", entryPoints: {} }));
  expect(await run(["preflight", staged, "--version", "0.1.0-alpha.1", "--json"])).toMatchObject({ exitCode: 1 });
});

test("preflight rejects symlinked manifests, intermediate directories, and invalid semver", async () => {
  for (const hostile of ["manifest", "intermediate", "expected-version", "manifest-version"] as const) {
    const { root, run } = await harness();
    const staged = join(root, `staged-${hostile}`);
    const manifestVersion = hostile === "manifest-version" ? "01.0.0" : "0.1.0";
    await writeRelease(staged, manifestVersion);
    if (hostile === "manifest") {
      const external = join(root, "external-manifest.json");
      await writeFile(external, await readFile(join(staged, "release-manifest.json")));
      await rm(join(staged, "release-manifest.json"));
      await symlink(external, join(staged, "release-manifest.json"));
    }
    if (hostile === "intermediate") {
      const externalBin = join(root, "external-bin");
      await mkdir(externalBin);
      await writeFile(join(externalBin, "horsepower"), "external");
      await rm(join(staged, "bin"), { recursive: true });
      await symlink(externalBin, join(staged, "bin"));
    }
    const expected = hostile === "expected-version" ? "01.0.0" : hostile === "manifest-version" ? "0.1.0" : manifestVersion;
    expect(await run(["preflight", staged, "--version", expected, "--json"]), hostile).toMatchObject({ exitCode: hostile === "expected-version" ? 2 : 1 });
  }
});

test("preflight rejects symlinked destination ancestors and versions without touching external paths", async () => {
  for (const hostile of ["ancestor", "versions"] as const) {
    const { homeDir, root, run } = await harness();
    const staged = join(root, `staged-${hostile}`);
    await writeRelease(staged, "0.1.0");
    const external = join(root, `external-${hostile}`);
    await mkdir(external, { recursive: true });
    const marker = join(external, "keep");
    await writeFile(marker, "external data");

    if (hostile === "ancestor") {
      await mkdir(homeDir, { recursive: true });
      await symlink(external, join(homeDir, ".pi"));
    } else {
      const horsepowerRoot = join(homeDir, ".pi/agent/horsepower");
      await mkdir(horsepowerRoot, { recursive: true });
      await symlink(external, join(horsepowerRoot, "versions"));
    }

    const result = await run(["preflight", staged, "--version", "0.1.0", "--json"]);
    expect(result, hostile).toMatchObject({ exitCode: 1, stdout: "" });
    expect(await readFile(marker, "utf8"), hostile).toBe("external data");
  }
});

test("safe uninstall removes only owned topology while preserving user data", async () => {
  const { homeDir, cwd, run } = await harness();
  const hp = join(homeDir, ".pi/agent/horsepower");
  const version = join(hp, "versions/v0.1.0-alpha.1");
  await writeRelease(version, "0.1.0-alpha.1");
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

test("uninstall refuses an arbitrary version directory with a trivial manifest and preserves it", async () => {
  const { homeDir, run } = await harness();
  const release = join(homeDir, ".pi/agent/horsepower/versions/v0.1.0");
  await mkdir(release, { recursive: true });
  await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "0.1.0" }));
  await writeFile(join(release, "user-data.txt"), "must remain");

  expect(await run(["uninstall", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await readFile(join(release, "user-data.txt"), "utf8")).toBe("must remain");
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

test("doctor reports malformed managed release topology as actionable installation checks", async () => {
  for (const hostile of ["trivial", "compatibility", "entrypoint", "digest-shape", "digest-mismatch", "symlink"] as const) {
    const { homeDir, root, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    const release = join(hp, "versions/v0.1.0");
    await writeRelease(release, "0.1.0");
    const manifestPath = join(release, "release-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (hostile === "trivial") await writeFile(manifestPath, JSON.stringify({ version: "0.1.0" }));
    if (hostile === "compatibility") {
      manifest.compatibility = { node: "", pi: "0.80.10", openspec: ">=1.6.0" };
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "entrypoint") {
      manifest.entryPoints.cli = "bin/not-horsepower";
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "digest-shape") {
      manifest.digests[releaseEntryPoints.cli] = "not-a-sha256";
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "digest-mismatch") {
      manifest.digests[releaseEntryPoints.cli] = "0".repeat(64);
      await writeFile(manifestPath, JSON.stringify(manifest));
    }
    if (hostile === "symlink") {
      const external = join(root, "external-cli");
      await writeFile(external, "external");
      await rm(join(release, releaseEntryPoints.cli));
      await symlink(external, join(release, releaseEntryPoints.cli));
    }
    await symlink("versions/v0.1.0", join(hp, "current"));

    const result = await run(["doctor", "--json"]);
    expect(result.stdout, hostile).not.toBe("");
    expect(result.stderr, hostile).toBe("");
    expect(result.exitCode, hostile).toBe(1);
    expect(JSON.parse(result.stdout).data.checks.find((check: { id: string }) => check.id === "installation"), hostile).toMatchObject({
      status: "error",
      action: "Install or repair Horsepower from an official release",
    });
  }
});

test("current ownership and uninstall reject an external symlinked manifest", async () => {
  const { homeDir, root, run } = await harness();
  const hp = join(homeDir, ".pi/agent/horsepower");
  const release = join(hp, "versions/v0.1.0");
  await mkdir(release, { recursive: true });
  const externalManifest = join(root, "external-release-manifest.json");
  await writeFile(externalManifest, JSON.stringify({ version: "0.1.0" }));
  await symlink(externalManifest, join(release, "release-manifest.json"));
  await symlink("versions/v0.1.0", join(hp, "current"));

  const doctor = await run(["doctor", "--json"]);
  expect(JSON.parse(doctor.stdout).data.checks.find((check: { id: string }) => check.id === "installation")).toMatchObject({ status: "error" });
  expect((await run(["uninstall", "--json"])).exitCode).toBe(1);
  expect(await readFile(externalManifest, "utf8")).toContain("0.1.0");
  expect(await readlink(join(release, "release-manifest.json"))).toBe(externalManifest);
});

test("uninstall removes only a verified direct current release target", async () => {
  for (const deceptive of ["nested", "dangling", "mismatch", "invalid-version"] as const) {
    const { homeDir, run } = await harness();
    const hp = join(homeDir, ".pi/agent/horsepower");
    const versions = join(hp, "versions");
    await mkdir(versions, { recursive: true });
    let target: string;
    if (deceptive === "nested") {
      const release = join(versions, "container/v0.1.0");
      await mkdir(release, { recursive: true });
      await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "0.1.0" }));
      target = "versions/container/v0.1.0";
    } else if (deceptive === "dangling") {
      target = "versions/v0.1.0";
    } else if (deceptive === "mismatch") {
      const release = join(versions, "v0.1.0");
      await mkdir(release);
      await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "0.2.0" }));
      target = "versions/v0.1.0";
    } else {
      const release = join(versions, "v01.0.0");
      await mkdir(release);
      await writeFile(join(release, "release-manifest.json"), JSON.stringify({ version: "01.0.0" }));
      target = "versions/v01.0.0";
    }
    await symlink(target, join(hp, "current"));
    const result = await run(["uninstall", "--json"]);
    expect(result.exitCode, deceptive).toBe(1);
    expect(await readlink(join(hp, "current"))).toBe(target);
  }
});

test("uninstall and purge reject a symlinked home trust root without touching external data", async () => {
  const root = await temp();
  const externalHome = join(root, "external-home");
  const homeDir = join(root, "home-link");
  const cwd = join(root, "project");
  await mkdir(join(externalHome, ".pi/agent/horsepower"), { recursive: true });
  await mkdir(cwd);
  const marker = join(externalHome, ".pi/agent/horsepower/keep");
  await writeFile(marker, "external data");
  await symlink(externalHome, homeDir);
  const { createCli } = await import("../../src/cli/app.js");
  const cli = createCli({
    homeDir,
    cwd,
    platform: "linux",
    models,
    runOpenSpec: async () => ({ code: 1, stdout: "", stderr: "" }),
  });

  expect(await cli.run(["uninstall", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await cli.run(["purge", "--yes", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await readFile(marker, "utf8")).toBe("external data");
  expect(await readlink(homeDir)).toBe(externalHome);
});

test("purge rejects a symlinked project trust root without touching external data", async () => {
  const root = await temp();
  const homeDir = join(root, "home");
  const externalProject = join(root, "external-project");
  const cwd = join(root, "project-link");
  await mkdir(homeDir);
  await mkdir(join(externalProject, ".pi/horsepower"), { recursive: true });
  const marker = join(externalProject, ".pi/horsepower/keep");
  await writeFile(marker, "external data");
  await symlink(externalProject, cwd);
  const { createCli } = await import("../../src/cli/app.js");
  const cli = createCli({
    homeDir,
    cwd,
    platform: "linux",
    models,
    runOpenSpec: async () => ({ code: 1, stdout: "", stderr: "" }),
  });

  expect(await cli.run(["purge", "--yes", "--json"])).toMatchObject({ exitCode: 1 });
  expect(await readFile(marker, "utf8")).toBe("external data");
  expect(await readlink(cwd)).toBe(externalProject);
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

test("purge refuses project and global symlinked parent components", async () => {
  for (const scope of ["project", "global"] as const) {
    const { homeDir, cwd, root, run } = await harness();
    const outside = join(root, `outside-${scope}`);
    await mkdir(join(outside, "horsepower"), { recursive: true });
    await writeFile(join(outside, "horsepower/keep"), "external data");
    const parent = scope === "project" ? join(cwd, ".pi") : join(homeDir, ".pi");
    await mkdir(dirname(parent), { recursive: true });
    await symlink(outside, parent);

    expect(await run(["purge", "--yes", "--json"]), scope).toMatchObject({ exitCode: 1 });
    expect(await readFile(join(outside, "horsepower/keep"), "utf8"), scope).toBe("external data");
    expect(await readlink(parent), scope).toBe(outside);
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

test("interactive purge requires an explicit yes and a negative answer changes nothing", async () => {
  const confirmNo = vi.fn(async () => false);
  const rejected = await harness({ interactive: true, confirm: confirmNo });
  await mkdir(join(rejected.homeDir, ".pi/agent/horsepower/memory"), { recursive: true });
  await writeFile(join(rejected.homeDir, ".pi/agent/horsepower/memory/keep"), "safe");
  await mkdir(join(rejected.cwd, ".pi/horsepower"), { recursive: true });
  expect(await rejected.run(["purge", "--json"])).toMatchObject({ exitCode: 0 });
  expect(confirmNo).toHaveBeenCalledOnce();
  expect(await readFile(join(rejected.homeDir, ".pi/agent/horsepower/memory/keep"), "utf8")).toBe("safe");
  expect(await stat(join(rejected.cwd, ".pi/horsepower"))).toBeTruthy();

  const confirmYes = vi.fn(async () => true);
  const accepted = await harness({ interactive: true, confirm: confirmYes });
  await mkdir(join(accepted.homeDir, ".pi/agent/horsepower/memory"), { recursive: true });
  await mkdir(join(accepted.cwd, ".pi/horsepower"), { recursive: true });
  expect(await accepted.run(["purge", "--json"])).toMatchObject({ exitCode: 0 });
  expect(confirmYes).toHaveBeenCalledOnce();
  await expect(lstat(join(accepted.homeDir, ".pi/agent/horsepower"))).rejects.toMatchObject({ code: "ENOENT" });
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
