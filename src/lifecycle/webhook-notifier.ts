import { createHash, createHmac } from "node:crypto";
import { message, validateOutputLocale, type OutputLocale } from "../localization/index.js";
import { renderDiscordWebhook } from "../discord/codec.js";
import type {
  TerminalWebhookContext,
  TerminalWebhookFailure,
  TerminalWebhookEvent,
  WebhookAuth,
  WebhookConfig,
  WebhookDeliveryResult,
  WebhookProvider,
  RenderedRequest,
} from "./webhook-types.js";

export type { TerminalWebhookEvent, WebhookAuth, WebhookConfig, WebhookDeliveryResult, WebhookProvider, RenderedRequest };
export type { TerminalScope, TerminalStatus } from "./webhook-types.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Normalize a raw terminal event into a bounded privacy-safe canonical event.
 * This is the sole notification truth; the Discord adapter receives only this.
 */
function normalizeEvent(value: unknown, authenticationValue?: string): TerminalWebhookEvent | undefined {
  if (value === null || Array.isArray(value) || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    "eventId", "timestamp", "scope", "runId", "changeId", "status", "outputLocale", "summary", "evidenceRefs",
    "context", "diagnostic", "failure", "actionRequired",
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return undefined;
  if (typeof raw.eventId !== "string" || typeof raw.timestamp !== "string" ||
      typeof raw.runId !== "string" || typeof raw.summary !== "string" ||
      (raw.changeId !== undefined && typeof raw.changeId !== "string") ||
      !Array.isArray(raw.evidenceRefs) || !raw.evidenceRefs.every((item) => typeof item === "string")) {
    return undefined;
  }
  if (raw.scope !== "change" && raw.scope !== "dispatch") return undefined;
  if (raw.status !== "completed" && raw.status !== "blocked_needs_human" &&
      raw.status !== "failed" && raw.status !== "canceled") return undefined;
  if (raw.scope === "dispatch" && raw.status === "blocked_needs_human") return undefined;
  const timestamp = new Date(raw.timestamp);
  if (!Number.isFinite(timestamp.valueOf()) || timestamp.toISOString() !== raw.timestamp) return undefined;
  if (raw.eventId.length > 1_024 || raw.runId.length > 1_024 ||
      (raw.changeId?.length ?? 0) > 1_024 || raw.summary.length > 500 ||
      raw.evidenceRefs.length > 20 || raw.evidenceRefs.some((item) => item.length > 2_048)) {
    return undefined;
  }

  const opaque = (prefix: string, input: string) =>
    `${prefix}-${createHash("sha256").update(input).digest("hex")}`;
  let outputLocale: OutputLocale;
  try { outputLocale = raw.outputLocale === undefined ? "en" : validateOutputLocale(raw.outputLocale); } catch { return undefined; }
  const safeText = (input: unknown, limit: number): string | undefined => {
    if (typeof input !== "string") return undefined;
    const redacted = input
      .replace(/(?:api[_-]?key|token|secret|password|cookie|authorization|bearer)\s*[:=]\s*[^\s]+/giu, "[REDACTED]")
      .replace(/(?:\/(?:Users|home|private|tmp)\/[^\s]+|\/[^\s]*\.pi\/agent\/horsepower\/state\/handoffs\/[^\s]+)/giu, "[private-path]")
      .replace(/https?:\/\/[^\s"'<>]+/giu, "[REDACTED URL]")
      .replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
    let output = "", bytes = 0;
    for (const character of redacted) { const size = Buffer.byteLength(character, "utf8"); if (bytes + size > limit) break; output += character; bytes += size; }
    return output;
  };
  const contextKeys: Array<keyof TerminalWebhookContext> = ["campaignId","taskId","taskDescription","agent","workerId","requestedSlot","resolvedSlot","model","thinking","workKind","operation","projectLabel"];
  let context: TerminalWebhookContext | undefined;
  if (raw.context !== undefined) {
    if (raw.context === null || Array.isArray(raw.context) || typeof raw.context !== "object") return undefined;
    const source = raw.context as Record<string, unknown>;
    if (Object.keys(source).some((key) => ![...contextKeys,"elapsedMs","lastProgressAgeMs"].includes(key as keyof TerminalWebhookContext))) return undefined;
    context = {};
    for (const key of contextKeys) { const normalized = safeText(source[key], key === "taskDescription" ? 500 : 256); if (normalized) Object.assign(context, { [key]: normalized }); }
    for (const key of ["elapsedMs","lastProgressAgeMs"] as const) { const number = source[key]; if (number !== undefined) { if (typeof number !== "number" || !Number.isFinite(number) || number < 0) return undefined; Object.assign(context, { [key]: Math.floor(number) }); } }
  }
  let failure: TerminalWebhookFailure | undefined;
  if (raw.failure !== undefined) {
    if (raw.failure === null || Array.isArray(raw.failure) || typeof raw.failure !== "object") return undefined;
    const source = raw.failure as Record<string, unknown>;
    const keys: Array<keyof TerminalWebhookFailure> = ["code","boundary","stage","message","remediation"];
    if (Object.keys(source).some((key) => ![...keys,"retryable"].includes(key as keyof TerminalWebhookFailure))) return undefined;
    failure = {};
    for (const key of keys) { const normalized = safeText(source[key], key === "message" || key === "remediation" ? 500 : 128); if (normalized) Object.assign(failure, { [key]: normalized }); }
    if (source.retryable !== undefined) { if (typeof source.retryable !== "boolean") return undefined; failure.retryable = source.retryable; }
  }
  if (raw.diagnostic !== undefined && raw.diagnostic !== "blocked" && raw.diagnostic !== "stalled") return undefined;
  const actionRequired = raw.actionRequired === undefined ? undefined : safeText(raw.actionRequired, 500);
  const event: TerminalWebhookEvent = {
    eventId: opaque("evt", raw.eventId),
    timestamp: raw.timestamp,
    scope: raw.scope,
    runId: opaque("run", raw.runId),
    ...(raw.changeId === undefined ? {} : { changeId: opaque("change", raw.changeId) }),
    status: raw.status,
    outputLocale,
    summary: message(outputLocale, `webhook.${raw.status}` as "webhook.completed" | "webhook.blocked_needs_human" | "webhook.failed" | "webhook.canceled", { scope: raw.scope }),
    evidenceRefs: raw.evidenceRefs.map((reference) => opaque("evidence", reference)),
    ...(context && Object.keys(context).length > 0 ? { context } : {}),
    ...(raw.diagnostic ? { diagnostic: raw.diagnostic } : {}),
    ...(failure && Object.keys(failure).length > 0 ? { failure } : {}),
    ...(actionRequired ? { actionRequired } : {}),
  };
  const allValues = [event.eventId, event.timestamp, event.scope, event.status, event.outputLocale ?? "", event.runId,
    event.changeId ?? "", event.summary, ...event.evidenceRefs];
  if (authenticationValue && allValues.some((item) => item.includes(authenticationValue))) return undefined;
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > 8 * 1024) return undefined;
  return event;
}

/**
 * Render a provider-specific request body and headers from a canonical event.
 */
function renderProviderRequest(
  event: TerminalWebhookEvent,
  config: WebhookConfig,
): RenderedRequest {
  if (config.provider === "discord") {
    const discordBody = renderDiscordWebhook(event);
    return {
      body: JSON.stringify(discordBody),
      headers: { "content-type": "application/json" },
    };
  }

  // Generic provider: canonical JSON with Horsepower event headers
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-horsepower-event-id": event.eventId,
    "x-horsepower-timestamp": event.timestamp,
  };
  if (config.auth.mode === "hmac") {
    headers["x-horsepower-signature"] = createHmac("sha256", config.auth.secret)
      .update(body)
      .digest("hex");
  } else if (config.auth.mode === "bearer") {
    headers.authorization = `Bearer ${config.auth.token}`;
  }
  return { body, headers };
}

export interface WebhookNotifierOptions {
  config: WebhookConfig;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  attemptTimeoutMs?: number;
  /** Include bounded protocol diagnostics for an explicit user-requested probe. */
  diagnostic?: boolean;
}

export function createWebhookNotifier(options: WebhookNotifierOptions) {
  const fetchImplementation = options.fetch ?? fetch;
  const sleepImplementation = options.sleep ?? sleep;
  const defaultRetryDelays = [0, 5_000, 30_000, 120_000] as const;
  const supplied = options.retryDelaysMs;
  const retryDelays = supplied && supplied.length <= 4 && supplied[0] === 0 &&
    supplied.every((delay, index) => delay >= 0 && delay <= 120_000 &&
      (index === 0 || delay > supplied[index - 1]!)) &&
    supplied.reduce((total, delay) => total + delay, 0) <= 155_000
    ? supplied
    : defaultRetryDelays;
  const attemptTimeoutMs = Math.min(Math.max(options.attemptTimeoutMs ?? 10_000, 1), 30_000);
  let abandoned = false;
  let resolveAbandoned!: () => void;
  const abandonedSignal = new Promise<void>((resolve) => { resolveAbandoned = resolve; });
  const activeControllers = new Set<AbortController>();

  return {
    abandon(): void {
      if (abandoned) return;
      abandoned = true;
      resolveAbandoned();
      for (const controller of activeControllers) controller.abort();
    },
    async notify(input: TerminalWebhookEvent): Promise<WebhookDeliveryResult> {
      const authenticationValue = options.config.auth.mode === "hmac"
        ? options.config.auth.secret
        : options.config.auth.mode === "bearer"
          ? options.config.auth.token
          : undefined;
      const provider = options.config.provider ?? "generic";
      const event = normalizeEvent(input, authenticationValue);
      if (!event) return options.diagnostic
        ? { delivered: false, attempts: 0, provider, failureClass: "invalid_event", error: "Invalid webhook event" }
        : { delivered: false, attempts: 0, error: "Invalid webhook event" };

      // Provider-specific rendering
      const { body, headers } = renderProviderRequest(event, options.config);

      let attempts = 0;
      let statusCode: number | undefined;
      let reachedReceiver = false;
      for (const delay of retryDelays) {
        if (abandoned) return options.diagnostic
          ? { delivered: false, attempts, provider, failureClass: "abandoned", error: "Webhook delivery abandoned" }
          : { delivered: false, attempts, error: "Webhook delivery abandoned" };
        if (delay > 0) await Promise.race([sleepImplementation(delay), abandonedSignal]);
        if (abandoned) return options.diagnostic
          ? { delivered: false, attempts, provider, failureClass: "abandoned", error: "Webhook delivery abandoned" }
          : { delivered: false, attempts, error: "Webhook delivery abandoned" };
        attempts += 1;
        try {
          const controller = new AbortController();
          activeControllers.add(controller);
          const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
          try {
            const response = await fetchImplementation(options.config.url, {
              method: "POST",
              headers,
              body,
              signal: controller.signal,
            });
            reachedReceiver = true;
            statusCode = response.status;
            if (response.ok) return options.diagnostic
              ? { delivered: true, attempts, provider, statusCode }
              : { delivered: true, attempts };
          } finally {
            clearTimeout(timeout);
            activeControllers.delete(controller);
          }
        } catch {
          // The fixed result below deliberately omits receiver errors and credentials.
        }
      }
      return options.diagnostic
        ? {
          delivered: false,
          attempts,
          provider,
          failureClass: reachedReceiver ? "receiver_rejected" : "transport_failed",
          ...(statusCode === undefined ? {} : { statusCode }),
          error: "Webhook delivery failed",
        }
        : { delivered: false, attempts, error: "Webhook delivery failed" };
    },
  };
}
