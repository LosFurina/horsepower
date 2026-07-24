import type { OutputLocale } from "../localization/index.js";

export type TerminalScope = "change" | "dispatch";
export type TerminalStatus = "completed" | "blocked_needs_human" | "failed" | "canceled";
export type TerminalDiagnostic = "blocked" | "stalled";

export interface TerminalWebhookContext {
  campaignId?: string;
  taskId?: string;
  taskDescription?: string;
  agent?: string;
  workerId?: string;
  requestedSlot?: string;
  resolvedSlot?: string;
  model?: string;
  thinking?: string;
  workKind?: string;
  operation?: string;
  elapsedMs?: number;
  lastProgressAgeMs?: number;
  projectLabel?: string;
}

export interface TerminalWebhookFailure {
  code?: string;
  boundary?: string;
  stage?: string;
  message?: string;
  remediation?: string;
  retryable?: boolean;
}

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
  context?: TerminalWebhookContext;
  diagnostic?: TerminalDiagnostic;
  failure?: TerminalWebhookFailure;
  actionRequired?: string;
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
