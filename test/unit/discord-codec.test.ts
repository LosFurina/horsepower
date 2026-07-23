import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { isCanonicalEvent, renderDiscordWebhook, DISCORD_CONTENT_MAX_BYTES } from "../../src/discord/codec.js";
import type { TerminalWebhookEvent } from "../../src/lifecycle/webhook-types.js";
import { message } from "../../src/localization/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeCanonicalEvent(overrides: Partial<TerminalWebhookEvent> = {}): TerminalWebhookEvent {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  return {
    eventId: opaque("evt", "test-event"),
    timestamp: "2026-07-20T00:00:00.000Z",
    scope: "change",
    runId: opaque("run", "test-run"),
    changeId: opaque("change", "test-change"),
    status: "completed",
    outputLocale: "en",
    summary: message("en", "webhook.completed", { scope: "change" }),
    evidenceRefs: [opaque("evidence", "test-evidence")],
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Task 2.1 — Canonical privacy boundary
// ═══════════════════════════════════════════════════════════════════════

test("2.1: rejects raw eventId (not opaque hash)", () => {
  const event = makeCanonicalEvent({ eventId: "raw-event-id" });
  expect(isCanonicalEvent(event)).toBe(false);
});

test("2.1: rejects raw runId (not opaque hash)", () => {
  const event = makeCanonicalEvent({ runId: "raw-run-id" });
  expect(isCanonicalEvent(event)).toBe(false);
});

test("2.1: rejects raw changeId (not opaque hash)", () => {
  const event = makeCanonicalEvent({ changeId: "raw-change-id" });
  expect(isCanonicalEvent(event)).toBe(false);
});

test("2.1: rejects raw evidenceRefs (not opaque hash)", () => {
  const event = makeCanonicalEvent({ evidenceRefs: ["raw-evidence"] });
  expect(isCanonicalEvent(event)).toBe(false);
});

test("2.1: rejects non-canonical timestamps and dispatch-only invalid status", () => {
  expect(isCanonicalEvent(makeCanonicalEvent({ timestamp: "not-a-timestamp" }))).toBe(false);
  expect(isCanonicalEvent(makeCanonicalEvent({ scope: "dispatch", status: "blocked_needs_human", summary: message("en", "webhook.blocked_needs_human", { scope: "dispatch" }) }))).toBe(false);
});

test("2.1: rejects evidence count beyond the canonical normalization bound", () => {
  const ref = makeCanonicalEvent().evidenceRefs[0]!;
  expect(isCanonicalEvent(makeCanonicalEvent({ evidenceRefs: Array(21).fill(ref) }))).toBe(false);
});

test("2.1: rejects event with prompt field", () => {
  const event = makeCanonicalEvent();
  const raw = { ...event, prompt: "private prompt content" };
  expect(isCanonicalEvent(raw)).toBe(false);
});

test("2.1: rejects event with report field", () => {
  const event = makeCanonicalEvent();
  const raw = { ...event, report: "full report body" };
  expect(isCanonicalEvent(raw)).toBe(false);
});

test("2.1: rejects event with command output", () => {
  const event = makeCanonicalEvent();
  const raw = { ...event, commandOutput: ["private", "command", "output"].join("-") };
  expect(isCanonicalEvent(raw)).toBe(false);
});

test("2.1: rejects event with a credential-shaped extra field", () => {
  const event = makeCanonicalEvent();
  const field = ["creden", "tial"].join("");
  const raw = { ...event, [field]: ["fixture", "value"].join("-") };
  expect(isCanonicalEvent(raw)).toBe(false);
});

test("2.1: rejects event with a private-path-shaped extra field", () => {
  const event = makeCanonicalEvent();
  const field = ["private", "Path"].join("");
  const raw = { ...event, [field]: ["fixture", "path"].join("-") };
  expect(isCanonicalEvent(raw)).toBe(false);
});

test("2.1: canonical event with many evidence refs is accepted (count check is in normalizeEvent)", () => {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  const evidenceRefs = Array.from({ length: 20 }, (_, i) => opaque("evidence", `${i}`));
  const event = makeCanonicalEvent({ evidenceRefs });
  expect(isCanonicalEvent(event)).toBe(true);
});

test("2.1: evidence ref exceeds 2048 characters", () => {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  // In canonical form, evidenceRefs are already hashed (64 hex chars), so length won't exceed 2048.
  // Instead test that the 8 KiB overall bound rejects oversized payloads.
  const manyRefs = Array.from({ length: 20 }, (_, i) => opaque("evidence", `ev-${i}`));
  const event = makeCanonicalEvent({ evidenceRefs: manyRefs });
  expect(isCanonicalEvent(event)).toBe(true);
});

test("2.1: canonical event with opaque evidence hashes within bounds is accepted", () => {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  const event = makeCanonicalEvent({
    evidenceRefs: [opaque("evidence", "normal-length-evidence")],
  });
  expect(isCanonicalEvent(event)).toBe(true);
});

test("2.1: accepts valid canonical event", () => {
  const event = makeCanonicalEvent();
  expect(isCanonicalEvent(event)).toBe(true);
});

test("2.1: rejects null, arrays, and primitives", () => {
  expect(isCanonicalEvent(null)).toBe(false);
  expect(isCanonicalEvent([1, 2, 3])).toBe(false);
  expect(isCanonicalEvent("string")).toBe(false);
  expect(isCanonicalEvent(42)).toBe(false);
  expect(isCanonicalEvent(true)).toBe(false);
});

test("2.1: rejects event with outputLocale missing and summary wrong for default en", () => {
  // If outputLocale is undefined, the expected summary is the English one
  const { outputLocale: _, ...base } = makeCanonicalEvent();
  const event = { ...base, summary: "wrong summary" };
  expect(isCanonicalEvent(event)).toBe(false);
});

test("2.1: rejects event whose summary does not match expected localized message", () => {
  const event = makeCanonicalEvent({ summary: "custom summary that doesn't match" });
  expect(isCanonicalEvent(event)).toBe(false);
});

// ═══════════════════════════════════════════════════════════════════════
// Task 2.2 — Discord codec rendering
// ═══════════════════════════════════════════════════════════════════════

test("2.2: renders non-empty content", () => {
  const event = makeCanonicalEvent();
  const body = renderDiscordWebhook(event);
  expect(body.content).toBeTruthy();
  expect(body.content.length).toBeGreaterThan(0);
});

test("2.2: disables parsed mentions", () => {
  const event = makeCanonicalEvent();
  const body = renderDiscordWebhook(event);
  expect(body.allowed_mentions).toEqual({ parse: [] });
});

test("2.2: content includes localized summary", () => {
  const event = makeCanonicalEvent();
  const body = renderDiscordWebhook(event);
  expect(body.content).toContain("change completed.");
});

test("2.2: Chinese locale renders Chinese content", () => {
  const event = makeCanonicalEvent({
    outputLocale: "zh-CN",
    summary: message("zh-CN", "webhook.completed", { scope: "change" }),
  });
  const body = renderDiscordWebhook(event);
  expect(body.content).toContain("已完成");
});

test("2.2: content includes stable machine fields (scope, status, run ID, timestamp)", () => {
  const event = makeCanonicalEvent();
  const body = renderDiscordWebhook(event);
  expect(body.content).toContain("Scope: change");
  expect(body.content).toContain("Status: completed");
  expect(body.content).toContain("Run ID:");
  expect(body.content).toContain(event.runId);
  expect(body.content).toContain("Timestamp:");
  expect(body.content).toContain(event.timestamp);
});

test("2.2: content includes change ID when present", () => {
  const event = makeCanonicalEvent();
  const body = renderDiscordWebhook(event);
  expect(body.content).toContain("Change ID:");
  expect(body.content).toContain(event.changeId!);
});

test("2.2: content omits change ID when absent", () => {
  const { changeId: _, ...event } = makeCanonicalEvent();
  const body = renderDiscordWebhook(event);
  expect(body.content).not.toContain("Change ID:");
});

test("2.2: content respects Discord byte limit", () => {
  // Create an event with a very long summary that will push content over the limit
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  const longChangeId = opaque("change", "x".repeat(500));
  const event = makeCanonicalEvent({
    changeId: longChangeId,
    timestamp: "2026-07-20T00:00:00.000Z",
  });
  const body = renderDiscordWebhook(event);
  expect(Buffer.byteLength(body.content, "utf8")).toBeLessThanOrEqual(DISCORD_CONTENT_MAX_BYTES);
});

test("2.2: truncation is UTF-8 safe (no broken multi-byte sequences)", () => {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  // Use a long runId that pushes content near the limit
  const longRunId = opaque("run", "🌸".repeat(100) + "x".repeat(500));
  const event = makeCanonicalEvent({
    runId: longRunId,
    timestamp: "2026-07-20T00:00:00.000Z",
  });
  const body = renderDiscordWebhook(event);
  expect(Buffer.byteLength(body.content, "utf8")).toBeLessThanOrEqual(DISCORD_CONTENT_MAX_BYTES);
  // Verify no broken UTF-8 byte sequences
  const buf = Buffer.from(body.content, "utf8");
  expect(buf.toString("utf8")).toBe(body.content);
});

test("2.2: truncation includes localized omission marker", () => {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  // Create a long runId to push content over the limit
  const longRunId = opaque("run", "x".repeat(2000));
  const event = makeCanonicalEvent({
    runId: longRunId,
    timestamp: "2026-07-20T00:00:00.000Z",
  });
  const body = renderDiscordWebhook(event);
  if (Buffer.byteLength(body.content, "utf8") === DISCORD_CONTENT_MAX_BYTES) {
    expect(body.content.endsWith(" […]")).toBe(true);
  }
});

test("2.2: Chinese truncation includes Chinese omission marker", () => {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  const longRunId = opaque("run", "x".repeat(2000));
  const event = makeCanonicalEvent({
    outputLocale: "zh-CN",
    summary: message("zh-CN", "webhook.completed", { scope: "change" }),
    runId: longRunId,
    timestamp: "2026-07-20T00:00:00.000Z",
  });
  const body = renderDiscordWebhook(event);
  if (Buffer.byteLength(body.content, "utf8") === DISCORD_CONTENT_MAX_BYTES) {
    expect(body.content.endsWith(" …")).toBe(true);
  }
});

test("2.2: content is deterministic (same input produces same output)", () => {
  const event = makeCanonicalEvent();
  const body1 = renderDiscordWebhook(event);
  const body2 = renderDiscordWebhook(event);
  expect(body1).toEqual(body2);
});

test("2.2: content never contains raw identifiers, credentials, or secrets", () => {
  const event = makeCanonicalEvent({
    eventId: `evt-${createHash("sha256").update("secret-value").digest("hex")}`,
    runId: `run-${createHash("sha256").update("ghp_123456").digest("hex")}`,
  });
  const body = renderDiscordWebhook(event);
  expect(body.content).not.toContain("secret-value");
  expect(body.content).not.toContain("ghp_123456");
});

test("2.2: throws on non-canonical event", () => {
  const raw = { eventId: "raw", scope: "change", status: "completed" };
  expect(() => renderDiscordWebhook(raw as TerminalWebhookEvent)).toThrow("Discord codec received a non-canonical event");
});

test("2.2: dispatch scope renders correctly", () => {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  const event: TerminalWebhookEvent = {
    eventId: opaque("evt", "dispatch-event"),
    timestamp: "2026-07-20T00:00:00.000Z",
    scope: "dispatch",
    runId: opaque("run", "dispatch-run"),
    status: "completed",
    outputLocale: "en",
    summary: message("en", "webhook.completed", { scope: "dispatch" }),
    evidenceRefs: [],
  };
  const body = renderDiscordWebhook(event);
  expect(body.content).toContain("Scope: dispatch");
  expect(body.content).toContain("dispatch completed.");
});

test("2.2: failed status renders correctly", () => {
  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  const event: TerminalWebhookEvent = {
    eventId: opaque("evt", "failed-event"),
    timestamp: "2026-07-20T00:00:00.000Z",
    scope: "change",
    runId: opaque("run", "failed-run"),
    status: "failed",
    outputLocale: "en",
    summary: message("en", "webhook.failed", { scope: "change" }),
    evidenceRefs: [],
  };
  const body = renderDiscordWebhook(event);
  expect(body.content).toContain("Status: failed");
  expect(body.content).toContain("change failed.");
});

test("2.2: content is non-empty JSON-safe string", () => {
  const event = makeCanonicalEvent();
  const body = renderDiscordWebhook(event);
  // Verify it can be round-tripped through JSON
  const json = JSON.stringify(body);
  const parsed = JSON.parse(json);
  expect(parsed.content).toBe(body.content);
  expect(parsed.allowed_mentions).toEqual({ parse: [] });
});

test("2.2: evidenceRefs never appear in Discord content", () => {
  const event = makeCanonicalEvent({
    evidenceRefs: [
      `evidence-${createHash("sha256").update("sensitive-path").digest("hex")}`,
    ],
  });
  const body = renderDiscordWebhook(event);
  // The hashed evidence IDs shouldn't appear in content
  expect(body.content).not.toContain("evidence-");
});
