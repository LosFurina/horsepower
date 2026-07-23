#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const installedRoot = resolve(process.env.HOME, ".pi/agent/horsepower/current");
const extensionPath = join(installedRoot, "pi/extensions/horsepower/index.js");
const expectedVersion = "0.1.0-alpha.26";
const evidencePath = process.argv[2] ? resolve(process.argv[2]) : undefined;
const roots = [];

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function command(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, PI_OFFLINE: "1" } });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}
async function tree(root) {
  const values = [];
  async function visit(path, relative = "") {
    for (const name of (await readdir(path)).sort()) {
      const absolute = join(path, name); const rel = join(relative, name); const info = await stat(absolute);
      if (info.isDirectory()) await visit(absolute, rel); else values.push(rel);
    }
  }
  await visit(root); return values;
}
async function fixtureProject(label, soleCandidate) {
  const root = await mkdtemp(join(tmpdir(), `horsepower-installed-campaign-${label}-`)); roots.push(root);
  await cp(join(repositoryRoot, "openspec"), join(root, "openspec"), { recursive: true });
  if (soleCandidate) {
    const changesRoot = join(root, "openspec", "changes");
    for (const name of await readdir(changesRoot)) {
      if (name !== "archive" && name !== soleCandidate) await rm(join(changesRoot, name), { recursive: true, force: true });
    }
  }
  await mkdir(join(root, ".pi"), { recursive: true });
  await cp(join(repositoryRoot, ".pi", "skills"), join(root, ".pi", "skills"), { recursive: true });
  await cp(join(repositoryRoot, ".pi", "prompts"), join(root, ".pi", "prompts"), { recursive: true });
  return root;
}
function sanitizedEnv(agentDir, home) {
  const env = { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", OPENSPEC_TELEMETRY: "0", LANG: "C.UTF-8" };
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("NODE_") && value !== undefined) env[key] = value;
  }
  return env;
}
async function runScenario({ label, drift, soleCandidate }) {
  const cwd = await fixtureProject(label, soleCandidate);
  const home = join(cwd, "home"); const agentDir = join(home, ".pi", "agent"); await mkdir(agentDir, { recursive: true });
  const beforeAgentTree = await tree(agentDir);
  const official = JSON.parse(command("openspec", ["list", "--json"], cwd));
  const officialOrder = official.changes.map((item) => item.name);
  const child = spawn("pi", ["--mode", "rpc", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-extensions", "--extension", extensionPath], {
    cwd, env: sanitizedEnv(agentDir, home), stdio: ["pipe", "pipe", "pipe"],
  });
  const events = []; let stderr = ""; let buffer = ""; let settled = false; let selectedChange; let selectedTaskFile;
  let changeSelectCount = 0, taskScopeSelectCount = 0, confirmCount = 0, modeSelectCount = 0, inputCount = 0;
  const finish = new Promise((resolveFinish, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${label} timed out; last events: ${JSON.stringify(events.slice(-5))}`)); }, 30_000);
    child.once("error", reject);
    child.once("close", (code) => { clearTimeout(timeout); settled = true; resolveFinish(code); });
  });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  async function handle(event) {
    events.push(event);
    if (event.type !== "extension_ui_request") return;
    if (event.method === "input") { inputCount += 1; throw new Error(`unexpected free-form input: ${event.title}`); }
    if (event.method === "select" && /OpenSpec change/u.test(event.title)) {
      changeSelectCount += 1;
      assert.ok(event.options.length >= 1 && event.options.length <= 64, "change picker must be nonempty and bounded");
      if (soleCandidate) assert.equal(event.options.length, 1, "a sole candidate must still be presented explicitly");
      else assert.ok(event.options.length > 1, "multiple current-project candidates must be presented");
      const pickerIds = event.options.map((option) => option.split(" — ")[0]);
      assert.deepEqual(pickerIds, officialOrder.filter((id) => pickerIds.includes(id)), "picker must preserve official list order");
      assert.ok(event.options.every((option) => /\d+\/\d+ tasks complete$/u.test(option)), "picker progress must be bounded normalized context");
      selectedChange = pickerIds[0]; selectedTaskFile = join(cwd, "openspec", "changes", selectedChange, "tasks.md");
      child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, value: event.options[0] })}\n`); return;
    }
    if (event.method === "select" && event.title === "Select task scope") {
      taskScopeSelectCount += 1; assert.deepEqual(event.options, ["All unfinished tasks", "Select by section", "Enter exact task IDs"]);
      child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, value: event.options[0] })}\n`); return;
    }
    if (event.method === "confirm") {
      confirmCount += 1; assert.equal(event.title, "Confirm this normalized task scope?");
      if (drift) {
        const tasks = await readFile(selectedTaskFile, "utf8");
        assert.match(tasks, /- \[ \]/u);
        await writeFile(selectedTaskFile, tasks.replace(/- \[ \]/u, "- [x]"));
      }
      child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, confirmed: true })}\n`); return;
    }
    if (event.method === "select" && event.title === "Choose implementation mode") {
      modeSelectCount += 1; assert.deepEqual(event.options, ["Multi-Agent team", "Main Agent direct execution"]);
      child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: event.id, value: event.options[0] })}\n`); return;
    }
  }
  child.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    for (;;) {
      const newline = buffer.indexOf("\n"); if (newline < 0) break;
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (line) void handle(JSON.parse(line)).catch((error) => { child.kill("SIGKILL"); throw error; });
    }
  });
  child.stdin.write(`${JSON.stringify({ id: `campaign-${label}`, type: "prompt", message: "/horsepower-campaign" })}\n`);
  // A command response is emitted only after its async picker flow completes.
  while (!settled) {
    const response = events.find((event) => event.type === "response" && event.id === `campaign-${label}`);
    if (response) { child.stdin.end(); break; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  const code = await finish;
  const response = events.find((event) => event.type === "response" && event.id === `campaign-${label}`);
  const extensionError = events.find((event) => event.type === "extension_error" && event.extensionPath === "command:horsepower-campaign");
  const kickoffEvents = events.filter((event) => event.type === "message_start" && event.message?.customType === "horsepower-campaign" && String(event.message?.content).includes("Begin the confirmed Horsepower campaign now."));
  const workerEvents = events.filter((event) => String(event.type).startsWith("tool_execution_") || (event.type === "message_start" && event.message?.customType !== "horsepower-campaign" && String(event.message?.customType ?? "").startsWith("horsepower-")));
  const afterAgentTree = await tree(agentDir);
  const countEvidence = JSON.stringify({ changeSelectCount, taskScopeSelectCount, confirmCount, modeSelectCount, inputCount, events });
  assert.equal(changeSelectCount, 1, countEvidence); assert.equal(taskScopeSelectCount, 1, countEvidence); assert.equal(confirmCount, 1, countEvidence); assert.equal(modeSelectCount, 1, countEvidence); assert.equal(inputCount, 0, countEvidence);
  assert.equal(code, 0); assert.equal(stderr, "");
  if (!drift) {
    assert.equal(response?.success, true, JSON.stringify(response));
    assert.equal(kickoffEvents.length, 1, `expected one kickoff event: ${JSON.stringify(kickoffEvents)}`);
  } else {
    // Pi accepts the slash prompt, then reports async extension-command failures as extension_error.
    assert.equal(response?.success, true, JSON.stringify(response));
    assert.match(extensionError?.error ?? "", /inventory changed before campaign confirmation/u, JSON.stringify(events));
    assert.equal(kickoffEvents.length, 0); assert.equal(workerEvents.length, 0, JSON.stringify(workerEvents));
    const forbiddenSideEffects = afterAgentTree.filter((path) => /(?:^|\/)(?:campaigns?|runs?|workers?|handoffs?|task-evidence)(?:\/|\.|$)/u.test(path));
    assert.deepEqual(forbiddenSideEffects, [], "drift must not create campaign/run/worker/handoff/task-evidence files");
  }
  return { label, cwd: basename(cwd), officialOrder, selectedChange, picker: events.find((event) => event.method === "select" && /OpenSpec change/u.test(event.title)),
    dialogue: events.filter((event) => event.type === "extension_ui_request").map(({ method, title, options, message }) => ({ method, title, options, message })),
    response, extensionError, kickoffCount: kickoffEvents.length, workerSideEffectEventCount: workerEvents.length, agentTreeBefore: beforeAgentTree, agentTreeAfter: afterAgentTree };
}

try {
  const packageJson = JSON.parse(await readFile(join(installedRoot, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(installedRoot, "release-manifest.json"), "utf8"));
  const extension = await readFile(extensionPath);
  assert.equal(packageJson.version, expectedVersion); assert.equal(manifest.version, expectedVersion);
  assert.equal(sha256(extension), manifest.digests["pi/extensions/horsepower/index.js"]);
  const sourceExtension = await readFile(join(repositoryRoot, "dist/extension/index.js"));
  const identity = { installedCurrentLink: installedRoot, installedImmutableRoot: await realpath(installedRoot), installedVersion: packageJson.version, installedExtensionSha256: sha256(extension), manifestExtensionSha256: manifest.digests["pi/extensions/horsepower/index.js"], sourceDistSha256: sha256(sourceExtension), piVersion: command("pi", ["--version"], repositoryRoot).trim(), openspecVersion: command("openspec", ["--version"], repositoryRoot).trim() };
  const success = await runScenario({ label: "success", drift: false });
  const soleExplicit = await runScenario({ label: "sole-explicit", drift: false, soleCandidate: "continue-campaigns-after-auto-compaction" });
  const drift = await runScenario({ label: "drift", drift: true });
  const evidence = { acceptance: "OpenSpec task 4.4 installed real-Pi acceptance", identity, networkAndCredentialPolicy: "PI_OFFLINE=1; isolated HOME/PI_CODING_AGENT_DIR; provider credential variables omitted; no model fixture or provider request", success, soleExplicit, drift };
  if (evidencePath) { await mkdir(resolve(evidencePath, ".."), { recursive: true }); await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`); }
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}
