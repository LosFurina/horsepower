import type { CompletionEvidence, VerificationDecision } from "./verification-gate.js";
import { verifyCompletion } from "./verification-gate.js";
import type {
  TerminalScope,
  TerminalStatus,
  TerminalWebhookEvent,
  WebhookDeliveryResult,
} from "./webhook-notifier.js";

export type RunStatus = "running" | TerminalStatus;
export type DispatchTerminalStatus = Exclude<TerminalStatus, "blocked_needs_human">;

export interface RunRecord {
  runId: string;
  scope: TerminalScope;
  changeId: string;
  status: RunStatus;
  summary?: string;
  verification?: VerificationDecision;
  startedAt: string;
  stoppedAt?: string;
  delivery?: WebhookDeliveryResult;
}

export interface RunLifecycleOptions {
  notifications?: { change?: boolean; dispatch?: boolean };
  notify?: (event: TerminalWebhookEvent) => Promise<WebhookDeliveryResult>;
  stopNotifications?: () => void;
  now?: () => Date;
  makeId?: (prefix: string) => string;
}

export interface ChangeTerminalReport {
  runId: string;
  status: TerminalStatus;
  summary: string;
  evidence?: CompletionEvidence;
  evidenceRefs?: readonly string[];
}

export interface DispatchTerminalReport {
  runId: string;
  status: DispatchTerminalStatus;
  summary: string;
  evidenceRefs?: readonly string[];
}

function webhookText(value: string, limit: number): string {
  const credentialLabel = /(?:api[_-]?key|token|secret|password|cookie|authorization|bearer)/iu;
  if (credentialLabel.test(value)) return "[REDACTED: credential-like content]";
  return value.replace(/[\r\n]+/gu, " ").slice(0, limit);
}

export function createRunLifecycle(options: RunLifecycleOptions) {
  const runs = new Map<string, RunRecord>();
  const deliveries = new Map<string, Promise<WebhookDeliveryResult>>();
  const notifications = {
    change: options.notifications?.change ?? true,
    dispatch: options.notifications?.dispatch ?? false,
  };
  const now = options.now ?? (() => new Date());
  const makeId = options.makeId ?? ((prefix: string) => `${prefix}-${crypto.randomUUID()}`);

  function begin(scope: TerminalScope, input: { changeId: string; summary?: string }): RunRecord {
    const runId = makeId("run");
    const run: RunRecord = {
      runId,
      scope,
      changeId: input.changeId,
      status: "running",
      startedAt: now().toISOString(),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
    };
    runs.set(runId, run);
    return structuredClone(run);
  }

  function requireRun(runId: string, scope?: TerminalScope): RunRecord {
    const run = runs.get(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    if (scope && run.scope !== scope) throw new Error(`Run ${runId} is not ${scope} scope`);
    return run;
  }

  async function terminal(
    scope: TerminalScope,
    report: ChangeTerminalReport | DispatchTerminalReport,
  ) {
    const run = requireRun(report.runId, scope);
    if (run.status !== "running") throw new Error(`Run is already terminal: ${run.runId}`);
    const changeStatuses = new Set(["completed", "blocked_needs_human", "failed", "canceled"]);
    const dispatchStatuses = new Set(["completed", "failed", "canceled"]);
    if (scope === "change" && !changeStatuses.has(report.status)) {
      throw new Error(`Invalid change terminal status: ${String(report.status)}`);
    }
    if (scope === "dispatch" && !dispatchStatuses.has(report.status)) {
      throw new Error("Dispatch terminal status must be completed, failed, or canceled");
    }
    const verification = report.status === "completed" && scope === "change"
      ? verifyCompletion((report as ChangeTerminalReport).evidence ?? {})
      : undefined;
    const stoppedAt = now().toISOString();
    run.status = report.status;
    run.summary = report.summary;
    run.stoppedAt = stoppedAt;
    if (verification) run.verification = verification;

    if (notifications[scope] && options.notify) {
      let payload: TerminalWebhookEvent;
      try {
        payload = {
          eventId: makeId("evt"),
          timestamp: stoppedAt,
          scope,
          runId: run.runId,
          changeId: run.changeId,
          status: report.status,
          summary: webhookText(report.summary, 500),
          evidenceRefs: [...(report.evidenceRefs ?? [])].slice(0, 20)
            .map((reference) => webhookText(reference, 200)),
        };
      } catch {
        const result: WebhookDeliveryResult = {
          delivered: false,
          attempts: 0,
          error: "Webhook delivery failed",
        };
        run.delivery = result;
        return {
          run: structuredClone(run),
          delivery: { status: "failed" as const, result },
        };
      }
      const delivery = Promise.resolve()
        .then(() => options.notify!(payload))
        .catch((): WebhookDeliveryResult => ({
          delivered: false,
          attempts: 0,
          error: "Webhook delivery failed",
        }))
        .then((result) => {
          run.delivery = result;
          return result;
        });
      deliveries.set(run.runId, delivery);
      return { run: structuredClone(run), delivery: { status: "pending" as const } };
    }
    return { run: structuredClone(run) };
  }

  return {
    beginChange(input: { changeId: string }) { return begin("change", input); },
    beginDispatch(input: { changeId: string; summary?: string }) { return begin("dispatch", input); },
    reportChangeTerminal(report: ChangeTerminalReport) { return terminal("change", report); },
    reportDispatchTerminal(report: DispatchTerminalReport) { return terminal("dispatch", report); },
    async waitForDelivery(runId: string): Promise<WebhookDeliveryResult> {
      requireRun(runId);
      const delivery = deliveries.get(runId);
      if (!delivery) throw new Error(`Run has no webhook delivery: ${runId}`);
      return delivery;
    },
    async shutdown(): Promise<void> {
      options.stopNotifications?.();
      await Promise.allSettled(deliveries.values());
    },
    abandon(): void {
      options.stopNotifications?.();
    },
    workerIdle(runId: string): false {
      requireRun(runId, "dispatch");
      return false;
    },
    status(runId: string): RunRecord { return structuredClone(requireRun(runId)); },
    list(): RunRecord[] { return [...runs.values()].map((run) => structuredClone(run)); },
  };
}
