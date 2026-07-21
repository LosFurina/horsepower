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
      now: () => new Date("2026-07-20T00:00:00.000Z"),
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
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1" });

  expect(notifications).toEqual([]);
  await expect(lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "completed",
    summary: "Unit tests passed",
    evidence: { unit: [{ command: "npm test", exitCode: 0, summary: "passed" }] },
  })).rejects.toThrow("Completion requires Captain-selected successful E2E evidence");
  expect(lifecycle.status(run.runId).status).toBe("running");
  expect(notifications).toEqual([]);
});

test("reports a completed change after successful E2E and notifies once", async () => {
  const { lifecycle, notifications } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1" });

  const result = await lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "completed",
    summary: "Implementation and E2E complete",
    evidence: { e2e: [{ command: "npm run e2e", exitCode: 0, summary: "passed" }] },
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

test("redacts and bounds webhook summary evidence without changing terminal status", async () => {
  const { lifecycle, notifications } = await setup();
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1" });

  const result = await lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: "failed",
    summary: `failed {\\"api_key\\":\\"super-secret\\"} token=other-secret\n${"x".repeat(1_000)}`,
    evidenceRefs: ["Authorization: Bearer token-value", "failure.log#L10"],
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
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1" });

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
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1" });

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
  const run = lifecycle.beginChange({ changeId: "horsepower-alpha1" });

  await expect(lifecycle.reportChangeTerminal({
    runId: run.runId,
    status: JSON.parse('"not-a-terminal-status"'),
    summary: "invalid",
  })).rejects.toThrow("Invalid change terminal status");
  expect(lifecycle.status(run.runId).status).toBe("running");
});

test("rejects blocked_needs_human for dispatch scope", async () => {
  const { lifecycle } = await setup({ dispatch: true });
  const run = lifecycle.beginDispatch({ changeId: "horsepower-alpha1" });

  await expect(lifecycle.reportDispatchTerminal({
    runId: run.runId,
    status: JSON.parse('"blocked_needs_human"'),
    summary: "invalid",
  })).rejects.toThrow("Dispatch terminal status must be completed, failed, or canceled");
});

test("dispatch notification is opt-in and idle is never terminal", async () => {
  const disabled = await setup({ dispatch: false });
  const first = disabled.lifecycle.beginDispatch({ changeId: "horsepower-alpha1", summary: "review" });
  expect(disabled.lifecycle.workerIdle(first.runId)).toBe(false);
  await disabled.lifecycle.reportDispatchTerminal({ runId: first.runId, status: "completed", summary: "done" });
  expect(disabled.notifications).toEqual([]);

  const enabled = await setup({ dispatch: true });
  const second = enabled.lifecycle.beginDispatch({ changeId: "horsepower-alpha1", summary: "test" });
  await enabled.lifecycle.reportDispatchTerminal({ runId: second.runId, status: "failed", summary: "failed" });
  expect(enabled.notifications[0]).toMatchObject({ scope: "dispatch", status: "failed" });
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
  const run = lifecycle.beginDispatch({ changeId: "change-a" });
  await lifecycle.reportDispatchTerminal({ runId: run.runId, status: "failed", summary: "failed" });

  await lifecycle.shutdown();

  expect(stopNotifications).toHaveBeenCalledTimes(1);
  await expect(lifecycle.waitForDelivery(run.runId)).resolves.toMatchObject({ delivered: false });
});
