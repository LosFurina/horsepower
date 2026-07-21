import { Check, Errors } from "typebox/value";
import type { AgentDefinition } from "../agents/catalog.js";
import type { ChangeTerminalReport, DispatchTerminalReport } from "../lifecycle/run-lifecycle.js";
import type { CompletionEvidence, E2EWaiver } from "../lifecycle/verification-gate.js";
import type { ReviewCampaign, ReviewCampaignOutcome, ReviewFindingScope } from "../lifecycle/review-campaign.js";
import type { OneShotExecutor, OneShotInvocation } from "../runtime/one-shot.js";
import type { ResolvedSlot } from "../slots/registry.js";
import { horsepowerActionSchemas, horsepowerSubagentSchema } from "./schema.js";

interface CreateWorkerInput {
  name: string;
  agent: string;
  modelSlot: string;
  model: string;
  thinking: ResolvedSlot["thinking"];
  cwd: string;
  prompt: string;
  tools: readonly string[];
  handoffMode: "managed" | "inline";
  handoffRunId?: string;
  initialMessage?: string;
}

export interface OrchestrationOptions {
  authorize(input: { action: string; changeId?: string; cwd: string }): Promise<unknown>;
  assertOpen?: () => void;
  resolveSlot(slot: string): ResolvedSlot;
  validateModel(slot: ResolvedSlot): void;
  getAgent(name: string): AgentDefinition | Omit<AgentDefinition, "source" | "scope">;
  createWorker(input: CreateWorkerInput): Promise<{ workerId: string; activeMessageId?: string }>;
  beginChange?: (input: { changeId: string; projectId: string }) => { runId: string };
  beginDispatch(input: { changeId: string; projectId: string; summary: string }): { runId: string };
  oneShot?: OneShotExecutor;
  sendWorker?: (input: Record<string, unknown>) => Promise<unknown>;
  waitForMessage?: (workerId: string, messageId: string) => Promise<unknown>;
  messageStatus?: (workerId: string, messageId: string) => "completed" | "failed" | "canceled";
  statusWorker?: (workerId: string) => unknown;
  associateHandoff?: (workerId: string, runId: string) => void;
  listWorkers?: () => unknown;
  readWorker?: (workerId: string, options: Record<string, unknown>) => unknown;
  abortWorker?: (workerId: string) => Promise<unknown>;
  destroyWorker?: (workerId: string, force?: boolean) => Promise<unknown>;
  doctor?: () => Promise<unknown> | unknown;
  reportDispatchTerminal: (report: DispatchTerminalReport) => Promise<unknown>;
  reportChangeTerminal?: (report: ChangeTerminalReport) => Promise<unknown>;
  identityForRun?: (runId: string) => { changeId: string; projectId: string };
  projectId?: string;
  trackSettlement?: (settlement: Promise<unknown>) => void;
  createHandoff?: (input: { projectPath: string; runId: string; brief: string; producer: { kind: "captain"; id: string } }) => Promise<{ worker: { briefPath: string; reportPath: string }; reference: unknown }>;
  prepareHandoffMessage?: (input: { projectPath: string; runId: string; brief: string; producer: { kind: "captain"; id: string } }) => Promise<{ worker: { briefPath: string; reportPath: string }; reportRevision: number }>;
  validateHandoffReport?: (input: { projectPath: string; runId: string; producer: { kind: "worker"; id: string }; expectedRevision?: number }) => Promise<unknown>;
  recordHandoffTerminal?: (input: { projectPath: string; runId: string; status: "failed" | "canceled"; producer?: { kind: "worker"; id: string } }) => Promise<unknown>;
  beginReviewCampaign?: (input: { changeId: string; projectId: string; acceptanceScope: string; budget: number }) => ReviewCampaign;
  consumeReviewCampaign?: (input: { campaignId: string; changeId: string; projectId: string; dispatchSummary: string }) => ReviewCampaign;
  recordReviewFinding?: (input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string; summary: string; scope: ReviewFindingScope; evidenceRef?: string }) => ReviewCampaign;
  extendReviewCampaign?: (input: { campaignId: string; changeId: string; projectId: string; additionalBudget: number; humanAuthorized: boolean; reason: string }) => ReviewCampaign;
  endReviewCampaign?: (input: { campaignId: string; changeId: string; projectId: string; outcome: ReviewCampaignOutcome; summary: string }) => ReviewCampaign;
  reviewCampaignStatus?: (campaignId: string, projectId: string) => ReviewCampaign;
}

function required(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`$.${field}: required`);
  return value;
}

function validate(input: unknown): asserts input is Record<string, unknown> {
  const action = input !== null && typeof input === "object" && typeof (input as { action?: unknown }).action === "string"
    ? (input as { action: string }).action
    : undefined;
  if (action && !(action in horsepowerActionSchemas)) {
    throw new Error(`$.action: unsupported action ${action}`);
  }
  const schema = action
    ? horsepowerActionSchemas[action as keyof typeof horsepowerActionSchemas]
    : horsepowerSubagentSchema;
  if (Check(schema, input)) return;
  const first = Errors(schema, input)[0];
  const instancePath = first && "instancePath" in first && typeof first.instancePath === "string"
    ? first.instancePath
    : "";
  const path = instancePath ? `$${instancePath.replace(/\/(\d+|[^/]+)/gu, (_, part: string) => /^\d+$/u.test(part) ? `[${part}]` : `.${part}`)}` : "$";
  const requiredProperties = first && "params" in first &&
    typeof first.params === "object" && first.params !== null &&
    "requiredProperties" in first.params && Array.isArray(first.params.requiredProperties)
    ? first.params.requiredProperties as string[]
    : undefined;
  if (requiredProperties?.length) throw new Error(`${path}.${requiredProperties[0]}: required`);
  throw new Error(`${path}: ${first?.message ?? "invalid input"}`);
}

function preflight(action: string, input: Record<string, unknown>): void {
  if (["single", "parallel", "chain", "create", "send"].includes(action)) required(input, "handoffMode");
  if ((action === "parallel" || action === "chain") && input.handoffMode !== "managed") {
    throw new Error(`${action} requires managed handoff mode`);
  }
  if (action === "create") {
    for (const field of ["changeId", "cwd", "name", "agent", "modelSlot"]) required(input, field);
    if (input.handoffMode === "managed") {
      const brief = input.brief;
      if (typeof brief !== "string" || !brief.trim()) throw new Error("$.brief: required for managed create");
    }
  } else if (action === "single") {
    for (const field of ["changeId", "cwd", "name", "agent", "modelSlot", "task"]) required(input, field);
  } else if (action === "parallel" || action === "chain") {
    for (const field of ["changeId", "cwd"]) required(input, field);
    if (!Array.isArray(input.tasks) || input.tasks.length === 0) throw new Error("$.tasks: required");
  } else if (action === "send" || action === "steer") {
    for (const field of ["changeId", "cwd", "workerId", "message"]) required(input, field);
  } else if (action === "begin_change") {
    for (const field of ["changeId", "cwd"]) required(input, field);
  } else if (action === "report_terminal") {
    for (const field of ["changeId", "cwd", "runId", "status", "summary"]) required(input, field);
  } else if (action === "begin_review_campaign") {
    for (const field of ["changeId", "cwd", "acceptanceScope"]) required(input, field);
  } else if (["record_review_finding", "extend_review_campaign", "end_review_campaign"].includes(action)) {
    for (const field of ["changeId", "cwd", "campaignId"]) required(input, field);
  } else if (action === "review_campaign_status") {
    for (const field of ["cwd", "campaignId"]) required(input, field);
  } else if (["status", "read", "abort", "destroy"].includes(action)) {
    required(input, "cwd");
    required(input, "workerId");
  } else if (action === "list" || action === "doctor") {
    required(input, "cwd");
  }
}

function dependency<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Orchestration dependency is unavailable: ${name}`);
  return value;
}

export function createOrchestration(options: OrchestrationOptions) {
  function invocation(
    input: { name: string; agent: string; modelSlot: string; task: string },
    cwd: string,
  ): { invocation: OneShotInvocation; slot: ResolvedSlot } {
    const slot = options.resolveSlot(input.modelSlot);
    options.validateModel(slot);
    const agent = options.getAgent(input.agent);
    return {
      slot,
      invocation: {
        name: input.name,
        agent: input.agent,
        modelSlot: input.modelSlot,
        model: slot.model,
        thinking: slot.thinking,
        cwd,
        prompt: agent.prompt,
        tools: agent.tools,
        task: input.task,
      },
    };
  }

  async function oneShot(
    action: "single" | "parallel" | "chain",
    input: Record<string, unknown>,
    changeId: string,
    cwd: string,
  ) {
    const rawTasks = action === "single"
      ? [{
          name: required(input, "name"),
          agent: required(input, "agent"),
          modelSlot: required(input, "modelSlot"),
          task: required(input, "task"),
        }]
      : (() => {
          if (!Array.isArray(input.tasks) || input.tasks.length === 0) throw new Error("$.tasks: required");
          return input.tasks as Array<{ name: string; agent: string; modelSlot: string; task: string }>;
        })();
    const resolved = rawTasks.map((task) => invocation(task, cwd));
    let invocations = resolved.map((item) => item.invocation);
    const slots = resolved.map((item) => item.slot);
    const executor = dependency(options.oneShot, "oneShot");
    const run = options.beginDispatch({ changeId, projectId: options.projectId ?? cwd, summary: `${action} ${invocations.length}` });
    const managed = input.handoffMode === "managed";
    const handoffRunIds = invocations.map((_, index) => invocations.length === 1 ? run.runId : `${run.runId}-${index + 1}`);
    try {
      if (managed) {
        const createHandoff = dependency(options.createHandoff, "createHandoff");
        invocations = await Promise.all(invocations.map(async (item, index) => {
          const workspace = await createHandoff({ projectPath: options.projectId ?? cwd, runId: handoffRunIds[index]!, brief: item.task, producer: { kind: "captain", id: "captain" } });
          const previous = action === "chain" && item.task.includes("{previous}") ? " The prior step output is: {previous}." : "";
          return { ...item, task: `Read your assigned brief at ${workspace.worker.briefPath}.${previous} Complete only that brief. Write your final report to ${workspace.worker.reportPath}. Do not include the full report in model output.` };
        }));
      }
      const result = action === "single"
        ? await executor.single(invocations[0]!)
        : action === "parallel"
          ? await executor.parallel(invocations)
          : await executor.chain(invocations);
      const evidenceRefs = managed ? await Promise.all(handoffRunIds.map((runId, index) => dependency(options.validateHandoffReport, "validateHandoffReport")({ projectPath: options.projectId ?? cwd, runId, producer: { kind: "worker", id: invocations[index]!.name } }))) : [];
      await options.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: `${action} completed`, ...(evidenceRefs.length ? { evidenceRefs: evidenceRefs.map((item) => JSON.stringify(item)) } : {}) });
      return { runId: run.runId, result: managed ? undefined : result, slots, ...(evidenceRefs.length ? { handoffs: evidenceRefs } : {}) };
    } catch (cause) {
      if (managed && options.recordHandoffTerminal) await Promise.allSettled(handoffRunIds.map((runId) => options.recordHandoffTerminal!({ projectPath: options.projectId ?? cwd, runId, status: "failed" })));
      await options.reportDispatchTerminal({ runId: run.runId, status: "failed", summary: `${action} failed` });
      throw cause;
    }
  }

  return {
    async execute(rawInput: unknown, caller: { captain: boolean }): Promise<unknown> {
      validate(rawInput);
      const action = required(rawInput, "action");
      preflight(action, rawInput);
      const cwd = required(rawInput, "cwd");
      const safe = new Set(["status", "list", "read", "abort", "destroy", "doctor", "review_campaign_status"]);
      if (!safe.has(action) && !caller.captain) throw new Error(`Captain capability is required for ${action}`);
      const changeId = safe.has(action) ? undefined : required(rawInput, "changeId");
      await options.authorize({ action, ...(changeId === undefined ? {} : { changeId }), cwd });
      options.assertOpen?.();

      if (action === "list") return dependency(options.listWorkers, "listWorkers")();
      if (action === "status") return dependency(options.statusWorker, "statusWorker")(required(rawInput, "workerId"));
      if (action === "read") return dependency(options.readWorker, "readWorker")(
        required(rawInput, "workerId"),
        {
          ...(rawInput.afterCursor === undefined ? {} : { afterCursor: rawInput.afterCursor }),
          ...(rawInput.includeDetails === undefined ? {} : { includeDetails: rawInput.includeDetails }),
          ...(rawInput.limit === undefined ? {} : { limit: rawInput.limit }),
        },
      );
      if (action === "abort") return dependency(options.abortWorker, "abortWorker")(required(rawInput, "workerId"));
      if (action === "destroy") return dependency(options.destroyWorker, "destroyWorker")(
        required(rawInput, "workerId"),
        rawInput.force === true,
      );
      if (action === "doctor") return dependency(options.doctor, "doctor")();
      if (action === "review_campaign_status") return dependency(options.reviewCampaignStatus, "reviewCampaignStatus")(required(rawInput, "campaignId"), options.projectId ?? cwd);

      if (action === "begin_review_campaign") {
        return dependency(options.beginReviewCampaign, "beginReviewCampaign")({
          changeId: changeId!, projectId: options.projectId ?? cwd,
          acceptanceScope: required(rawInput, "acceptanceScope"), budget: rawInput.budget as number,
        });
      }
      if (action === "record_review_finding") {
        return dependency(options.recordReviewFinding, "recordReviewFinding")({
          campaignId: required(rawInput, "campaignId"), changeId: changeId!, projectId: options.projectId ?? cwd,
          rootCauseId: required(rawInput, "rootCauseId"),
          summary: required(rawInput, "summary"), scope: required(rawInput, "scope") as ReviewFindingScope,
          ...(rawInput.evidenceRef === undefined ? {} : { evidenceRef: required(rawInput, "evidenceRef") }),
        });
      }
      if (action === "extend_review_campaign") {
        return dependency(options.extendReviewCampaign, "extendReviewCampaign")({
          campaignId: required(rawInput, "campaignId"), changeId: changeId!, projectId: options.projectId ?? cwd,
          additionalBudget: rawInput.additionalBudget as number,
          humanAuthorized: rawInput.humanAuthorized === true, reason: required(rawInput, "reason"),
        });
      }
      if (action === "end_review_campaign") {
        return dependency(options.endReviewCampaign, "endReviewCampaign")({
          campaignId: required(rawInput, "campaignId"), changeId: changeId!, projectId: options.projectId ?? cwd,
          outcome: required(rawInput, "outcome") as ReviewCampaignOutcome,
          summary: required(rawInput, "summary"),
        });
      }

      const reviewCampaignId = typeof rawInput.reviewCampaignId === "string" ? rawInput.reviewCampaignId : undefined;
      if (reviewCampaignId) {
        dependency(options.consumeReviewCampaign, "consumeReviewCampaign")({
          campaignId: reviewCampaignId, changeId: changeId!, projectId: options.projectId ?? cwd,
          dispatchSummary: `${action} ${typeof rawInput.name === "string" ? rawInput.name : typeof rawInput.workerId === "string" ? rawInput.workerId : "work"}`,
        });
      }

      if (action === "begin_change") {
        return dependency(options.beginChange, "beginChange")({ changeId: changeId!, projectId: options.projectId ?? cwd });
      }

      if (action === "report_terminal") {
        const report = dependency(options.reportChangeTerminal, "reportChangeTerminal");
        const runId = required(rawInput, "runId");
        const identity = dependency(options.identityForRun, "identityForRun")(runId);
        if (identity.projectId !== (options.projectId ?? cwd)) {
          throw new Error(`Run ${runId} belongs to another project`);
        }
        if (identity.changeId !== changeId) {
          throw new Error(`Run ${runId} belongs to change ${identity.changeId}, not ${changeId}`);
        }
        const evidence: CompletionEvidence = {
          ...(rawInput.e2e === undefined ? {} : { e2e: rawInput.e2e as CompletionEvidence["e2e"] & readonly unknown[] }),
          ...(rawInput.e2eWaiver === undefined ? {} : { e2eWaiver: rawInput.e2eWaiver as E2EWaiver }),
        };
        return report({
          runId,
          status: required(rawInput, "status") as ChangeTerminalReport["status"],
          summary: required(rawInput, "summary"),
          evidence,
          ...(rawInput.evidenceRefs === undefined ? {} : { evidenceRefs: rawInput.evidenceRefs as string[] }),
        });
      }

      if (action === "single" || action === "parallel" || action === "chain") {
        return oneShot(action, rawInput, changeId!, cwd);
      }

      if (action === "create") {
        const name = required(rawInput, "name");
        const agentName = required(rawInput, "agent");
        const modelSlot = required(rawInput, "modelSlot");
        const slot = options.resolveSlot(modelSlot);
        options.validateModel(slot);
        const agent = options.getAgent(agentName);
        const run = options.beginDispatch({ changeId: changeId!, projectId: options.projectId ?? cwd, summary: `create ${name}` });
        try {
          const handoffMode = required(rawInput, "handoffMode") as "managed" | "inline";
          let handoff: Awaited<ReturnType<NonNullable<OrchestrationOptions["createHandoff"]>>> | undefined;
          if (handoffMode === "managed") {
            if (typeof rawInput.brief !== "string" || !rawInput.brief.trim()) throw new Error("$.brief: required for managed create");
            handoff = await dependency(options.createHandoff, "createHandoff")({ projectPath: options.projectId ?? cwd, runId: run.runId, brief: rawInput.brief, producer: { kind: "captain", id: "captain" } });
          }
          const worker = await options.createWorker({
            name,
            agent: agentName,
            modelSlot,
            model: slot.model,
            thinking: slot.thinking,
            cwd,
            prompt: handoff ? `${agent.prompt}\n\nManaged handoff: read ${handoff.worker.briefPath} and write reports to ${handoff.worker.reportPath}.` : agent.prompt,
            tools: agent.tools,
            handoffMode,
            ...(handoff ? { handoffRunId: run.runId, initialMessage: `Read your assigned brief at ${handoff.worker.briefPath}. Write the completed report to ${handoff.worker.reportPath}.` } : {}),
          });
          let evidence: unknown;
          if (handoff) {
            const messageId = typeof (worker as { activeMessageId?: unknown }).activeMessageId === "string" ? (worker as { activeMessageId: string }).activeMessageId : undefined;
            if (!messageId) throw new Error("Managed persistent create did not start its initial message");
            await dependency(options.waitForMessage, "waitForMessage")((worker as { workerId: string }).workerId, messageId);
            evidence = await dependency(options.validateHandoffReport, "validateHandoffReport")({ projectPath: options.projectId ?? cwd, runId: run.runId, producer: { kind: "worker", id: (worker as { workerId: string }).workerId } });
          }
          await options.reportDispatchTerminal({
            runId: run.runId,
            status: "completed",
            summary: "create completed",
            ...(evidence ? { evidenceRefs: [JSON.stringify(evidence)] } : {}),
          });
          return { ...worker, runId: run.runId, slot, ...(handoff ? { handoff: evidence ?? handoff.reference } : {}) };
        } catch (cause) {
          if (rawInput.handoffMode === "managed" && options.recordHandoffTerminal) await options.recordHandoffTerminal({ projectPath: options.projectId ?? cwd, runId: run.runId, status: "failed" }).catch(() => undefined);
          await options.reportDispatchTerminal({
            runId: run.runId,
            status: "failed",
            summary: "create failed",
          });
          throw cause;
        }
      }

      if (action === "send" || action === "steer") {
        const workerId = required(rawInput, "workerId");
        const message = required(rawInput, "message");
        const handoffMode = action === "send" ? required(rawInput, "handoffMode") as "managed" | "inline" : "inline";
        const sendWorker = dependency(options.sendWorker, "sendWorker");
        const waitForMessage = dependency(options.waitForMessage, "waitForMessage");
        const messageStatus = dependency(options.messageStatus, "messageStatus");
        const run = options.beginDispatch({ changeId: changeId!, projectId: options.projectId ?? cwd, summary: `${action} ${workerId}` });
        const managed = action === "send" && handoffMode === "managed";
        let handoffRunId: string | undefined;
        let reportRevision: number | undefined;
        let dispatchMessage = message;
        let immediate: unknown;
        try {
          if (managed) {
            if (rawInput.delivery === "followUp") {
              const worker = dependency(options.statusWorker, "statusWorker")(workerId) as { handoffMode?: unknown; handoffRunId?: unknown };
              if (worker.handoffMode !== "managed" || typeof worker.handoffRunId !== "string") throw new Error(`Persistent worker ${workerId} has no managed handoff association`);
              handoffRunId = worker.handoffRunId;
              const workspace = await dependency(options.prepareHandoffMessage, "prepareHandoffMessage")({ projectPath: options.projectId ?? cwd, runId: handoffRunId, brief: message, producer: { kind: "captain", id: "captain" } });
              reportRevision = workspace.reportRevision;
              dispatchMessage = `Read your assigned brief at ${workspace.worker.briefPath}. Write the completed report to ${workspace.worker.reportPath}.`;
            } else {
              handoffRunId = run.runId;
              const workspace = await dependency(options.createHandoff, "createHandoff")({ projectPath: options.projectId ?? cwd, runId: handoffRunId, brief: message, producer: { kind: "captain", id: "captain" } });
              options.associateHandoff?.(workerId, handoffRunId);
              dispatchMessage = `Read your assigned brief at ${workspace.worker.briefPath}. Write the completed report to ${workspace.worker.reportPath}.`;
            }
          }
          immediate = await sendWorker({
            workerId,
            message: dispatchMessage,
            delivery: action === "steer" ? "steer" : rawInput.delivery ?? "reject",
            wait: false,
            ...(rawInput.timeoutMs === undefined ? {} : { timeoutMs: rawInput.timeoutMs }),
          });
        } catch (cause) {
          if (managed && handoffRunId && options.recordHandoffTerminal) await options.recordHandoffTerminal({ projectPath: options.projectId ?? cwd, runId: handoffRunId, status: "failed" }).catch(() => undefined);
          await options.reportDispatchTerminal({ runId: run.runId, status: "failed", summary: `${action} failed` });
          throw cause;
        }
        const messageId = immediate !== null && typeof immediate === "object" &&
          typeof (immediate as { messageId?: unknown }).messageId === "string"
          ? (immediate as { messageId: string }).messageId
          : undefined;
        if (!messageId) {
          await options.reportDispatchTerminal({ runId: run.runId, status: "failed", summary: `${action} failed` });
          throw new Error(`${action} did not return a messageId`);
        }
        const settle = async () => {
          try {
            const completed = await waitForMessage(workerId, messageId);
            const evidence = managed && handoffRunId ? await dependency(options.validateHandoffReport, "validateHandoffReport")({ projectPath: options.projectId ?? cwd, runId: handoffRunId, producer: { kind: "worker", id: workerId }, ...(reportRevision === undefined ? {} : { expectedRevision: reportRevision }) }) : undefined;
            await options.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: `${action} completed`, ...(evidence ? { evidenceRefs: [JSON.stringify(evidence)] } : {}) });
            return evidence ? { handoff: evidence } : completed;
          } catch (cause) {
            const status = messageStatus(workerId, messageId);
            if (managed && handoffRunId && options.recordHandoffTerminal) await options.recordHandoffTerminal({ projectPath: options.projectId ?? cwd, runId: handoffRunId, status: status === "canceled" ? "canceled" : "failed", producer: { kind: "worker", id: workerId } }).catch(() => undefined);
            await options.reportDispatchTerminal({
              runId: run.runId,
              status: status === "canceled" ? "canceled" : "failed",
              summary: status === "canceled" ? `${action} canceled` : `${action} failed`,
            });
            throw cause;
          }
        };
        const settlement = settle();
        options.trackSettlement?.(settlement);
        if (rawInput.wait === true) {
          if (typeof rawInput.timeoutMs === "number") {
            let timeout: NodeJS.Timeout | undefined;
            const waited = await Promise.race([
              settlement.then((result) => ({ result })),
              new Promise<{ timedOut: true }>((resolve) => {
                timeout = setTimeout(() => resolve({ timedOut: true }), rawInput.timeoutMs as number);
              }),
            ]).finally(() => {
              if (timeout) clearTimeout(timeout);
            });
            if ("timedOut" in waited) {
              void settlement.catch(() => undefined);
              return { runId: run.runId, result: managed ? { messageId } : immediate, timedOut: true };
            }
            return { runId: run.runId, result: waited.result };
          }
          return { runId: run.runId, result: await settlement };
        }
        void settlement.catch(() => undefined);
        return { runId: run.runId, result: managed ? { messageId } : immediate };
      }

      throw new Error(`Unsupported orchestration action: ${action}`);
    },
  };
}
