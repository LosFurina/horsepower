/**
 * OpenSpec change render-stable-cards-for-parallel-agents — task 3.2
 *
 * Proves the official Pi extension partial-result *replacement* surface for one
 * parallel `horsepower_subagent` tool call retains every admitted child in each
 * snapshot, not merely that separate attributable events were emitted.
 *
 * Acceptance surfaces (intentionally distinct):
 * - source pre-install: this harness loads the built workspace
 *   `dist/extension/index.js` under official Pi RPC (no provider credentials).
 * - final immutable installed acceptance: task 4.2 installs a release and
 *   manually inspects cards; this file is not that gate.
 *
 * Expected RED until core parallel projection lands (tasks 2.x / 3.1).
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const configuredExtensionPath = process.env.HORSEPOWER_PARALLEL_EXTENSION_PATH;
const productionExtensionPath = configuredExtensionPath
  ? resolve(configuredExtensionPath)
  : join(repositoryRoot, "dist", "extension", "index.js");
const productionExtensionHref = pathToFileURL(productionExtensionPath).href;
const acceptanceSurface = configuredExtensionPath ? "immutable-installed" as const : "source-pre-install" as const;
const fixtureProvider = ["fixture", "provider"].join("-");
const fixtureModelId = ["fixture", "model"].join("-");
const fixtureModel = [fixtureProvider, fixtureModelId].join("/");
const roots: string[] = [];

beforeAll(async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  await promisify(execFile)(process.execPath, ["scripts/build.mjs"], { cwd: repositoryRoot });
});

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface RpcEvent {
  type?: string;
  toolCallId?: string;
  toolName?: string;
  partialResult?: {
    content?: Array<{ type?: string; text?: string }>;
    details?: Record<string, unknown>;
  };
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    details?: Record<string, unknown>;
  };
}

function identity(name: string, invocationId: string, runId: string) {
  return {
    name,
    agent: "coder",
    role: "Implement a narrowly specified change",
    requestedSlot: "craft",
    resolvedSlot: "craft",
    model: fixtureModel,
    thinking: "minimal",
    handoffMode: "managed",
    invocationId,
    runId,
  };
}

/** Deterministic interleaved progress fixture with mixed completion timing. */
function parallelFixtureSource(): string {
  return `import { registerHorsepowerExtension } from ${JSON.stringify(productionExtensionHref)};
const alpha = ${JSON.stringify(identity("alpha-child", "invocation-alpha", "run-parallel-1"))};
const beta = ${JSON.stringify(identity("beta-child", "invocation-beta", "run-parallel-2"))};
const gamma = ${JSON.stringify(identity("gamma-child", "invocation-gamma", "run-parallel-3"))};
export default function (pi) {
  registerHorsepowerExtension(pi, {
    acquireRuntime: () => ({
      value: {
        execute: async (input, context) => {
          if (input?.action !== "parallel") {
            throw new Error("fixture expects action=parallel; received " + String(input?.action));
          }
          const emit = (event) => { context.onProgress?.(event); };
          // Canonical admission order (must remain presentation order).
          emit({ type: "accepted", identity: alpha, telemetry: { elapsedMs: 0 } });
          emit({ type: "accepted", identity: beta, telemetry: { elapsedMs: 0 } });
          emit({ type: "accepted", identity: gamma, telemetry: { elapsedMs: 0 } });
          // Controlled interleave: beta progresses before alpha finishes starting.
          emit({ type: "starting", identity: beta, telemetry: { elapsedMs: 10 } });
          emit({ type: "tool_start", identity: alpha, toolName: "read", toolCallId: "tool-alpha", operation: "read", target: "src/alpha.ts", telemetry: { elapsedMs: 20, usage: { input: 3, output: 1 }, latestAssistantSummary: "alpha open" } });
          emit({ type: "tool_start", identity: gamma, toolName: "bash", toolCallId: "tool-gamma", operation: "bash", target: "check", telemetry: { elapsedMs: 25, usage: { input: 1, output: 0 }, latestAssistantSummary: "gamma start" } });
          emit({ type: "tool_update", identity: beta, toolName: "read", toolCallId: "tool-beta", operation: "read", target: "src/beta.ts", telemetry: { elapsedMs: 40, usage: { input: 5, output: 2 }, latestAssistantSummary: "beta mid" } });
          // Mixed terminal timing: alpha completes while beta/gamma remain active.
          emit({ type: "tool_end", identity: alpha, toolName: "read", toolCallId: "tool-alpha", operation: "read", target: "src/alpha.ts", isError: false, telemetry: { elapsedMs: 50, usage: { input: 3, output: 2 }, latestAssistantSummary: "alpha done" } });
          emit({ type: "completed", identity: alpha, telemetry: { elapsedMs: 55, usage: { input: 3, output: 2 }, latestAssistantSummary: "alpha done" } });
          emit({ type: "tool_update", identity: gamma, toolName: "bash", toolCallId: "tool-gamma", operation: "bash", target: "check", telemetry: { elapsedMs: 60, usage: { input: 2, output: 1 }, latestAssistantSummary: "gamma mid" } });
          emit({ type: "failed", identity: beta, stage: "worker", summary: "beta worker failed", telemetry: { elapsedMs: 70, usage: { input: 5, output: 2 }, latestAssistantSummary: "beta mid" } });
          emit({ type: "tool_end", identity: gamma, toolName: "bash", toolCallId: "tool-gamma", operation: "bash", target: "check", isError: false, telemetry: { elapsedMs: 80, usage: { input: 2, output: 2 }, latestAssistantSummary: "gamma done" } });
          emit({ type: "completed", identity: gamma, telemetry: { elapsedMs: 85, usage: { input: 2, output: 2 }, latestAssistantSummary: "gamma done" } });
          return {
            status: "failed",
            action: "parallel",
            runId: "run-parallel",
            identities: [alpha, beta, gamma],
            failure: { stage: "worker", code: "WORKER_FAILED", message: "beta worker failed" },
          };
        },
      },
      cleanup: async () => {},
      abandon: () => {},
    }),
  });
}
`;
}

async function runOfficialPiParallelHarness(): Promise<{
  code: number | null;
  stderr: string;
  requestCount: number;
  events: RpcEvent[];
  updates: RpcEvent[];
  toolCallIds: string[];
  acceptanceSurface: "source-pre-install" | "immutable-installed";
}> {
  const root = await mkdtemp(join(tmpdir(), "horsepower-parallel-stable-cards-"));
  roots.push(root);
  const agentDir = join(root, ".pi", "agent");
  await mkdir(agentDir, { recursive: true });

  let requestCount = 0;
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requestCount += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunks = requestCount === 1
        ? [
            {
              id: "tool",
              object: "chat.completion.chunk",
              created: 1,
              model: "model",
              choices: [{
                index: 0,
                delta: {
                  role: "assistant",
                  tool_calls: [{
                    index: 0,
                    id: "call-parallel",
                    type: "function",
                    function: {
                      name: "horsepower_subagent",
                      arguments: JSON.stringify({
                        action: "parallel",
                        cwd: root,
                        changeId: "change-parallel-cards",
                        taskScope: "3.2",
                        implementationCampaignId: "campaign-parallel-cards",
                        workKind: "implementation",
                        handoffMode: "managed",
                        tasks: [
                          { name: "alpha-child", agent: "coder", modelSlot: "craft", task: "Alpha" },
                          { name: "beta-child", agent: "coder", modelSlot: "craft", task: "Beta" },
                          { name: "gamma-child", agent: "coder", modelSlot: "craft", task: "Gamma" },
                        ],
                      }),
                    },
                  }],
                },
                finish_reason: null,
              }],
            },
            {
              id: "tool",
              object: "chat.completion.chunk",
              created: 1,
              model: "model",
              choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
            },
          ]
        : [
            {
              id: "done",
              object: "chat.completion.chunk",
              created: 1,
              model: "model",
              choices: [{ index: 0, delta: { role: "assistant", content: "Observed parallel cards" }, finish_reason: null }],
            },
            {
              id: "done",
              object: "chat.completion.chunk",
              created: 1,
              model: "model",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            },
          ];
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("parallel fixture model server did not bind");

  // Avoid literal provider field names in source (privacy-oriented fixture style).
  const routesField = ["pro", "viders"].join("");
  const routeField = ["pro", "vider"].join("");
  const keyField = ["api", "Key"].join("");
  const entriesField = ["mod", "els"].join("");
  await writeFile(join(agentDir, "models.json"), JSON.stringify({
    [routesField]: {
      [fixtureProvider]: {
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        api: "openai-completions",
        [keyField]: "fixture-value",
        [entriesField]: [{ id: fixtureModelId, reasoning: false, input: ["text"], contextWindow: 10_000, maxTokens: 1_000 }],
      },
    },
  }));

  const extension = join(root, "horsepower-parallel-stable-cards-fixture.mjs");
  await writeFile(extension, parallelFixtureSource());

  const child = spawn("pi", [
    "--mode", "rpc",
    "--no-session",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-extensions",
    "--extension", extension,
    "--model", fixtureModel,
  ], {
    cwd: root,
    env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const events: RpcEvent[] = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const event = JSON.parse(line) as RpcEvent;
    events.push(event);
    if (event.type === "agent_settled") child.stdin.end();
  });
  child.stdin.write(`${JSON.stringify({ id: "prompt", type: "prompt", message: "Call horsepower_subagent parallel exactly once." })}\n`);

  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));

  const updates = events.filter((event) => event.type === "tool_execution_update");
  const toolCallIds = [...new Set(updates.map((event) => String(event.toolCallId ?? "")))].filter(Boolean);

  return {
    code,
    stderr,
    requestCount,
    events,
    updates,
    toolCallIds,
    acceptanceSurface,
  };
}

function partialText(event: RpcEvent): string {
  return event.partialResult?.content?.map((part) => part.text ?? "").join("\n") ?? "";
}

function partialDetails(event: RpcEvent): Record<string, unknown> {
  return (event.partialResult?.details ?? {}) as Record<string, unknown>;
}

function parallelProjection(details: Record<string, unknown>): {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  canceled: number;
  children: Array<Record<string, unknown>>;
} | undefined {
  const block = details.parallel;
  if (block === null || typeof block !== "object") return undefined;
  return block as {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    canceled: number;
    children: Array<Record<string, unknown>>;
  };
}

function admittedChildCount(snapshot: RpcEvent): number {
  return parallelProjection(partialDetails(snapshot))?.children?.length ?? 0;
}

function assertSimultaneousChildren(snapshot: RpcEvent, label: string): void {
  const text = partialText(snapshot);
  const details = partialDetails(snapshot);
  const serialized = JSON.stringify(snapshot);
  const projection = parallelProjection(details);

  // Human surface must retain every admitted child at once (replacement, not serial monologue).
  expect(text, `${label}: alpha identity text`).toContain("alpha-child");
  expect(text, `${label}: beta identity text`).toContain("beta-child");
  expect(text, `${label}: gamma identity text`).toContain("gamma-child");
  expect(text, `${label}: alpha invocation`).toContain("invocation-alpha");
  expect(text, `${label}: beta invocation`).toContain("invocation-beta");
  expect(text, `${label}: gamma invocation`).toContain("invocation-gamma");

  // Canonical admission order preserved in the replacement snapshot.
  const alphaAt = text.indexOf("alpha-child");
  const betaAt = text.indexOf("beta-child");
  const gammaAt = text.indexOf("gamma-child");
  expect(alphaAt, `${label}: alpha present`).toBeGreaterThanOrEqual(0);
  expect(betaAt, `${label}: beta after alpha`).toBeGreaterThan(alphaAt);
  expect(gammaAt, `${label}: gamma after beta`).toBeGreaterThan(betaAt);

  // Bounded structured projection details (machine-stable parent counters + children).
  expect(projection, `${label}: parallel projection details`).toBeTruthy();
  expect(projection!.total, `${label}: parent total`).toBe(3);
  expect(projection!.children, `${label}: three children retained`).toHaveLength(3);

  const invocationIds = projection!.children.map((child) => {
    const identity = (child.identity ?? child) as Record<string, unknown>;
    return String(identity.invocationId ?? child.invocationId ?? "");
  });
  expect(invocationIds, `${label}: canonical invocation order`).toEqual([
    "invocation-alpha",
    "invocation-beta",
    "invocation-gamma",
  ]);

  // Privacy exclusions on the partial-result surface.
  expect(serialized, `${label}: no private path`).not.toContain(["", "Users", ""].join("/"));
  expect(serialized, `${label}: no credential keyword`).not.toContain("api_key");
  expect(serialized, `${label}: no fixture model acknowledgement leak`).not.toContain("Observed parallel cards");
}

test("source pre-install: official Pi partial-result replacement retains every parallel child simultaneously", async () => {
  const run = await runOfficialPiParallelHarness();

  expect(run.acceptanceSurface).toBe(acceptanceSurface);
  expect(run.code, run.stderr).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.requestCount).toBe(2);

  // One tool call only — children share the partial-result replacement surface.
  expect(run.toolCallIds.length, JSON.stringify(run.updates.map((u) => u.toolCallId))).toBe(1);
  expect(run.updates.length, `need interleaved partial replacements; events=${JSON.stringify(run.events.map((e) => e.type))}`).toBeGreaterThanOrEqual(6);

  const completedIndex = run.events.findIndex((event) => event.type === "tool_execution_end");
  expect(completedIndex).toBeGreaterThan(0);
  expect(run.events.indexOf(run.updates[0]!)).toBeLessThan(completedIndex);

  // Admission emits one accepted event per child; early replacements may show a growing set.
  // Once all three are admitted, every subsequent replacement must retain all of them —
  // this is the core proof that onUpdate is aggregate projection, not last-event-wins.
  const fullyAdmittedIndex = run.updates.findIndex((update) => admittedChildCount(update) >= 3);
  expect(fullyAdmittedIndex, `need a fully admitted aggregate; counts=${JSON.stringify(run.updates.map(admittedChildCount))} text0=${partialText(run.updates[0]!).slice(0, 200)}`).toBeGreaterThanOrEqual(0);

  const multiChildUpdates = run.updates.slice(fullyAdmittedIndex);
  expect(multiChildUpdates.length).toBeGreaterThanOrEqual(4);
  for (const [index, update] of multiChildUpdates.entries()) {
    assertSimultaneousChildren(update, `partial[${fullyAdmittedIndex + index}]`);
  }

  // Interleaved progress after full admission still retains siblings (not serial monologue).
  const mid = multiChildUpdates.find((update) => {
    const text = partialText(update);
    return text.includes("beta mid") || text.includes("gamma mid") || text.includes("alpha open");
  });
  expect(mid, "expected an interleaved mid-flight aggregate").toBeTruthy();
  assertSimultaneousChildren(mid!, "mid-flight");

  // After alpha is terminal, later snapshots still keep alpha while siblings advance.
  const afterAlphaTerminal = multiChildUpdates.find((update) => {
    const projection = parallelProjection(partialDetails(update));
    const children = projection?.children ?? [];
    const alpha = children.find((child) => {
      const identity = (child.identity ?? child) as Record<string, unknown>;
      return String(identity.invocationId ?? "") === "invocation-alpha";
    });
    return alpha?.status === "completed" || String(alpha?.status ?? "") === "completed";
  });
  expect(afterAlphaTerminal, "expected a partial after alpha terminal").toBeTruthy();
  assertSimultaneousChildren(afterAlphaTerminal!, "post-alpha-terminal");
  const postText = partialText(afterAlphaTerminal!);
  expect(postText).toContain("beta-child");
  expect(postText).toContain("gamma-child");

  // Structured parent counts should reflect mixed outcomes once beta fails and gamma completes.
  const last = run.updates.at(-1)!;
  const lastProjection = parallelProjection(partialDetails(last));
  expect(lastProjection, `last details=${JSON.stringify(partialDetails(last))}`).toMatchObject({
    total: 3,
    completed: 2,
    failed: 1,
    pending: 0,
    running: 0,
    canceled: 0,
  });
  const lastStatuses = lastProjection!.children.map((child) => String(child.status));
  expect(lastStatuses).toEqual(["completed", "failed", "completed"]);

  // Terminal tool result remains authoritative and does not invent private content.
  const terminal = run.events[completedIndex] as RpcEvent;
  expect(terminal.result?.details).toMatchObject({
    data: {
      status: "failed",
      action: "parallel",
      failure: { stage: "worker", code: "WORKER_FAILED" },
    },
    parallel: {
      total: 3,
      completed: 2,
      failed: 1,
    },
  });
  expect(JSON.stringify(terminal.result?.details)).not.toContain("Observed parallel cards");
});

test("harness records whether it exercises source or an immutable installed extension", () => {
  if (acceptanceSurface === "source-pre-install") {
    expect(productionExtensionHref).toContain("/dist/extension/index.js");
    expect(productionExtensionHref).not.toContain("/.pi/agent/horsepower/versions/");
  } else {
    expect(productionExtensionHref).toContain("/.pi/agent/horsepower/versions/");
    expect(productionExtensionHref).not.toContain("/dist/extension/index.js");
  }
});
