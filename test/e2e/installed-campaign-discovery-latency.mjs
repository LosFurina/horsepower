#!/usr/bin/env node
/**
 * Real official Pi RPC latency harness for campaign change discovery (OpenSpec task 1.3).
 *
 * Measures wall-clock time from submitting `/horsepower-campaign` to the first
 * discovered-change picker (`extension_ui_request` select titled for OpenSpec changes).
 *
 * Documented acceptance budget: 20_000 ms for a bounded multi-change fixture.
 * The budget is generous enough for supported CI variance but low enough to catch the
 * alpha.26 serial 30s+ regression with seven unfinished strictly valid changes.
 *
 * Hosts where OpenSpec CLI is unusually fast still need a deterministic cost model so
 * the gate stays RED on serial discovery. The harness therefore wraps the official
 * OpenSpec executable with a fixed per-invocation delay that reproduces the documented
 * serial topology cost (installation validation once per candidate + status/validate).
 * The wrapper still executes the real CLI; it does not fake discovery results.
 *
 * Topology cost model (alpha.26 serial path, 7 candidates):
 *   setup: --version, doctor, list                         => 3 invocations
 *   per candidate: --version, doctor, status, validate     => 4 * 7 = 28
 *   total serial invocations ≈ 31
 * With OPENSPEC_INVOCATION_DELAY_MS=900:
 *   serial ≈ 31 * 900ms = 27_900ms  (> 20_000 budget → RED on alpha.26)
 *   target once-per-op + concurrency-4 ≈ (3 + ceil(7/4)*2) * 900ms ≈ 6_300ms (GREEN after fix)
 *
 * Runs offline against the installed immutable release, creates no campaign, and
 * records release identity (version + extension digest).
 *
 * Usage:
 *   node test/e2e/installed-campaign-discovery-latency.mjs [evidence.json]
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const installedRoot = resolve(process.env.HOME, ".pi/agent/horsepower/current");
const extensionPath = join(installedRoot, "pi/extensions/horsepower/index.js");
const repositoryPackage = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
const expectedVersion = process.env.HORSEPOWER_EXPECTED_VERSION ?? repositoryPackage.version;
/** Documented user-facing acceptance budget for first multi-change picker. */
const PICKER_ACCEPTANCE_BUDGET_MS = 20_000;
/** Hard ceiling so a hung process fails with a timeout rather than hanging CI. */
const HARNESS_TIMEOUT_MS = 90_000;
/** Minimum unfinished strictly-valid candidates required for the multi-change gate. */
const MIN_FIXTURE_CANDIDATES = 7;
/**
 * Fixed per-OpenSpec-invocation delay used only under the Pi child PATH.
 * Chosen so serial alpha.26 topology exceeds the budget while concurrent
 * once-per-operation discovery remains comfortably under it.
 */
const OPENSPEC_INVOCATION_DELAY_MS = 900;
const evidencePath = process.argv[2] ? resolve(process.argv[2]) : undefined;
const roots = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function command(bin, args, cwd, env = process.env) {
  const result = spawnSync(bin, args, {
    cwd,
    encoding: "utf8",
    env: { ...env, PI_OFFLINE: "1", OPENSPEC_TELEMETRY: "0" },
  });
  assert.equal(result.status, 0, `${bin} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function resolveOfficialOpenSpec() {
  const result = spawnSync("/usr/bin/env", ["bash", "-lc", "command -v openspec"], { encoding: "utf8" });
  assert.equal(result.status, 0, `official openspec CLI must be on PATH: ${result.stderr}`);
  const path = result.stdout.trim();
  assert.ok(path, "official openspec CLI path is empty");
  return path;
}

async function tree(root) {
  const values = [];
  async function visit(path, relative = "") {
    for (const name of (await readdir(path)).sort()) {
      const absolute = join(path, name);
      const rel = relative ? join(relative, name) : name;
      const info = await stat(absolute);
      if (info.isDirectory()) await visit(absolute, rel);
      else values.push(rel);
    }
  }
  await visit(root);
  return values;
}

/**
 * Bounded multi-change fixture: copy the repository OpenSpec tree and retain only
 * unfinished in-progress changes. Real change artifacts remain strictly valid.
 */
async function writeFixtureProject() {
  const root = await mkdtemp(join(tmpdir(), "horsepower-discovery-latency-"));
  roots.push(root);
  await cp(join(repositoryRoot, "openspec"), join(root, "openspec"), { recursive: true });
  await rm(join(root, "openspec", "changes", "archive"), { recursive: true, force: true });

  const listed = JSON.parse(command("openspec", ["list", "--json"], root));
  const unfinished = listed.changes.filter((item) =>
    item.status === "in-progress"
    && Number.isSafeInteger(item.completedTasks)
    && Number.isSafeInteger(item.totalTasks)
    && item.totalTasks > 0
    && item.completedTasks < item.totalTasks);
  assert.ok(
    unfinished.length >= MIN_FIXTURE_CANDIDATES,
    `fixture needs at least ${MIN_FIXTURE_CANDIDATES} unfinished changes; found ${unfinished.length}`,
  );

  const keep = new Set(unfinished.map((item) => item.name));
  const changesRoot = join(root, "openspec", "changes");
  for (const name of await readdir(changesRoot)) {
    if (!keep.has(name)) await rm(join(changesRoot, name), { recursive: true, force: true });
  }

  const pruned = JSON.parse(command("openspec", ["list", "--json"], root));
  const officialOrder = pruned.changes.map((item) => item.name);
  assert.ok(officialOrder.length >= MIN_FIXTURE_CANDIDATES, "pruned fixture lost unfinished candidates");
  assert.equal(officialOrder.length, keep.size, "pruned fixture must contain only retained unfinished changes");

  // Confirm eligibility offline without warming the delayed PATH used by Pi.
  for (const name of officialOrder) {
    const status = JSON.parse(command("openspec", ["status", "--change", name, "--json"], root));
    assert.equal(status.isComplete, true, `${name} must be apply-ready (planning complete)`);
    const validation = JSON.parse(command("openspec", ["validate", name, "--strict", "--json"], root));
    assert.equal(validation.summary?.totals?.failed, 0, `${name} must pass strict validation`);
  }

  await mkdir(join(root, ".pi"), { recursive: true });
  await cp(join(repositoryRoot, ".pi", "skills"), join(root, ".pi", "skills"), { recursive: true });
  await cp(join(repositoryRoot, ".pi", "prompts"), join(root, ".pi", "prompts"), { recursive: true });
  return { root, officialOrder };
}

/**
 * PATH-local openspec wrapper: sleep a fixed delay, log the invocation, then exec
 * the real official OpenSpec CLI with the same argv. Discovery still validates real
 * artifacts; only process-start cost is normalized for the latency gate.
 */
async function installDelayedOpenSpecShim(root, officialOpenSpec) {
  const binDir = join(root, "bin");
  const logPath = join(root, "openspec-invocations.log");
  const shimPath = join(binDir, "openspec");
  await mkdir(binDir, { recursive: true });
  await writeFile(logPath, "");
  const script = [
    "#!/usr/bin/env node",
    "import { spawnSync } from \"node:child_process\";",
    "import { appendFileSync } from \"node:fs\";",
    `const delayMs = ${OPENSPEC_INVOCATION_DELAY_MS};`,
    `const official = ${JSON.stringify(officialOpenSpec)};`,
    `const logPath = ${JSON.stringify(logPath)};`,
    "const args = process.argv.slice(2);",
    "const started = Date.now();",
    "while (Date.now() - started < delayMs) {",
    "  // Busy-wait keeps the cost deterministic across hosts without timer coalescing.",
    "}",
    "appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), args })}\\n`);",
    "const result = spawnSync(official, args, { stdio: \"inherit\", cwd: process.cwd(), env: process.env });",
    "if (result.error) {",
    "  console.error(result.error.message);",
    "  process.exit(127);",
    "}",
    "process.exit(result.status ?? 1);",
    "",
  ].join("\n");
  await writeFile(shimPath, script);
  await chmod(shimPath, 0o755);
  return { binDir, logPath, shimPath };
}

function sanitizedEnv(agentDir, home, binDir) {
  const env = {
    PATH: `${binDir}:${process.env.PATH}`,
    HOME: home,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    OPENSPEC_TELEMETRY: "0",
    LANG: "C.UTF-8",
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("NODE_") && value !== undefined) env[key] = value;
  }
  return env;
}

async function measurePickerLatency({ root, officialOrder, identity, binDir, logPath }) {
  const home = join(root, "home");
  const agentDir = join(home, ".pi", "agent");
  await mkdir(agentDir, { recursive: true });
  const beforeAgentTree = await tree(agentDir);

  const child = spawn(
    "pi",
    [
      "--mode", "rpc",
      "--no-session",
      "--offline",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-extensions",
      "--extension", extensionPath,
    ],
    { cwd: root, env: sanitizedEnv(agentDir, home, binDir), stdio: ["pipe", "pipe", "pipe"] },
  );

  const events = [];
  let stderr = "";
  let buffer = "";
  let settled = false;
  let pickerEvent;
  let promptSubmittedAt;
  let pickerAppearedAt;
  let changeSelectCount = 0;
  let inputCount = 0;
  let confirmCount = 0;
  let otherSelectCount = 0;

  const finish = new Promise((resolveFinish, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(
        `discovery latency harness timed out after ${HARNESS_TIMEOUT_MS}ms; `
        + `pickerMs=${pickerAppearedAt && promptSubmittedAt ? pickerAppearedAt - promptSubmittedAt : "n/a"}; `
        + `last events: ${JSON.stringify(events.slice(-8))}`,
      ));
    }, HARNESS_TIMEOUT_MS);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      settled = true;
      resolveFinish({ code, signal });
    });
  });

  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  function handle(event) {
    events.push(event);
    if (event.type !== "extension_ui_request") return;
    if (event.method === "input") {
      inputCount += 1;
      throw new Error(`unexpected free-form input before/during discovery: ${event.title}`);
    }
    if (event.method === "confirm") {
      confirmCount += 1;
      throw new Error(`unexpected confirm before picker cancel: ${event.title}`);
    }
    if (event.method === "select" && /OpenSpec change/u.test(event.title)) {
      changeSelectCount += 1;
      if (changeSelectCount === 1) {
        pickerAppearedAt = Date.now();
        pickerEvent = event;
      }
      assert.ok(event.options.length > 1, "multi-change fixture must present multiple candidates");
      assert.ok(event.options.length >= MIN_FIXTURE_CANDIDATES, `picker must include at least ${MIN_FIXTURE_CANDIDATES} candidates`);
      assert.ok(event.options.length <= 64, "change picker must stay bounded");
      const pickerIds = event.options.map((option) => option.split(" — ")[0]);
      assert.deepEqual(
        pickerIds,
        officialOrder.filter((id) => pickerIds.includes(id)),
        "picker must preserve official list order among presented candidates",
      );
      assert.equal(pickerIds.length, officialOrder.length, "all fixture unfinished changes must be eligible");
      assert.ok(
        event.options.every((option) => /\d+\/\d+ tasks complete$/u.test(option)),
        "picker progress must be bounded normalized context",
      );
      // Cancel immediately so no campaign/run/worker/handoff is created.
      child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, cancelled: true })}\n`);
      return;
    }
    if (event.method === "select") {
      otherSelectCount += 1;
      throw new Error(`unexpected select after cancel path: ${event.title}`);
    }
  }

  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        handle(JSON.parse(line));
      } catch (error) {
        child.kill("SIGKILL");
        throw error;
      }
    }
  });

  promptSubmittedAt = Date.now();
  child.stdin.write(`${JSON.stringify({ id: "discovery-latency", type: "prompt", message: "/horsepower-campaign" })}\n`);

  while (!settled) {
    const response = events.find((event) => event.type === "response" && event.id === "discovery-latency");
    if (response) {
      child.stdin.end();
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }

  const { code, signal } = await finish;
  const response = events.find((event) => event.type === "response" && event.id === "discovery-latency");
  const extensionError = events.find((event) => event.type === "extension_error" && event.extensionPath === "command:horsepower-campaign");
  const kickoffEvents = events.filter((event) =>
    event.type === "message_start"
    && event.message?.customType === "horsepower-campaign"
    && String(event.message?.content).includes("Begin the confirmed Horsepower campaign now."));
  const workerEvents = events.filter((event) =>
    String(event.type).startsWith("tool_execution_")
    || (event.type === "message_start"
      && event.message?.customType !== "horsepower-campaign"
      && String(event.message?.customType ?? "").startsWith("horsepower-")));
  const afterAgentTree = await tree(agentDir);
  const forbiddenSideEffects = afterAgentTree.filter((path) =>
    /(?:^|\/)(?:campaigns?|runs?|workers?|handoffs?|task-evidence)(?:\/|\.|$)/u.test(path));

  const invocationLog = (await readFile(logPath, "utf8")).trim();
  const invocations = invocationLog
    ? invocationLog.split("\n").map((line) => JSON.parse(line))
    : [];
  const invocationSummary = invocations.reduce((acc, entry) => {
    const key = entry.args.join(" ");
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  assert.equal(stderr, "", `stderr must be empty offline: ${stderr}`);
  assert.equal(code, 0, `pi exited ${code} signal=${signal}`);
  assert.equal(changeSelectCount, 1, `expected exactly one change picker: ${JSON.stringify(events)}`);
  assert.equal(inputCount, 0);
  assert.equal(confirmCount, 0);
  assert.equal(otherSelectCount, 0);
  assert.ok(pickerEvent, "first discovered-change picker was not observed");
  assert.ok(promptSubmittedAt !== undefined && pickerAppearedAt !== undefined);
  assert.equal(response?.success, true, JSON.stringify(response));
  assert.equal(extensionError, undefined, JSON.stringify(extensionError));
  assert.equal(kickoffEvents.length, 0, "cancel must not kick off a campaign");
  assert.equal(workerEvents.length, 0, JSON.stringify(workerEvents));
  assert.deepEqual(forbiddenSideEffects, [], "discovery cancel must not create campaign/run/worker/handoff/task-evidence files");
  assert.ok(invocations.length > 0, "OpenSpec shim must observe real CLI invocations");

  const pickerMs = pickerAppearedAt - promptSubmittedAt;
  const budgetEvidence = {
    pickerMs,
    budgetMs: PICKER_ACCEPTANCE_BUDGET_MS,
    openspecInvocationDelayMs: OPENSPEC_INVOCATION_DELAY_MS,
    openspecInvocationCount: invocations.length,
    invocationSummary,
    fixtureChangeCount: officialOrder.length,
    officialOrder,
    pickerOptions: pickerEvent.options,
    identity,
  };
  assert.ok(
    pickerMs <= PICKER_ACCEPTANCE_BUDGET_MS,
    `first discovered-change picker exceeded documented acceptance budget: `
    + `pickerMs=${pickerMs} budgetMs=${PICKER_ACCEPTANCE_BUDGET_MS}. `
    + `This catches the alpha.26 serial 30s+ regression. evidence=${JSON.stringify(budgetEvidence)}`,
  );

  return {
    pickerMs,
    budgetMs: PICKER_ACCEPTANCE_BUDGET_MS,
    openspecInvocationDelayMs: OPENSPEC_INVOCATION_DELAY_MS,
    openspecInvocationCount: invocations.length,
    invocationSummary,
    fixtureChangeCount: officialOrder.length,
    officialOrder,
    picker: {
      title: pickerEvent.title,
      options: pickerEvent.options,
    },
    dialogue: events
      .filter((event) => event.type === "extension_ui_request")
      .map(({ method, title, options }) => ({ method, title, options })),
    response,
    kickoffCount: kickoffEvents.length,
    workerSideEffectEventCount: workerEvents.length,
    agentTreeBefore: beforeAgentTree,
    agentTreeAfter: afterAgentTree,
    cwd: basename(root),
  };
}

try {
  const packageJson = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(installedRoot, "release-manifest.json"), "utf8"));
  const extension = await readFile(extensionPath);
  assert.equal(packageJson.version, expectedVersion, `installed version must be ${expectedVersion}`);
  assert.equal(manifest.version, expectedVersion, `manifest version must be ${expectedVersion}`);
  assert.equal(
    sha256(extension),
    manifest.digests["pi/extensions/horsepower/index.js"],
    "installed extension digest must match release-manifest",
  );

  const officialOpenSpec = await realpath(resolveOfficialOpenSpec());
  const identity = {
    installedCurrentLink: installedRoot,
    installedImmutableRoot: await realpath(installedRoot),
    installedVersion: packageJson.version,
    installedExtensionSha256: sha256(extension),
    manifestExtensionSha256: manifest.digests["pi/extensions/horsepower/index.js"],
    officialOpenSpec,
    piVersion: command("pi", ["--version"], repositoryRoot).trim(),
    openspecVersion: command("openspec", ["--version"], repositoryRoot).trim(),
  };

  const { root, officialOrder } = await writeFixtureProject();
  const { binDir, logPath } = await installDelayedOpenSpecShim(root, officialOpenSpec);
  // Sanity: delayed shim exists and is executable for the measurement child PATH.
  const shimInfo = await stat(join(binDir, "openspec"));
  assert.ok(shimInfo.isFile(), "openspec delay shim must be a file");
  assert.ok((shimInfo.mode & 0o111) !== 0, "openspec delay shim must be executable");

  const measurement = await measurePickerLatency({ root, officialOrder, identity, binDir, logPath });

  const evidence = {
    acceptance: "OpenSpec task 1.3 installed real-Pi discovery latency harness",
    documentedBudgetMs: PICKER_ACCEPTANCE_BUDGET_MS,
    costModel: {
      openspecInvocationDelayMs: OPENSPEC_INVOCATION_DELAY_MS,
      serialInvocationEstimate: 3 + MIN_FIXTURE_CANDIDATES * 4,
      serialLatencyEstimateMs: (3 + MIN_FIXTURE_CANDIDATES * 4) * OPENSPEC_INVOCATION_DELAY_MS,
      note: "Delay wrapper normalizes OpenSpec process cost so serial alpha.26 topology fails the budget while concurrent once-per-op discovery passes.",
    },
    networkAndCredentialPolicy:
      "PI_OFFLINE=1; --offline; isolated HOME/PI_CODING_AGENT_DIR; provider credential variables omitted; no model fixture or provider request",
    identity,
    measurement,
  };
  if (evidencePath) {
    await mkdir(resolve(evidencePath, ".."), { recursive: true });
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}
