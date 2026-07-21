import { createHash, createHmac } from "node:crypto";
import { expect, test, vi } from "vitest";

const event = {
  eventId: "evt-1",
  timestamp: "2026-07-20T00:00:00.000Z",
  scope: "change" as const,
  runId: "run-1",
  changeId: "horsepower-alpha1",
  status: "completed" as const,
  summary: "E2E passed",
  evidenceRefs: ["npm run e2e: exit 0"],
};

test("signs a redacted canonical HMAC notification", async () => {
  const requests: Array<{ body: string; headers: Record<string, string> }> = [];
  const module = await import("../../src/lifecycle/webhook-notifier.js").catch(() => undefined);
  const notifier = module?.createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "hmac", secret: "top-secret" } },
    fetch: async (_url, init) => {
      requests.push({ body: String(init?.body), headers: init?.headers as Record<string, string> });
      return new Response(null, { status: 204 });
    },
  });

  await expect(notifier?.notify(event)).resolves.toMatchObject({ delivered: true, attempts: 1 });
  const request = requests[0]!;
  expect(JSON.parse(request.body)).toEqual({
    eventId: `evt-${createHash("sha256").update(event.eventId).digest("hex")}`,
    timestamp: event.timestamp,
    scope: "change",
    runId: `run-${createHash("sha256").update(event.runId).digest("hex")}`,
    changeId: `change-${createHash("sha256").update(event.changeId!).digest("hex")}`,
    status: "completed",
    summary: "change completed",
    evidenceRefs: [
      `evidence-${createHash("sha256").update(event.evidenceRefs[0]!).digest("hex")}`,
    ],
  });
  expect(request.body).not.toContain("top-secret");
  expect(request.body).not.toContain("E2E passed");
  expect(request.headers["x-horsepower-signature"]).toBe(
    createHmac("sha256", "top-secret").update(request.body).digest("hex"),
  );
  expect(request.headers["x-horsepower-event-id"]).toBe(
    `evt-${createHash("sha256").update(event.eventId).digest("hex")}`,
  );
});

test("supports Bearer authentication and bounded non-blocking retries", async () => {
  const delays: number[] = [];
  const headers: Record<string, string>[] = [];
  let attempts = 0;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "bearer", token: "token-value" } },
    retryDelaysMs: [0, 5, 30],
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetch: async (_url, init) => {
      attempts += 1;
      headers.push(init?.headers as Record<string, string>);
      return new Response(null, { status: attempts === 3 ? 200 : 503 });
    },
  });

  await expect(notifier.notify(event)).resolves.toEqual({ delivered: true, attempts: 3 });
  expect(delays).toEqual([5, 30]);
  expect(headers[0]?.authorization).toBe("Bearer token-value");
});

test("times out hanging attempts and ignores unbounded custom retry schedules", async () => {
  const sleeps: number[] = [];
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "none" } },
    retryDelaysMs: Array(100).fill(0),
    attemptTimeoutMs: 1,
    sleep: async (milliseconds) => { sleeps.push(milliseconds); },
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  await expect(notifier.notify(event)).resolves.toMatchObject({ delivered: false, attempts: 4 });
  expect(sleeps).toEqual([5_000, 30_000, 120_000]);
});

test("removes raw and JSON-escaped authentication values from delivered payloads", async () => {
  const bodies: string[] = [];
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "bearer", token: "token-value" } },
    fetch: async (_url, init) => { bodies.push(String(init?.body)); return new Response(null, { status: 204 }); },
  });

  await expect(notifier.notify({ ...event, summary: "receiver exposed token-value" }))
    .resolves.toMatchObject({ delivered: true });

  const hmac = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "hmac", secret: "line1\nline2" } },
    fetch: async (_url, init) => { bodies.push(String(init?.body)); return new Response(null, { status: 204 }); },
  });
  await expect(hmac.notify({ ...event, summary: "line1\nline2" }))
    .resolves.toMatchObject({ delivered: true });
  expect(bodies.join("\n")).not.toContain("token-value");
  expect(bodies.join("\n")).not.toContain("line1");
});

test("hashes credential-bearing summary, evidence, and identifiers at the notifier boundary", async () => {
  const bodies: string[] = [];
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "none" } },
    fetch: async (_url, init) => { bodies.push(String(init?.body)); return new Response(null, { status: 204 }); },
  });

  await expect(notifier.notify({ ...event, summary: "failure api_key=sk-live-secret" }))
    .resolves.toMatchObject({ delivered: true });
  await expect(notifier.notify({ ...event, evidenceRefs: ["Authorization: Bearer leaked"] }))
    .resolves.toMatchObject({ delivered: true });
  const githubToken = `${["ghp", ""].join("_")}1234567890abcdefghijklmnop`;
  await expect(notifier.notify({ ...event, changeId: githubToken }))
    .resolves.toMatchObject({ delivered: true });
  await expect(notifier.notify({ ...event, timestamp: "api_key=sk-live-leaked" }))
    .resolves.toMatchObject({ delivered: false, attempts: 0 });
  expect(bodies.join("\n")).not.toContain(githubToken);
  expect(bodies.join("\n")).not.toMatch(/sk-live-secret|Bearer leaked/u);
});

test("rejects unknown, malformed, and scope-incompatible event fields", async () => {
  let fetched = false;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "none" } },
    fetch: async () => { fetched = true; return new Response(null, { status: 204 }); },
  });

  await expect(notifier.notify(Object.assign({}, event, { prompt: "private", apiKey: "leaked" })))
    .resolves.toMatchObject({ delivered: false, attempts: 0 });
  await expect(notifier.notify({ ...event, scope: "dispatch", status: "blocked_needs_human" }))
    .resolves.toMatchObject({ delivered: false, attempts: 0 });
  await expect(notifier.notify({ ...event, summary: null } as unknown as typeof event))
    .resolves.toMatchObject({ delivered: false, attempts: 0 });
  expect(fetched).toBe(false);
});

test("allows structurally valid credential-themed change identifiers", async () => {
  let fetched = false;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "none" } },
    fetch: async () => { fetched = true; return new Response(null, { status: 204 }); },
  });

  await expect(notifier.notify({ ...event, changeId: "api-key-rotation" })).resolves.toMatchObject({
    delivered: true,
    attempts: 1,
  });
  expect(fetched).toBe(true);
});

test("rejects unbounded or credential-bearing event fields before delivery", async () => {
  let fetched = false;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "none" } },
    fetch: async () => { fetched = true; return new Response(null, { status: 204 }); },
  });

  await expect(notifier.notify({ ...event, changeId: `${["pass", "word"].join("")}=hunter2-${"x".repeat(10_000)}` }))
    .resolves.toEqual({ delivered: false, attempts: 0, error: "Invalid webhook event" });
  expect(fetched).toBe(false);
});

test("delivery exhaustion does not throw or mutate the terminal event", async () => {
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const original = structuredClone(event);
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "none" } },
    retryDelaysMs: [0, 1],
    sleep: async () => undefined,
    fetch: async () => { throw new Error("receiver unavailable with secret=do-not-log"); },
  });

  await expect(notifier.notify(event)).resolves.toEqual({
    delivered: false,
    attempts: 2,
    error: "Webhook delivery failed",
  });
  expect(event).toEqual(original);
});

test("shutdown abandons in-process retries without persisting recovery", async () => {
  let releaseSleep!: () => void;
  const sleeping = new Promise<void>((resolve) => { releaseSleep = resolve; });
  const fetch = vi.fn(async () => new Response("down", { status: 503 }));
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "none" } },
    fetch: fetch as typeof globalThis.fetch,
    retryDelaysMs: [0, 10],
    sleep: async () => sleeping,
  });
  const delivery = notifier.notify(event);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

  notifier.abandon();

  await expect(Promise.race([
    delivery,
    new Promise((_, reject) => setTimeout(() => reject(new Error("abandon timed out")), 20)),
  ])).resolves.toEqual({ delivered: false, attempts: 1, error: "Webhook delivery abandoned" });
  expect(fetch).toHaveBeenCalledTimes(1);
  releaseSleep();
});
