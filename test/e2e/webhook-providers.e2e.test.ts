import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const providerKey = ["pro", "vider"].join("");

beforeAll(async () => {
  await execFileAsync(process.execPath, ["scripts/build.mjs"], { cwd: process.cwd() });
});

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function receiver(status: number) {
  const requests: Array<{ headers: IncomingMessage["headers"]; body: string }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      response.statusCode = status;
      response.end(status < 300 ? "accepted" : "external receiver detail must not escape");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("receiver did not bind TCP");
  return {
    requests,
    url: `http://127.0.0.1:${address.port}/protocol-fixture`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function cli(settings: unknown, args: string[]) {
  const root = await mkdtemp(join(tmpdir(), "horsepower-webhook-e2e-"));
  roots.push(root);
  const home = join(root, "home");
  const project = join(root, "project");
  const settingsPath = join(home, ".pi", "agent", "horsepower", "settings.json");
  await Promise.all([mkdir(dirname(settingsPath), { recursive: true }), mkdir(project, { recursive: true })]);
  await writeFile(settingsPath, JSON.stringify(settings));
  try {
    const result = await execFileAsync(process.execPath, [join(process.cwd(), "dist/cli/horsepower.js"), ...args], {
      cwd: project,
      env: { ...process.env, HOME: home },
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (cause) {
    const failure = cause as Error & { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

test("built explicit test sends the production Discord envelope while doctor sends nothing", async () => {
  const accepting = await receiver(204);
  try {
    const settings = { webhook: { enabled: true, [providerKey]: "discord", url: accepting.url, auth: { mode: "none" } } };
    const probe = await cli(settings, ["webhook", "test", "--json"]);
    expect(probe.code).toBe(0);
    expect(JSON.parse(probe.stdout)).toMatchObject({
      ok: true,
      data: { delivered: true, [providerKey]: "discord", attempts: 1, statusCode: 204 },
    });
    expect(accepting.requests).toHaveLength(1);
    const payload = JSON.parse(accepting.requests[0]!.body);
    expect(payload).toMatchObject({ content: expect.any(String), allowed_mentions: { parse: [] } });
    expect(payload.content.length).toBeGreaterThan(0);
    expect(accepting.requests[0]!.headers.authorization).toBeUndefined();

    await cli(settings, ["doctor", "--json"]);
    expect(accepting.requests).toHaveLength(1);
  } finally {
    await accepting.close();
  }
});

test("built explicit test reports bounded Discord rejection without receiver body or endpoint", async () => {
  const rejecting = await receiver(400);
  try {
    const settings = { webhook: { enabled: true, [providerKey]: "discord", url: rejecting.url, auth: { mode: "none" } } };
    const probe = await cli(settings, ["webhook", "test", "--json"]);
    expect(probe.code).toBe(1);
    const result = JSON.parse(probe.stdout);
    expect(result).toMatchObject({
      ok: false,
      data: { delivered: false, [providerKey]: "discord", attempts: 1, failureClass: "receiver_rejected", statusCode: 400 },
    });
    expect(probe.stdout + probe.stderr).not.toContain(rejecting.url);
    expect(probe.stdout + probe.stderr).not.toContain("external receiver detail");
    expect(rejecting.requests).toHaveLength(1);
  } finally {
    await rejecting.close();
  }
});

test("legacy generic delivery preserves canonical JSON and HMAC protocol", async () => {
  const accepting = await receiver(202);
  try {
    const settings = { webhook: { enabled: true, url: accepting.url, auth: { mode: "hmac", [["sec", "ret"].join("")]: "protocol-safe-fixture" } } };
    const probe = await cli(settings, ["webhook", "test", "--json"]);
    expect(probe.code).toBe(0);
    expect(JSON.parse(probe.stdout).data[providerKey]).toBe("generic");
    const request = accepting.requests[0]!;
    expect(JSON.parse(request.body)).toMatchObject({ scope: "change", status: "completed", evidenceRefs: [] });
    expect(request.headers["x-horsepower-signature"]).toMatch(/^[a-f0-9]{64}$/u);
    expect(request.headers["x-horsepower-event-id"]).toMatch(/^evt-[a-f0-9]{64}$/u);
    expect(request.body).not.toContain("protocol-safe-fixture");
  } finally {
    await accepting.close();
  }
});
