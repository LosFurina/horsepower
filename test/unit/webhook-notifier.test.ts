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

const genericConfig = { url: "https://example.test", auth: { mode: "none" } as const, provider: "generic" as const };
const genericHmacConfig = { url: "https://example.test/hook", auth: { mode: "hmac" as const, secret: "top-secret" }, provider: "generic" as const };
const genericBearerConfig = { url: "https://example.test/hook", auth: { mode: "bearer" as const, token: "token-value" }, provider: "generic" as const };
const discordConfig = { url: "https://discord.test/webhook", auth: { mode: "none" as const }, provider: "discord" as const };

// ── Generic provider (regression) ───────────────────────────────────────

test("Chinese webhook localizes only the human summary and preserves machine fields", async () => {
  let body: Record<string, unknown> | undefined;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({ config: genericConfig, fetch: async (_url, init) => { body = JSON.parse(String(init?.body)); return new Response(null, { status: 204 }); } });
  const { changeId: _changeId, ...dispatchEvent } = event;
  await notifier.notify({ ...dispatchEvent, scope: "dispatch", outputLocale: "zh-CN", summary: "任务已完成。" });
  expect(body).toMatchObject({ scope: "dispatch", status: "completed", outputLocale: "zh-CN", summary: "dispatch 已完成。" });
  expect(body?.runId).toMatch(/^run-/u);
});

test("signs a redacted canonical HMAC notification", async () => {
  const requests: Array<{ body: string; headers: Record<string, string> }> = [];
  const module = await import("../../src/lifecycle/webhook-notifier.js").catch(() => undefined);
  const notifier = module?.createWebhookNotifier({
    config: genericHmacConfig,
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
    outputLocale: "en",
    summary: "change completed.",
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
    config: genericBearerConfig,
    retryDelaysMs: [0, 5, 30],
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetch: async (_url, init) => {
      attempts += 1;
      headers.push(init?.headers as Record<string, string>);
      return new Response(null, { status: attempts === 3 ? 200 : 503 });
    },
  });

  await expect(notifier.notify(event)).resolves.toMatchObject({ delivered: true, attempts: 3 });
  expect(delays).toEqual([5, 30]);
  expect(headers[0]?.authorization).toBe("Bearer token-value");
});

test("times out hanging attempts and ignores unbounded custom retry schedules", async () => {
  const sleeps: number[] = [];
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: genericConfig,
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
    config: genericBearerConfig,
    fetch: async (_url, init) => { bodies.push(String(init?.body)); return new Response(null, { status: 204 }); },
  });

  await expect(notifier.notify({ ...event, summary: "receiver exposed token-value" }))
    .resolves.toMatchObject({ delivered: true });

  const hmac = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "hmac", secret: "line1\nline2" }, provider: "generic" },
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
    config: genericConfig,
    fetch: async (_url, init) => { bodies.push(String(init?.body)); return new Response(null, { status: 204 }); },
  });

  const syntheticApiKey = `api_key=${["s", "k"].join("-")}-live-secret`;
  await expect(notifier.notify({ ...event, summary: `failure ${syntheticApiKey}` }))
    .resolves.toMatchObject({ delivered: true });
  await expect(notifier.notify({ ...event, evidenceRefs: ["Authorization: Bearer leaked"] }))
    .resolves.toMatchObject({ delivered: true });
  const githubToken = `${["ghp", ""].join("_")}1234567890abcdefghijklmnop`;
  await expect(notifier.notify({ ...event, changeId: githubToken }))
    .resolves.toMatchObject({ delivered: true });
  await expect(notifier.notify({ ...event, timestamp: syntheticApiKey.replace("secret", "leaked") }))
    .resolves.toMatchObject({ delivered: false, attempts: 0 });
  expect(bodies.join("\n")).not.toContain(githubToken);
  expect(bodies.join("\n")).not.toContain(syntheticApiKey);
  expect(bodies.join("\n")).not.toMatch(/Bearer leaked/u);
});

test("rejects unknown, malformed, and scope-incompatible event fields", async () => {
  let fetched = false;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: genericConfig,
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
    config: genericConfig,
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
    config: genericConfig,
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
    config: genericConfig,
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
    config: genericConfig,
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

// ── Discord provider transport (Task 3.1) ───────────────────────────────

test("3.1: Discord provider sends content/body with allowed_mentions", async () => {
  let sentBody: string | undefined;
  let sentHeaders: Record<string, string> | undefined;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: discordConfig,
    fetch: async (_url, init) => {
      sentBody = String(init?.body);
      sentHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 204 });
    },
  });

  await expect(notifier.notify(event)).resolves.toMatchObject({ delivered: true, attempts: 1 });
  expect(sentBody).toBeTruthy();
  expect(sentHeaders).toBeTruthy();
  const parsed = JSON.parse(sentBody!);
  expect(parsed).toHaveProperty("content");
  expect(parsed).toHaveProperty("allowed_mentions");
  expect(parsed.allowed_mentions).toEqual({ parse: [] });
  expect(typeof parsed.content).toBe("string");
  expect(parsed.content.length).toBeGreaterThan(0);
});

test("3.1: Discord body does not contain Horsepower event headers", async () => {
  let sentBody: string | undefined;
  let sentHeaders: Record<string, string> | undefined;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: discordConfig,
    fetch: async (_url, init) => {
      sentBody = String(init?.body);
      sentHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 204 });
    },
  });

  await expect(notifier.notify(event)).resolves.toMatchObject({ delivered: true, attempts: 1 });
  // Discord body is NOT canonical JSON — it's a Discord-native envelope
  const parsed = JSON.parse(sentBody!);
  expect(parsed).not.toHaveProperty("eventId");
  expect(parsed).not.toHaveProperty("scope");
  expect(parsed).not.toHaveProperty("runId");
  expect(parsed).not.toHaveProperty("status");
  expect(parsed).not.toHaveProperty("summary");
  expect(parsed).not.toHaveProperty("evidenceRefs");
  // No Horsepower-specific headers
  expect(sentHeaders!["x-horsepower-event-id"]).toBeUndefined();
  expect(sentHeaders!["x-horsepower-signature"]).toBeUndefined();
  expect(sentHeaders!["x-horsepower-timestamp"]).toBeUndefined();
  expect(sentHeaders!.authorization).toBeUndefined();
});

test("3.1: Discord transport preserves bounded retries", async () => {
  const fetches: number[] = [];
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: discordConfig,
    retryDelaysMs: [0, 5, 30],
    sleep: async () => undefined,
    fetch: async () => {
      fetches.push(fetches.length);
      return new Response(null, { status: fetches.length < 3 ? 503 : 204 });
    },
  });

  await expect(notifier.notify(event)).resolves.toMatchObject({ delivered: true, attempts: 3 });
});

test("3.1: Discord transport propagates abandonment", async () => {
  let releaseSleep!: () => void;
  const sleeping = new Promise<void>((resolve) => { releaseSleep = resolve; });
  const fetch = vi.fn(async () => new Response("down", { status: 503 }));
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: discordConfig,
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

test("3.1: Discord transport respects attempt timeout", async () => {
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: discordConfig,
    attemptTimeoutMs: 1,
    retryDelaysMs: [0],
    sleep: async () => undefined,
    fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }),
  });

  await expect(notifier.notify(event)).resolves.toMatchObject({ delivered: false, attempts: 1 });
});

test("3.1: Discord delivery failure does not change terminal truth (returns bounded error)", async () => {
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: discordConfig,
    retryDelaysMs: [0, 1],
    sleep: async () => undefined,
    fetch: async () => { throw new Error("receiver unavailable"); },
  });

  const result = await notifier.notify(event);
  expect(result.delivered).toBe(false);
  expect(result.attempts).toBe(2);
  expect(result.error).toBe("Webhook delivery failed");
  // Ensure error doesn't expose secrets or raw body
  expect(result.error).not.toContain("receiver");
});

test("3.1: Discord content is bounded (within Discord byte limit)", async () => {
  let sentBody: string | undefined;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: discordConfig,
    fetch: async (_url, init) => {
      sentBody = String(init?.body);
      return new Response(null, { status: 204 });
    },
  });

  await expect(notifier.notify(event)).resolves.toMatchObject({ delivered: true, attempts: 1 });
  const parsed = JSON.parse(sentBody!);
  // Discord limit is 2000 bytes; we use 2000 as DISCORD_CONTENT_MAX_BYTES
  expect(Buffer.byteLength(parsed.content, "utf8")).toBeLessThanOrEqual(2000);
});

test("3.1: generic provider still produces canonical JSON with event headers", async () => {
  let sentBody: string | undefined;
  let sentHeaders: Record<string, string> | undefined;
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: genericConfig,
    fetch: async (_url, init) => {
      sentBody = String(init?.body);
      sentHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 204 });
    },
  });

  await expect(notifier.notify(event)).resolves.toMatchObject({ delivered: true, attempts: 1 });
  const parsed = JSON.parse(sentBody!);
  expect(parsed).toHaveProperty("eventId");
  expect(parsed).toHaveProperty("scope");
  expect(parsed).toHaveProperty("status");
  expect(parsed).toHaveProperty("summary");
  expect(parsed).toHaveProperty("evidenceRefs");
  expect(sentHeaders!["x-horsepower-event-id"]).toBeTruthy();
  expect(sentHeaders!["content-type"]).toBe("application/json");
});
