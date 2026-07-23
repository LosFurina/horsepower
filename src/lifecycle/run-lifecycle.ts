import type { CompletionEvidence, VerificationDecision, AcceptanceSnapshot, VerificationManifest } from "./verification-gate.js";
import { verifyCompletionManifest } from "./verification-gate.js";
import type { OutputLocale } from "../localization/index.js";
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

export interface RunNotificationBinding {
  enabled: boolean;
  outputLocale?: OutputLocale;
  notify?: (event: TerminalWebhookEvent) => Promise<WebhookDeliveryResult>;
}

export interface RunIdentity {
  changeId: string;
  projectId: string;
}

export interface RunLifecycleOptions {
  notifications?: { change?: boolean; dispatch?: boolean };
  notify?: (event: TerminalWebhookEvent) => Promise<WebhookDeliveryResult>;
  stopNotifications?: () => void;
  now?: () => Date;
  makeId?: (prefix: string) => string;
  acceptanceSnapshot?: (input: { runId: string; changeId: string; projectId: string }) => AcceptanceSnapshot | Promise<AcceptanceSnapshot>;
}

export interface ChangeTerminalReport {
  runId: string;
  status: TerminalStatus;
  summary: string;
  verification?: VerificationManifest;
  /** @deprecated legacy fields are rejected for completed reports. */
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
  const notificationBindings = new Map<string, RunNotificationBinding>();
  const runIdentities = new Map<string, RunIdentity>();
  const notifications = {
    change: options.notifications?.change ?? true,
    dispatch: options.notifications?.dispatch ?? false,
  };
  const now = options.now ?? (() => new Date());
  const makeId = options.makeId ?? ((prefix: string) => `${prefix}-${crypto.randomUUID()}`);
  let closed = false;
  let shutdown: Promise<void> | undefined;

  function assertOpen(): void {
    if (closed) throw new Error("Run lifecycle is closed");
  }

  function begin(
    scope: TerminalScope,
    input: { changeId: string; projectId: string; summary?: string },
    notification?: RunNotificationBinding,
  ): RunRecord {
    assertOpen();
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
    runIdentities.set(runId, { changeId: input.changeId, projectId: input.projectId });
    if (notification) notificationBindings.set(runId, notification);
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
    assertOpen();
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
    let verification: VerificationDecision | undefined;
    if (report.status === "completed" && scope === "change") {
      const changeReport = report as ChangeTerminalReport;
      const legacy = changeReport.verification === undefined ? changeReport.evidence : undefined;
      if (legacy && typeof legacy === "object" && "workerReport" in (legacy as object)) throw new Error("VERIFICATION_WORKER_REPORT_ONLY: Captain must independently verify worker claims");
      if (legacy && typeof legacy === "object" && ("e2e" in (legacy as object) || "e2eWaiver" in (legacy as object))) throw new Error("VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED: submit a claim-matched verification manifest");
      const manifest = changeReport.verification ?? (legacy as VerificationManifest | undefined);
      if (!manifest || typeof manifest.observedAt !== "string" || !Array.isArray(manifest.acceptance)) {
        throw new Error("VERIFICATION_MANIFEST_REQUIRED: report fresh claim-matched verification manifest");
      }
      const identity = runIdentities.get(run.runId)!;
      const currentAcceptanceSnapshot = options.acceptanceSnapshot
        ? await options.acceptanceSnapshot({ runId: run.runId, changeId: run.changeId, projectId: identity.projectId })
        : (() => { throw new Error("VERIFICATION_ACCEPTANCE_SNAPSHOT_REQUIRED: current official acceptance snapshot is unavailable"); })();
      if (run.status !== "running") throw new Error(`Run is already terminal: ${run.runId}`);
      const receiptAt = now().toISOString();
      verification = verifyCompletionManifest(manifest, {
        runStartedAt: run.startedAt,
        now: receiptAt,
        currentAcceptanceSnapshot,
      });
      run.status = report.status;
      run.summary = report.summary;
      run.stoppedAt = receiptAt;
      run.verification = verification;
    } else {
      if (run.status !== "running") throw new Error(`Run is already terminal: ${run.runId}`);
      const stoppedAt = now().toISOString();
      run.status = report.status;
      run.summary = report.summary;
      run.stoppedAt = stoppedAt;
    }
    const stoppedAt = run.stoppedAt!;
    const notification = notificationBindings.get(run.runId) ?? {
      enabled: notifications[scope],
      ...(options.notify ? { notify: options.notify } : {}),
    };
    notificationBindings.delete(run.runId);
    if (notification.enabled && notification.notify) {
      let payload: TerminalWebhookEvent;
      try {
        payload = {
          eventId: makeId("evt"),
          timestamp: stoppedAt,
          scope,
          runId: run.runId,
          changeId: run.changeId,
          status: report.status,
          outputLocale: notification.outputLocale ?? "en",
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
        .then(() => notification.notify!(payload))
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
    beginChange(input: { changeId: string; projectId: string }, notification?: RunNotificationBinding) {
      return begin("change", input, notification);
    },
    beginDispatch(input: { changeId: string; projectId: string; summary?: string }, notification?: RunNotificationBinding) {
      return begin("dispatch", input, notification);
    },
    reportChangeTerminal(report: ChangeTerminalReport) { return terminal("change", report); },
    reportDispatchTerminal(report: DispatchTerminalReport) { return terminal("dispatch", report); },
    async waitForDelivery(runId: string): Promise<WebhookDeliveryResult> {
      requireRun(runId);
      const delivery = deliveries.get(runId);
      if (!delivery) throw new Error(`Run has no webhook delivery: ${runId}`);
      return delivery;
    },
    shutdown(): Promise<void> {
      if (shutdown) return shutdown;
      closed = true;
      options.stopNotifications?.();
      shutdown = Promise.allSettled(deliveries.values()).then(() => undefined);
      return shutdown;
    },
    abandon(): void {
      if (closed) return;
      closed = true;
      options.stopNotifications?.();
    },
    workerIdle(runId: string): false {
      requireRun(runId, "dispatch");
      return false;
    },
    status(runId: string): RunRecord { return structuredClone(requireRun(runId)); },
    identity(runId: string): RunIdentity {
      requireRun(runId);
      return structuredClone(runIdentities.get(runId)!);
    },
    list(): RunRecord[] { return [...runs.values()].map((run) => structuredClone(run)); },
  };
}
