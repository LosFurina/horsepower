import { expect, test, vi } from "vitest";
import type { TerminalWebhookEvent, WebhookDeliveryResult } from "../../src/lifecycle/webhook-notifier.js";

function setup(options: { change?: boolean; dispatch?: boolean } = {}) {
  const notifications: TerminalWebhookEvent[] = [];
  return import("../../src/lifecycle/run-lifecycle.js").then(({ createRunLifecycle }) => ({
    notifications,
    lifecycle: createRunLifecycle({
      ...(options.change === undefined && options.dispatch === undefined ? {} : {
        notifications: {
          change: options.change ?? true,
          dispatch: options.dispatch ?? false,
        },
      }),
      now: (() => {
        let first = true;
        return () => {
          if (first) { first = false; return new Date("2026-07-21T11:40:00.000Z"); }
          return new Date("2026-07-21T12:00:00.000Z");
        };
      })(),
      acceptanceSnapshot: async () => ({ digest: "sha256:current", refs: ["task:1.1"] }),
      makeId: (prefix) => `${prefix}-1`,
      notify: async (event): Promise<WebhookDeliveryResult> => {
        notifications.push(event);
        return { delivered: true, attempts: 1 };
      },
    }),
  }));
}

test("requires explicit Captain reporting and blocks unit-only completion", async () => {
  const { lifecycle, notifications } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  expect(notifications).toEqual([]);
  await expect(lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "completed",
    summary: "Unit tests passed",
    evidence: { unit: [{ command: "npm test", exitCode: 0, summary: "passed" }] },
  })).rejects.toThrow("VERIFICATION_MANIFEST_REQUIRED: report fresh claim-matched verification manifest");
  expect(lifecycle.status(run.runId).status).toBe("running");
  expect(notifications).toEqual([]);
});

test("fails closed when current official acceptance is unavailable", async () => {
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({
    now: () => new Date("2026-07-21T12:00:00.000Z"),
    makeId: (prefix) => `${prefix}-snapshot-missing`,
  });
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  await expect(lifecycle.reportChangeTerminal({
    runId: run.runId, status: "completed", summary: "completed", verification: {
      observedAt: run.startedAt,
      commands: [{ id: "evidence-1", kind: "e2e" as const, command: "npm run e2e", exitCode: 0, summary: "passed", acceptanceRefs: ["task:1.1"] }],
      acceptance: [{ ref: "task:1.1", evidenceIds: ["evidence-1"] }],
    },
  })).rejects.toThrow("VERIFICATION_ACCEPTANCE_SNAPSHOT_REQUIRED");
  expect(lifecycle.status(run.runId).status).toBe("running");
});

test.each(["failed", "canceled", "blocked_needs_human"] as const)("preserves non-complete terminal compatibility for %s without verification", async (status) => {
  const { lifecycle } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  await expect(lifecycle.reportChangeTerminal({ runId: run.runId, status, summary: status })).resolves.toMatchObject({ run: { status } });
  expect(lifecycle.status(run.runId).verification).toBeUndefined();
});

const validManifest = {
  observedAt: "2026-07-21T11:59:30.000Z",
  commands: [{ id: "evidence-1", kind: "e2e" as const, command: "npm run e2e", exitCode: 0, summary: "passed", acceptanceRefs: ["task:1.1"] }],
  acceptance: [{ ref: "task:1.1", evidenceIds: ["evidence-1"] }],
};

const rejectedManifestCases = [
  ["stale", { observedAt: "2026-07-21T11:49:59.000Z" }, "VERIFICATION_EVIDENCE_STALE: provide verification observed within the freshness window"],
  ["future-skewed", { observedAt: "2026-07-21T12:00:01.000Z" }, "VERIFICATION_EVIDENCE_FUTURE_SKEW: observedAt cannot be in the future"],
  ["failed", { commands: [{ ...validManifest.commands[0], exitCode: 1, summary: "failed" }] }, "VERIFICATION_COMMAND_FAILED: every verification command must succeed"],
  ["missing", { acceptance: [{ ref: "task:1.1", evidenceIds: ["missing"] }] }, "VERIFICATION_EVIDENCE_REFERENCE_MISSING: acceptance references must resolve to command evidence"],
  ["partial", { acceptance: [] }, "VERIFICATION_ACCEPTANCE_PARTIAL: every current acceptance item must be covered"],
  ["scope-drifted", { acceptance: [{ ref: "task:other", evidenceIds: ["evidence-1"] }] }, "VERIFICATION_SCOPE_DRIFT: evidence must match the current acceptance scope"],
] as const;

test.each(rejectedManifestCases)("rejects %s manifest evidence with its actionable diagnostic", async (_name, changes, diagnostic) => {
  const { lifecycle } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });
  const manifest = { ...validManifest, ...changes };

  await expect(lifecycle.reportChangeTerminal({ runId: run.runId, status: "completed", summary: "completed", evidence: manifest as never })).rejects.toThrow(diagnostic);
  expect(lifecycle.status(run.runId).status).toBe("running");
});

test("rejects legacy unmapped completion with a migration diagnostic", async () => {
  const { lifecycle } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  await expect(lifecycle.reportChangeTerminal({ runId: run.runId, status: "completed", summary: "legacy", evidence: { e2e: [{ command: "npm run e2e", exitCode: 0, summary: "passed" }] } })).rejects.toThrow("VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED: submit a claim-matched verification manifest");
  expect(lifecycle.status(run.runId).status).toBe("running");
});

test("rejects worker-report-only completion with an independent-verification diagnostic", async () => {
  const { lifecycle } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  await expect(lifecycle.reportChangeTerminal({ runId: run.runId, status: "completed", summary: "worker", evidence: { workerReport: { status: "success" } } as never })).rejects.toThrow("VERIFICATION_WORKER_REPORT_ONLY: Captain must independently verify worker claims");
  expect(lifecycle.status(run.runId).status).toBe("running");
});

test("reports a completed change after successful E2E and notifies once", async () => {
  const { lifecycle, notifications } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  const result = await lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "completed",
    summary: "Implementation and E2E complete",
    verification: validManifest,
  });

  expect(result.run.status).toBe("completed");
  expect(result.delivery).toEqual({ status: "pending" });
  await expect(lifecycle.waitForDelivery(run.runId)).resolves.toEqual({ delivered: true, attempts: 1 });
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({ scope: "change", status: "completed" });
  await expect(lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "failed",
    summary: "late mutation",
  })).rejects.toThrow("Run is already terminal");
});

test("first terminal settlement wins when cancellation races completion", async () => {
  const { lifecycle } = await setup();
  const run = lifecycle.beginDispatch({ changeId: "horsepower-alpha1", projectId: "/project" });

  const outcomes = await Promise.allSettled([
    lifecycle.reportDispatchTerminal({ runId: run.runId, status: "canceled", summary: "Esc" }),
    lifecycle.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: "late completion" }),
  ]);

  expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
  expect(lifecycle.status(run.runId).status).toBe("canceled");
});

test("freshness is evaluated after current acceptance snapshot validation", async () => {
  let current = "2026-07-21T12:00:00.000Z";
  let first = true;
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({
    now: () => {
      if (first) { first = false; return new Date("2026-07-21T11:59:00.000Z"); }
      return new Date(current);
    },
    makeId: (prefix) => `${prefix}-receipt`,
    acceptanceSnapshot: async () => {
      current = "2026-07-21T12:11:01.000Z";
      return { digest: "sha256:current", refs: ["task:1.1"] };
    },
  });
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  await expect(lifecycle.reportChangeTerminal({ runId: run.runId, status: "completed", summary: "too old at receipt", verification: {
    ...validManifest, observedAt: "2026-07-21T12:00:00.000Z",
  } })).rejects.toThrow("VERIFICATION_EVIDENCE_STALE");
  expect(lifecycle.status(run.runId).status).toBe("running");
});

test.each(["canceled", "failed", "completed"] as const)("deferred completion validation cannot overwrite the first committed %s result", async (winningStatus) => {
  let releaseSnapshot!: (snapshot: { digest: string; refs: string[] }) => void;
  let snapshotRequested!: () => void;
  let snapshotCalls = 0;
  const snapshot = new Promise<{ digest: string; refs: string[] }>((resolve) => { releaseSnapshot = resolve; });
  const requested = new Promise<void>((resolve) => { snapshotRequested = resolve; });
  const notifications: TerminalWebhookEvent[] = [];
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({
    now: (() => {
      let first = true;
      return () => {
        if (first) { first = false; return new Date("2026-07-21T11:40:00.000Z"); }
        return new Date("2026-07-21T12:00:00.000Z");
      };
    })(),
    makeId: (prefix) => `${prefix}-atomic`,
    acceptanceSnapshot: () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) {
        snapshotRequested();
        return snapshot;
      }
      return { digest: "sha256:current", refs: ["task:1.1"] };
    },
    notify: async (event) => {
      notifications.push(event);
      return { delivered: true, attempts: 1 };
    },
  });
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  const completion = lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "completed",
    summary: "late validated completion",
    verification: validManifest,
  });
  const completionRejected = expect(completion).rejects.toThrow(`Run is already terminal: ${run.runId}`);
  await requested;

  await expect(lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: winningStatus,
    summary: "first committed result",
    ...(winningStatus === "completed" ? { verification: validManifest } : {}),
  })).resolves.toMatchObject({ run: { status: winningStatus, summary: "first committed result" } });
  await expect(lifecycle.waitForDelivery(run.runId)).resolves.toEqual({ delivered: true, attempts: 1 });
  const committed = lifecycle.status(run.runId);

  releaseSnapshot({ digest: "sha256:current", refs: ["task:1.1"] });
  await completionRejected;

  expect(lifecycle.status(run.runId)).toEqual(committed);
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({ status: winningStatus, summary: "first committed result" });
});

test("redacts and bounds webhook summary evidence without changing terminal status", async () => {
  const { lifecycle, notifications } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  const credentialLabel = ["api", "key"].join("_");
  const tokenLabel = ["to", "ken"].join("");
  const authorizationLabel = ["Author", "ization"].join("");
  const result = await lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "failed",
    summary: `failed {\\"${credentialLabel}\\":\\"super-secret\\"} ${tokenLabel}=other-secret\n${"x".repeat(1_000)}`,
    evidenceRefs: [`${authorizationLabel}: Bearer token-value`, "failure.log#L10"],
  });

  expect(result.run.status).toBe("failed");
  const payload = notifications[0]!;
  expect(payload.summary).toBe("[REDACTED: credential-like content]");
  expect(payload.summary).not.toContain("super-secret");
  expect(payload.summary).not.toContain("other-secret");
  expect(payload.summary).not.toContain("\n");
  expect(payload.summary.length).toBeLessThanOrEqual(500);
  expect(payload.evidenceRefs.join(" ")).not.toContain("token-value");
});

test("notification metadata failure does not reject or partially corrupt terminal reporting", async () => {
  let calls = 0;
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({
    makeId: (prefix) => {
      calls += 1;
      if (prefix === "evt") throw new Error("event id unavailable");
      return `run-${calls}`;
    },
    notify: async () => ({ delivered: true, attempts: 1 }),
  });
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  const reported = await lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "failed",
    summary: "failed",
  });

  expect(reported).toMatchObject({
    run: { status: "failed" },
    delivery: { status: "failed", result: { delivered: false, attempts: 0 } },
  });
  expect(lifecycle.status(run.runId).status).toBe("failed");
});

test("terminal reporting does not wait for webhook delivery", async () => {
  let finish!: (value: WebhookDeliveryResult) => void;
  const delivery = new Promise<WebhookDeliveryResult>((resolve) => { finish = resolve; });
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({
    notify: async () => delivery,
  });
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  const reported = await lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "failed",
    summary: "failed",
  });

  expect(reported).toMatchObject({ run: { status: "failed" }, delivery: { status: "pending" } });
  finish({ delivered: false, attempts: 4, error: "Webhook delivery failed" });
  await expect(lifecycle.waitForDelivery(run.runId)).resolves.toMatchObject({ delivered: false });
});

test("rejects unknown terminal status before mutating lifecycle state", async () => {
  const { lifecycle } = await setup({ change: false });
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1", projectId: "/project" });

  await expect(lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: JSON.parse('"not-a-terminal-status"'),
    summary: "invalid",
  })).rejects.toThrow("Invalid change terminal status");
  expect(lifecycle.status(run.runId).status).toBe("running");
});

test("rejects blocked_needs_human for dispatch scope", async () => {
  const { lifecycle } = await setup({ dispatch: true });
  const run = lifecycle.beginDispatch({ changeId: "horsepower-alpha1", projectId: "/project" });

  await expect(lifecycle.reportDispatchTerminal({
    runId: run.runId,
    status: JSON.parse('"blocked_needs_human"'),
    summary: "invalid",
  })).rejects.toThrow("Dispatch terminal status must be completed, failed, or canceled");
});

test("dispatch notification is opt-in and idle is never terminal", async () => {
  const disabled = await setup({ dispatch: false });
  const first = disabled.lifecycle.beginDispatch({ changeId: "horsepower-alpha1", projectId: "/project", summary: "review" });
  expect(disabled.lifecycle.workerIdle(first.runId)).toBe(false);
  await disabled.lifecycle.reportDispatchTerminal({ runId: first.runId, status: "completed", summary: "done" });
  expect(disabled.notifications).toEqual([]);

  const enabled = await setup({ dispatch: true });
  const second = enabled.lifecycle.beginDispatch({ changeId: "horsepower-alpha1", projectId: "/project", summary: "test" });
  await enabled.lifecycle.reportDispatchTerminal({ runId: second.runId, status: "failed", summary: "failed" });
  expect(enabled.notifications[0]).toMatchObject({ scope: "dispatch", status: "failed" });
});

test("change and dispatch terminal notifications select Discord without changing terminal truth on rejection", async () => {
  const requests: Record<string, unknown>[] = [];
  const { createWebhookNotifier } = await import("../../src/lifecycle/webhook-notifier.js");
  const notifier = createWebhookNotifier({
    config: { [["pro", "vider"].join("")]: "discord", url: "https://example.invalid/protocol-fixture", auth: { mode: "none" } },
    retryDelaysMs: [0],
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response("receiver detail", { status: 400 });
    },
  });
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({
    notifications: { change: true, dispatch: true },
    notify: notifier.notify,
    stopNotifications: notifier.abandon,
    makeId: (() => { let id = 0; return (prefix) => `${prefix}-terminal-truth-fixture-${++id}`; })(),
    now: () => new Date("2026-07-24T00:00:00.000Z"),
  });

  const change = lifecycle.beginChange({ changeId: "change-private-source", projectId: "/project" });
  const dispatch = lifecycle.beginDispatch({ changeId: "change-private-source", projectId: "/project" });
  await lifecycle.reportChangeTerminal({ runId: change.runId, status: "blocked_needs_human", summary: "private report" });
  await lifecycle.reportDispatchTerminal({ runId: dispatch.runId, status: "failed", summary: "private output" });
  await expect(lifecycle.waitForDelivery(change.runId)).resolves.toEqual({ delivered: false, attempts: 1, error: "Webhook delivery failed" });
  await expect(lifecycle.waitForDelivery(dispatch.runId)).resolves.toEqual({ delivered: false, attempts: 1, error: "Webhook delivery failed" });

  expect(lifecycle.status(change.runId)).toMatchObject({ status: "blocked_needs_human", delivery: { delivered: false } });
  expect(lifecycle.status(dispatch.runId)).toMatchObject({ status: "failed", delivery: { delivered: false } });
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request).toMatchObject({ content: expect.any(String), allowed_mentions: { parse: [] } });
    expect(JSON.stringify(request)).not.toContain("private report");
    expect(JSON.stringify(request)).not.toContain("private output");
    expect(JSON.stringify(request)).not.toContain("change-private-source");
  }
});

test("enriched notification context is snapshotted and forwarded once", async () => {
  const received: TerminalWebhookEvent[] = [];
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({ makeId: () => "run-rich", now: () => new Date("2026-07-24T00:00:00.000Z") });
  const context = { campaignId: "campaign-a", taskId: "2.1", taskDescription: "Render Discord embed", agent: "coder", workerId: "worker-a", requestedSlot: "craft", resolvedSlot: "craft", model: "provider/model", thinking: "low", workKind: "implementation", operation: "edit", elapsedMs: 1234 };
  const run = lifecycle.beginDispatch({ changeId: "change-a", projectId: "/project", summary: "safe" }, {
    enabled: true, outputLocale: "en", context, failure: { code: "FAIL", stage: "codec", message: "bounded", remediation: "Inspect status/read", retryable: true }, actionRequired: "Inspect status/read",
    notify: async (event) => { received.push(event); return { delivered: true, attempts: 1 }; },
  });
  context.taskDescription = "mutated after begin";
  await lifecycle.reportDispatchTerminal({ runId: run.runId, status: "failed", summary: "failed" });
  await lifecycle.waitForDelivery(run.runId);
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ context: { campaignId: "campaign-a", taskId: "2.1", taskDescription: "Render Discord embed", agent: "coder", workerId: "worker-a", model: "provider/model" }, failure: { code: "FAIL", stage: "codec" }, actionRequired: "Inspect status/read" });
});

test("shutdown stops notification retries and waits for pending deliveries", async () => {
  let finish!: () => void;
  const pending = new Promise<WebhookDeliveryResult>((resolve) => {
    finish = () => resolve({ delivered: false, attempts: 1, error: "abandoned" });
  });
  const stopNotifications = vi.fn(() => finish());
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({
    notifications: { dispatch: true },
    notify: async () => pending,
    stopNotifications,
  });
  const run = lifecycle.beginDispatch({ changeId: "change-a", projectId: "/project" });
  await lifecycle.reportDispatchTerminal({ runId: run.runId, status: "failed", summary: "failed" });

  await lifecycle.shutdown();

  expect(stopNotifications).toHaveBeenCalledTimes(1);
  await expect(lifecycle.waitForDelivery(run.runId)).resolves.toMatchObject({ delivered: false });
});

test("shutdown seals lifecycle admission and cannot miss a concurrently registered delivery", async () => {
  let finish!: () => void;
  const pending = new Promise<WebhookDeliveryResult>((resolve) => {
    finish = () => resolve({ delivered: false, attempts: 1, error: "abandoned" });
  });
  const notify = vi.fn(async () => pending);
  const stopNotifications = vi.fn(() => finish());
  const { createRunLifecycle } = await import("../../src/lifecycle/run-lifecycle.js");
  const lifecycle = createRunLifecycle({
    notifications: { change: true },
    notify,
    stopNotifications,
  });
  const run = lifecycle.beginChange({ changeId: "change-a", projectId: "/project" });

  const reporting = lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "failed",
    summary: "failed",
  });
  const firstShutdown = lifecycle.shutdown();
  const secondShutdown = lifecycle.shutdown();

  await Promise.all([reporting, firstShutdown, secondShutdown]);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(stopNotifications).toHaveBeenCalledTimes(1);
  await expect(lifecycle.waitForDelivery(run.runId)).resolves.toMatchObject({ delivered: false });
  expect(() => lifecycle.beginChange({ changeId: "late", projectId: "/project" })).toThrow("Run lifecycle is closed");
  await expect(lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "failed",
    summary: "late",
  })).rejects.toThrow("Run lifecycle is closed");
});
