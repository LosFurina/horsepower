import type { OutputLocale } from "../localization/index.js";

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

export type WebhookProvider = "generic" | "discord";

export interface WebhookConfig {
  url: string;
  auth: WebhookAuth;
  /** Missing provider preserves the legacy generic protocol. */
  provider?: WebhookProvider;
}

export interface WebhookDeliveryResult {
  delivered: boolean;
  attempts: number;
  provider?: WebhookProvider;
  failureClass?: "invalid_event" | "receiver_rejected" | "transport_failed" | "abandoned";
  statusCode?: number;
  error?: string;
}

/**
 * Result from a provider codec: the rendered body and headers for transport.
 */
export interface RenderedRequest {
  body: string;
  headers: Record<string, string>;
}
