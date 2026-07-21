import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const roots: string[] = [];

beforeAll(async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot });
});

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function runPiRpc(args: string[], line: string, agentDir: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const child = spawn("pi", args, { cwd: repositoryRoot, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.stdin.end(`${line}\n`);
  const code = await new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("close", resolveExit); });
  return { stdout, stderr, code };
}

test("official Pi restart observes disabled and re-enabled extension links", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "horsepower-real-pi-restart-")); roots.push(agentDir);
  const extensions = join(agentDir, "extensions"); await mkdir(extensions, { recursive: true });
  const link = join(extensions, "horsepower.js"); await symlink(join(repositoryRoot, "dist", "extension", "index.js"), link);
  const args = ["--mode", "rpc", "--no-session", "--offline", "--no-skills", "--no-prompt-templates", "--no-context-files"];
  const command = '{"id":"commands","type":"get_commands"}';
  const enabled = await runPiRpc(args, command, agentDir);
  expect(enabled.stdout).toContain("horsepower-workers");
  await rm(link);
  const disabled = await runPiRpc(args, command, agentDir);
  expect(disabled.stdout).not.toContain("horsepower-workers");
  await symlink(join(repositoryRoot, "dist", "extension", "index.js"), link);
  const restored = await runPiRpc(args, command, agentDir);
  expect(restored.stdout).toContain("horsepower-workers");
});

test("official Pi RPC loads the bundled extension and exposes only Horsepower commands", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "horsepower-real-pi-"));
  roots.push(agentDir);
  const extension = join(repositoryRoot, "dist", "extension", "index.js");
  const { stdout, stderr, code } = await runPiRpc([
    "--mode", "rpc", "--no-session", "--offline",
    "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--extension", extension,
  ], '{"id":"commands","type":"get_commands"}', agentDir);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  const response = JSON.parse(stdout.trim()) as { success: boolean; data: { commands: Array<{ name: string }> } };
  expect(response.success).toBe(true);
  expect(response.data.commands.map(({ name }) => name)).toEqual([
    "horsepower-workers", "horsepower-doctor", "horsepower-campaign", "horsepower-review-authorize",
  ]);
});
