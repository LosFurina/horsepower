import { createHash, createHmac } from "node:crypto";
import { message, validateOutputLocale, type OutputLocale } from "../localization/index.js";

export type TerminalScope = "change" | "dispatch";
export type TerminalStatus = "completed" | "blocked_needs_human" | "failed" | "canceled";

export interface TerminalWebhookEvent {
  eventId: string;
  timestamp: string;
  scope: TerminalScope;
  runId: string;
  changeId?: string;
  status: TerminalStatus;
  outputLocale?: OutputLocale;
  summary: string;
  evidenceRefs: readonly string[];
}

export type WebhookAuth =
  | { mode: "hmac"; secret: string }
  | { mode: "bearer"; token: string }
  | { mode: "none" };

export interface WebhookConfig {
  url: string;
  auth: WebhookAuth;
}

export interface WebhookNotifierOptions {
  config: WebhookConfig;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
  attemptTimeoutMs?: number;
}

export interface WebhookDeliveryResult {
  delivered: boolean;
  attempts: number;
  error?: string;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeEvent(value: unknown, authenticationValue?: string): TerminalWebhookEvent | undefined {
  if (value === null || Array.isArray(value) || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const allowed = new Set([
    "eventId", "timestamp", "scope", "runId", "changeId", "status", "outputLocale", "summary", "evidenceRefs",
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
  };
  const allValues = [event.eventId, event.timestamp, event.scope, event.status, event.outputLocale ?? "", event.runId,
    event.changeId ?? "", event.summary, ...event.evidenceRefs];
  if (authenticationValue && allValues.some((item) => item.includes(authenticationValue))) return undefined;
  if (Buffer.byteLength(JSON.stringify(event), "utf8") > 8 * 1024) return undefined;
  return event;
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
      const event = normalizeEvent(input, authenticationValue);
      if (!event) return { delivered: false, attempts: 0, error: "Invalid webhook event" };
      const body = JSON.stringify(event);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-horsepower-event-id": event.eventId,
        "x-horsepower-timestamp": event.timestamp,
      };
      if (options.config.auth.mode === "hmac") {
        headers["x-horsepower-signature"] = createHmac("sha256", options.config.auth.secret)
          .update(body)
          .digest("hex");
      } else if (options.config.auth.mode === "bearer") {
        headers.authorization = `Bearer ${options.config.auth.token}`;
      }

      let attempts = 0;
      for (const delay of retryDelays) {
        if (abandoned) return { delivered: false, attempts, error: "Webhook delivery abandoned" };
        if (delay > 0) await Promise.race([sleepImplementation(delay), abandonedSignal]);
        if (abandoned) return { delivered: false, attempts, error: "Webhook delivery abandoned" };
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
            if (response.ok) return { delivered: true, attempts };
          } finally {
            clearTimeout(timeout);
            activeControllers.delete(controller);
          }
        } catch {
          // The fixed result below deliberately omits receiver errors and credentials.
        }
      }
      return { delivered: false, attempts, error: "Webhook delivery failed" };
    },
  };
}
