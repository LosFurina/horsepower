import { createHash } from "node:crypto";
import { expect, test } from "vitest";

function webhookEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt-1",
    timestamp: "2026-07-20T00:00:00.000Z",
    scope: "change" as const,
    runId: "run-1",
    changeId: "change-1",
    status: "completed" as const,
    summary: "done",
    evidenceRefs: ["npm run e2e: exit 0"],
    ...overrides,
  };
}

// ============================
// CLI and Configuration tests
// ============================

test("configuration malformed JSON returns structured failure path", async () => {
  const { readJsonObject } = await import("../../src/config/json-store.js");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(join(tmpdir(), "horsepower-config-fail-"));
  const path = join(root, "settings.json");
  await writeFile(path, '{"apiKey":"do-not-leak",}');

  const error = await readJsonObject(path).catch((e: unknown) => e);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("Malformed JSON in");
  expect((error as Error).message).not.toContain("do-not-leak");
});

// ============================
// Webhook configuration tests
// ============================

test("webhook rejects invalid provider", async () => {
  const { validateWebhookProvider } = await import("../../src/config/webhook.js");
  expect(() => validateWebhookProvider("slack")).toThrow("unsupported provider");
  expect(validateWebhookProvider("generic")).toBe("generic");
  expect(validateWebhookProvider("discord")).toBe("discord");
  expect(validateWebhookProvider(undefined)).toBe("generic");
});

test("webhook rejects HTTP URL without localhost", async () => {
  const { validateWebhookUrl } = await import("../../src/config/webhook.js");
  expect(() => validateWebhookUrl("http://example.com/hook")).toThrow("HTTPS");
  expect(() => validateWebhookUrl("https://example.com/hook")).not.toThrow();
  expect(() => validateWebhookUrl("http://localhost:8080/hook")).not.toThrow();
  expect(() => validateWebhookUrl("http://127.0.0.1:8080/hook")).not.toThrow();
});

test("webhook rejects URL with credentials", async () => {
  const { validateWebhookUrl } = await import("../../src/config/webhook.js");
  expect(() => validateWebhookUrl("https://user:pass@example.com/hook")).toThrow("credentials");
});

test("webhook validates auth modes correctly", async () => {
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  const valid = parseWebhookSettings(
    { url: "https://example.test/hook", auth: { mode: "hmac", secret: "secret-123" } },
    undefined
  );
  expect(valid).toBeDefined();
  expect(valid!.config.auth).toEqual({ mode: "hmac", secret: "secret-123" });

  const bearer = parseWebhookSettings(
    { url: "https://example.test/hook", auth: { mode: "bearer", token: "tok-123" } },
    undefined
  );
  expect(bearer!.config.auth).toEqual({ mode: "bearer", token: "tok-123" });
});

test("webhook Discord provider must use none auth", async () => {
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  expect(() => parseWebhookSettings(
    { url: "https://discord.test/webhook", provider: "discord", auth: { mode: "hmac", secret: "s" } },
    undefined
  )).toThrow("Discord provider requires auth.mode=none");

  const valid = parseWebhookSettings(
    { url: "https://discord.test/webhook", provider: "discord", auth: { mode: "none" } },
    undefined
  );
  expect(valid).toBeDefined();
  expect(valid!.config.provider).toBe("discord");
});

test("webhook validates provider/auth compatibility", async () => {
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  // With no provider defaulting to generic, HMAC is fine
  const hmacGeneric = parseWebhookSettings(
    { url: "https://example.test/hook", auth: { mode: "hmac", secret: "s" } },
    undefined
  );
  expect(hmacGeneric).toBeDefined();

  // Discord requires none auth
  expect(() => parseWebhookSettings(
    { url: "https://discord.test/webhook", provider: "discord", auth: { mode: "hmac", secret: "s" } },
    undefined
  )).toThrow("Discord provider requires auth.mode=none");
});

test("webhook project overrides disable webhook", async () => {
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  const result = parseWebhookSettings(
    { url: "https://example.test/hook", auth: { mode: "none" } },
    { enabled: false }
  );
  expect(result).toBeUndefined();
});

test("webhook project and global notifications merge correctly", async () => {
  const { parseWebhookSettings } = await import("../../src/config/webhook.js");
  const result = parseWebhookSettings(
    { url: "https://example.test/hook", auth: { mode: "none" }, notifications: { change: true, dispatch: true } },
    { notifications: { change: false } }
  );
  expect(result!.notifications.change).toBe(false);
  expect(result!.notifications.dispatch).toBe(true);
});

// ============================
// Generic webhook notifier tests
// ============================

test("webhook generic receiver validates structured event and rejects invalid fields", async () => {
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test", auth: { mode: "none" }, provider: "generic" },
    fetch: async () => { throw new Error("should not be called"); },
  });

  await expect(notifier.notify(webhookEvent({ prompt: "private" })))
    .resolves.toMatchObject({ delivered: false, attempts: 0 });

  await expect(notifier.notify(webhookEvent({ scope: "invalid" })))
    .resolves.toMatchObject({ delivered: false, attempts: 0 });
});

test("webhook HMAC auth signs the redacted payload", async () => {
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const { createHmac } = await import("node:crypto");
  let body = "";
  let signature = "";
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test/hook", auth: { mode: "hmac", secret: "top-secret" }, provider: "generic" },
    fetch: async (_url, init) => {
      body = String(init?.body);
      signature = ((init?.headers as Record<string, string>)?.["x-horsepower-signature"] ?? "") as string;
      return new Response(null, { status: 204 });
    },
  });

  await expect(notifier.notify(webhookEvent())).resolves.toMatchObject({ delivered: true });
  const expectedSig = createHmac("sha256", "top-secret").update(body).digest("hex");
  expect(signature).toBe(expectedSig);
  const parsed = JSON.parse(body);
  expect(parsed.summary).not.toContain("done");
  expect(parsed.summary).toContain("completed");
});

test("webhook delivery failure does not expose secrets in error message", async () => {
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test", auth: { mode: "bearer", token: "super-secret-token" }, provider: "generic" },
    retryDelaysMs: [0, 1],
    sleep: async () => undefined,
    fetch: async () => { throw new Error("receiver error: token=super-secret-token"); },
  });

  const result = await notifier.notify(webhookEvent());
  expect(result.delivered).toBe(false);
  expect(JSON.stringify(result)).not.toContain("super-secret-token");
});

test("webhook notifier preserves structured failure in redacted payload", async () => {
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  let body = "";
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test", auth: { mode: "none" }, provider: "generic" },
    fetch: async (_url, init) => {
      body = String(init?.body);
      return new Response(null, { status: 204 });
    },
  });

  await expect(notifier.notify(webhookEvent({ status: "failed" }))).resolves.toMatchObject({ delivered: true });
  const parsed = JSON.parse(body);
  expect(parsed.scope).toBe("change");
  expect(parsed.status).toBe("failed");
  expect(parsed.summary).not.toContain("Worker failed");
});

test("webhook rejects events without evidenceRefs", async () => {
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { url: "https://example.test", auth: { mode: "none" }, provider: "generic" },
    fetch: async () => { throw new Error("should not be called"); },
  });

  const { evidenceRefs: _, ...noEvidence } = webhookEvent();
  await expect(notifier.notify(noEvidence as Parameters<typeof notifier.notify>[0]))
    .resolves.toMatchObject({ delivered: false, attempts: 0 });
});
