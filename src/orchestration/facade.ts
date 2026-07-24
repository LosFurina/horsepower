import { Check, Errors } from "typebox/value";
import type { AgentDefinition } from "../agents/catalog.js";
import type { ChangeTerminalReport, DispatchTerminalReport } from "../lifecycle/run-lifecycle.js";
import type { VerificationManifest } from "../lifecycle/verification-gate.js";
import type { ReviewCampaign, ReviewCampaignOutcome, ReviewFindingDisposition, ReviewFindingScope } from "../lifecycle/review-campaign.js";
import { OneShotBatchError, type OneShotExecutor, type OneShotInvocation, type OneShotProgress, type WorkerIdentity } from "../runtime/one-shot.js";
import type { ResolvedSlot } from "../slots/registry.js";
import { horsepowerActionSchemas, horsepowerSubagentSchema } from "./schema.js";
import { projectFailure, projectComposite, type CaptainFailure, type CompositeOutcome } from "../failures/captain-failure.js";

interface CreateWorkerInput {
  name: string;
  agent: string;
  role?: string;
  modelSlot: string;
  resolvedSlot?: string;
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
  validateCapability?: (slot: ResolvedSlot) => Promise<void>;
  handleWorkerCapabilityRejection?: (slot: Pick<ResolvedSlot, "model" | "thinking">, cause: unknown) => Error | undefined;
  getAgent(name: string): AgentDefinition | Omit<AgentDefinition, "source" | "scope">;
  createWorker(input: CreateWorkerInput): Promise<{ workerId: string; activeMessageId?: string; initialMessageId?: string; telemetry?: OneShotProgress["telemetry"] }>;
  beginChange?: (input: { changeId: string; projectId: string }) => { runId: string };
  beginDispatch(input: { changeId: string; projectId: string; summary: string }): { runId: string };
  oneShot?: OneShotExecutor;
  signal?: AbortSignal;
  onProgress?: (event: OneShotProgress & { identity: WorkerIdentity }) => void;
  sendWorker?: (input: Record<string, unknown>) => Promise<unknown>;
  waitForMessage?: (workerId: string, messageId: string) => Promise<unknown>;
  messageStatus?: (workerId: string, messageId: string) => "accepted" | "queued" | "running" | "completed" | "failed" | "canceled";
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
  beginReviewCampaign?: (input: { changeId: string; projectId: string; acceptanceScope: string; budget: number; implementationCampaignId: string; taskScope: string }) => ReviewCampaign;
  consumeReviewCampaign?: (input: { campaignId: string; changeId: string; projectId: string; dispatchSummary: string; kind?: "review" | "fix"; rootCauseId?: string }) => ReviewCampaign;
  recordReviewFinding?: (input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string; summary: string; scope: ReviewFindingScope; evidenceRef?: string; materiallyConflictsDisposition?: boolean }) => ReviewCampaign;
  dispositionReviewFinding?: (input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string; disposition: Exclude<ReviewFindingDisposition, "pending">; rationale: string; evidenceRef?: string }) => ReviewCampaign;
  resolveReviewFinding?: (input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string; verification: VerificationManifest }) => ReviewCampaign;
  extendReviewCampaign?: (input: { campaignId: string; changeId: string; projectId: string; additionalBudget: number; humanAuthorized: boolean; reason: string }) => ReviewCampaign;
  endReviewCampaign?: (input: { campaignId: string; changeId: string; projectId: string; outcome: ReviewCampaignOutcome; summary: string }) => ReviewCampaign;
  reviewCampaignStatus?: (campaignId: string, projectId: string) => ReviewCampaign;
}

function required(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error(`$.${field}: required`);
    Object.assign(error, { horsepowerFailure: projectFailure({ code: "INPUT_REQUIRED", boundary: "orchestration", stage: "validation", path: `$.${field}`, message: "Required field is missing.", remediation: "Provide the field and retry the dispatch." }) });
    throw error;
  }
  return value;
}

function validate(input: unknown): asserts input is Record<string, unknown> {
  if (input !== null && typeof input === "object") {
    const raw = input as Record<string, unknown>;
    if (raw.action === "report_terminal" && raw.status === "completed" && ("e2e" in raw || "e2eWaiver" in raw)) {
      throw new Error("VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED: replace bare e2e/e2eWaiver with verification: { observedAt, commands, acceptance, e2eWaiver? }");
    }
  }
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
    for (const field of ["changeId", "cwd", "implementationCampaignId", "taskScope", "acceptanceScope"]) required(input, field);
  } else if (["record_review_finding", "disposition_review_finding", "resolve_review_finding", "extend_review_campaign", "end_review_campaign"].includes(action)) {
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

function progressSummary(value: string): string {
  const sensitiveLabels = [["api", "key"].join("[_-]?"), "to" + "ken", "sec" + "ret", "pass" + "word", "coo" + "kie", "author" + "ization", "bear" + "er"];
  if (new RegExp(`(?:${sensitiveLabels.join("|")})(?:\\s|[:=])`, "iu").test(value)) return "[REDACTED]";
  const compact = value.replace(/\/[\w./-]*\.pi\/agent\/horsepower\/state\/handoffs\/[^\s]+/gu, "[private-path]").replace(/[\r\n\t]+/gu, " ").trim();
  return Buffer.from(compact, "utf8").subarray(0, 500).toString("utf8");
}

function cancellationError(phase: "preflight" | "during_run"): Error {
  return Object.assign(new Error(phase === "preflight" ? "Dispatch canceled before authorization" : "Dispatch canceled during worker execution"), {
    code: "DISPATCH_CANCELED",
    horsepowerFailure: {
      code: "DISPATCH_CANCELED", boundary: "cancellation",
      remediation: "Start a new Captain turn and retry the explicit dispatch.",
    },
  });
}

function failureEvidence(cause: unknown, stage: string) {
  const message = cause instanceof Error ? cause.message : String(cause);
  const typed = cause !== null && typeof cause === "object" && "horsepowerFailure" in cause
    ? (cause as { horsepowerFailure?: unknown }).horsepowerFailure
    : undefined;
  const metadata = typed !== null && typeof typed === "object" ? typed as Record<string, unknown> : undefined;
  const direct = cause !== null && typeof cause === "object" ? cause as Record<string, unknown> : undefined;
  const code = typeof metadata?.code === "string" ? metadata.code : typeof direct?.code === "string" ? direct.code : undefined;
  const boundary = typeof metadata?.boundary === "string" ? metadata.boundary : undefined;
  const remediation = typeof metadata?.remediation === "string" ? metadata.remediation : undefined;
  return projectFailure({ code: code ?? "DISPATCH_FAILED", boundary: boundary ?? "orchestration", stage, message, remediation: remediation ?? "Inspect the reported stage and retry after resolving the cause." });
}

export function createOrchestration(options: OrchestrationOptions) {
  async function validateCapabilities(slots: readonly ResolvedSlot[]): Promise<void> {
    if (!options.validateCapability) return;
    for (const slot of slots) await options.validateCapability(slot);
  }

  function workerRejection(slot: Pick<ResolvedSlot, "model" | "thinking">, cause: unknown): Error | undefined {
    return options.handleWorkerCapabilityRejection?.(slot, cause);
  }

  async function observeMessage(workerId: string, messageId: string): Promise<void> {
    const status = dependency(options.messageStatus, "messageStatus");
    while (true) {
      const current = status(workerId, messageId);
      if (current === "completed") return;
      if (current === "failed" || current === "canceled") throw new Error(`Persistent worker message ${current}`);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
  }

  async function finalizeDispatchFailure(input: {
    action: string;
    runId: string;
    stage: string;
    cause: unknown;
    projectPath: string;
    handoffRunIds?: readonly string[];
    canceledHandoffRunIds?: readonly string[];
    status?: "failed" | "canceled";
    identities?: readonly WorkerIdentity[];
  }) {
    const status = input.status ?? "failed";
    const failure = failureEvidence(input.cause, input.stage);
    const cleanupFailures: Array<{ runId: string; message: string }> = [];
    if (options.recordHandoffTerminal) {
      for (const runId of [...(input.handoffRunIds ?? []), ...(input.canceledHandoffRunIds ?? [])]) {
        try {
          const handoffStatus = input.canceledHandoffRunIds?.includes(runId) ? "canceled" : status;
          await options.recordHandoffTerminal({ projectPath: input.projectPath, runId, status: handoffStatus });
        } catch (cleanupCause) {
          cleanupFailures.push({ runId, message: cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause) });
        }
      }
    }
    try {
      await options.reportDispatchTerminal({
        runId: input.runId,
        status,
        summary: `${input.action} ${status} at ${input.stage}: ${failure.message}`,
      });
    } catch (terminalCause) {
      cleanupFailures.push({ runId: input.runId, message: terminalCause instanceof Error ? terminalCause.message : String(terminalCause) });
    }
    return {
      status,
      action: input.action,
      runId: input.runId,
      ...(input.identities ? { identities: input.identities } : {}),
      failure,
      ...(cleanupFailures.length ? { cleanupFailures } : {}),
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
    const slots = rawTasks.map((task) => options.resolveSlot(task.modelSlot));
    for (const slot of slots) options.validateModel(slot);
    await validateCapabilities(slots);
    const agents = rawTasks.map((task) => options.getAgent(task.agent));
    let invocations = rawTasks.map((task, index): OneShotInvocation => {
      const slot = slots[index]!;
      const agent = agents[index]!;
      return {
        name: task.name,
        agent: task.agent,
        modelSlot: task.modelSlot,
        model: slot.model,
        thinking: slot.thinking,
        cwd,
        prompt: agent.prompt,
        tools: agent.tools,
        task: task.task,
      };
    });
    const executor = dependency(options.oneShot, "oneShot");
    const run = options.beginDispatch({ changeId, projectId: options.projectId ?? cwd, summary: `${action} ${invocations.length}` });
    const managed = input.handoffMode === "managed";
    invocations = invocations.map((item, index) => {
      const slot = slots[index]!;
      const identity: WorkerIdentity = Object.freeze({
        name: item.name,
        agent: item.agent,
        role: agents[index]!.role,
        requestedSlot: slot.requestedSlot,
        resolvedSlot: slot.resolvedSlot,
        model: slot.model,
        thinking: slot.thinking,
        handoffMode: managed ? "managed" : "inline",
        invocationId: `${run.runId}-${index + 1}`,
        runId: invocations.length === 1 ? run.runId : `${run.runId}-${index + 1}`,
      });
      return {
        ...item,
        identity,
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onProgress ? { onProgress: (event: OneShotProgress) => options.onProgress!({ ...event, identity }) } : {}),
      };
    });
    const handoffRunIds = invocations.map((_, index) => invocations.length === 1 ? run.runId : `${run.runId}-${index + 1}`);
    const emit = (index: number, event: OneShotProgress) => {
      const identity = invocations[index]?.identity;
      if (!identity || !options.onProgress) return;
      try { options.onProgress({ ...event, identity }); } catch { /* progress rendering is observational */ }
    };
    invocations.forEach((_, index) => emit(index, { type: "accepted" }));
    const createdHandoffIds: string[] = [];
    let stage: "handoff" | "worker" | "handoff_report" = "handoff";
    try {
      if (managed) {
        const createHandoff = dependency(options.createHandoff, "createHandoff");
        const managedInvocations: OneShotInvocation[] = [];
        for (const [index, item] of invocations.entries()) {
          const handoffRunId = handoffRunIds[index]!;
          const workspace = await createHandoff({ projectPath: options.projectId ?? cwd, runId: handoffRunId, brief: item.task, producer: { kind: "captain", id: "captain" } });
          createdHandoffIds.push(handoffRunId);
          emit(index, { type: "handoff_created", runId: handoffRunId });
          const previous = action === "chain" && item.task.includes("{previous}") ? " The prior step output is: {previous}." : "";
          managedInvocations.push({ ...item, task: `Read your assigned brief at ${workspace.worker.briefPath}.${previous} Complete only that brief. Write your final report to ${workspace.worker.reportPath}. Do not include the full report in model output.` });
        }
        invocations = managedInvocations;
      }
      stage = "worker";
      const result = action === "single"
        ? await executor.single(invocations[0]!)
        : action === "parallel"
          ? await executor.parallel(invocations)
          : await executor.chain(invocations);
      stage = "handoff_report";
      const evidenceRefs = managed ? await Promise.all(handoffRunIds.map(async (runId, index) => {
        const evidence = await dependency(options.validateHandoffReport, "validateHandoffReport")({ projectPath: options.projectId ?? cwd, runId, producer: { kind: "worker", id: invocations[index]!.name } });
        emit(index, { type: "report_validated", runId });
        return evidence;
      })) : [];
      await options.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: `${action} completed`, ...(evidenceRefs.length ? { evidenceRefs: evidenceRefs.map((item) => JSON.stringify(item)) } : {}) });
      invocations.forEach((_, index) => emit(index, { type: "completed" }));
      return { status: "completed", action, runId: run.runId, identities: invocations.map((item) => item.identity), result: managed ? undefined : result, slots, ...(evidenceRefs.length ? { handoffs: evidenceRefs } : {}) };
    } catch (cause) {
      const canceled = options.signal?.aborted === true;
      let primary = canceled ? cancellationError("during_run") : cause;
      let terminalHandoffIds = [...createdHandoffIds];
      const canceledHandoffIds: string[] = [];
      if (cause instanceof OneShotBatchError && !canceled) {
        terminalHandoffIds = [];
        let firstFailure: unknown;
        for (const [index, outcome] of cause.outcomes.entries()) {
          if (outcome.status === "fulfilled") {
            if (managed) {
              try {
                await dependency(options.validateHandoffReport, "validateHandoffReport")({ projectPath: options.projectId ?? cwd, runId: handoffRunIds[index]!, producer: { kind: "worker", id: invocations[index]!.name } });
                emit(index, { type: "report_validated", runId: handoffRunIds[index]! });
              } catch (reportCause) {
                firstFailure ??= reportCause; terminalHandoffIds.push(handoffRunIds[index]!);
                emit(index, { type: "failed", stage: "handoff_report", summary: progressSummary(failureEvidence(reportCause, "handoff_report").message) });
                continue;
              }
            }
            emit(index, { type: "completed" });
          } else if (outcome.status === "skipped") {
            canceledHandoffIds.push(handoffRunIds[index]!);
            emit(index, { type: "canceled", summary: "Invocation did not start after an earlier chain failure" });
          } else {
            firstFailure ??= outcome.reason; terminalHandoffIds.push(handoffRunIds[index]!);
            emit(index, { type: "failed", stage: "worker", summary: progressSummary(failureEvidence(outcome.reason, "worker").message) });
          }
        }
        primary = firstFailure ?? cause;
      } else {
        if (!canceled && stage === "worker") {
          for (const slot of slots) primary = workerRejection(slot, cause) ?? primary;
        }
        const failure = failureEvidence(primary, stage);
        invocations.forEach((_, index) => emit(index, canceled
          ? { type: "canceled", summary: failure.message }
          : { type: "failed", stage, summary: progressSummary(failure.message) }));
      }
      return finalizeDispatchFailure({
        action,
        runId: run.runId,
        stage,
        cause: primary,
        projectPath: options.projectId ?? cwd,
        handoffRunIds: terminalHandoffIds,
        ...(canceledHandoffIds.length ? { canceledHandoffRunIds: canceledHandoffIds } : {}),
        identities: invocations.flatMap((item) => item.identity ? [item.identity] : []),
        ...(canceled ? { status: "canceled" as const } : {}),
      });
    }
  }

  return {
    async execute(rawInput: unknown, caller: { captain: boolean }): Promise<unknown> {
      validate(rawInput);
      const action = required(rawInput, "action");
      const captainOptional = new Set(["status", "list", "read", "abort", "destroy", "doctor", "review_campaign_status"]);
      if (!captainOptional.has(action) && !caller.captain) throw new Error(`Captain capability is required for ${action}`);
      preflight(action, rawInput);
      const cancellable = new Set(["single", "parallel", "chain", "create", "send", "steer"]);
      if (cancellable.has(action) && options.signal?.aborted) {
        return { status: "canceled", action, failure: failureEvidence(cancellationError("preflight"), "preflight") };
      }
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
          implementationCampaignId: required(rawInput, "implementationCampaignId"), taskScope: required(rawInput, "taskScope"),
        });
      }
      if (action === "record_review_finding") {
        return dependency(options.recordReviewFinding, "recordReviewFinding")({
          campaignId: required(rawInput, "campaignId"), changeId: changeId!, projectId: options.projectId ?? cwd,
          rootCauseId: required(rawInput, "rootCauseId"),
          summary: required(rawInput, "summary"), scope: required(rawInput, "scope") as ReviewFindingScope,
          ...(rawInput.evidenceRef === undefined ? {} : { evidenceRef: required(rawInput, "evidenceRef") }),
          ...(rawInput.materiallyConflictsDisposition === undefined ? {} : { materiallyConflictsDisposition: rawInput.materiallyConflictsDisposition === true }),
        });
      }
      if (action === "disposition_review_finding") {
        return dependency(options.dispositionReviewFinding, "dispositionReviewFinding")({
          campaignId: required(rawInput, "campaignId"), changeId: changeId!, projectId: options.projectId ?? cwd, rootCauseId: required(rawInput, "rootCauseId"),
          disposition: required(rawInput, "disposition") as Exclude<ReviewFindingDisposition, "pending">, rationale: required(rawInput, "rationale"),
          ...(rawInput.evidenceRef === undefined ? {} : { evidenceRef: required(rawInput, "evidenceRef") }),
        });
      }
      if (action === "resolve_review_finding") {
        return dependency(options.resolveReviewFinding, "resolveReviewFinding")({
          campaignId: required(rawInput, "campaignId"), changeId: changeId!, projectId: options.projectId ?? cwd, rootCauseId: required(rawInput, "rootCauseId"),
          verification: rawInput.verification as VerificationManifest,
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
        const workKind = typeof rawInput.workKind === "string" ? rawInput.workKind : "review";
        if (workKind !== "review" && workKind !== "fix") throw new Error("Review campaign dispatch must be review or fix work");
        dependency(options.consumeReviewCampaign, "consumeReviewCampaign")({
          campaignId: reviewCampaignId, changeId: changeId!, projectId: options.projectId ?? cwd, kind: workKind,
          ...(workKind === "fix" ? { rootCauseId: required(rawInput, "reviewFindingRootCauseId") } : {}),
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
        const verification = rawInput.verification as VerificationManifest | undefined;
        return report({
          runId,
          status: required(rawInput, "status") as ChangeTerminalReport["status"],
          summary: required(rawInput, "summary"),
          ...(verification === undefined ? {} : { verification }),
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
        await validateCapabilities([slot]);
        const agent = options.getAgent(agentName);
        const run = options.beginDispatch({ changeId: changeId!, projectId: options.projectId ?? cwd, summary: `create ${name}` });
        const handoffMode = required(rawInput, "handoffMode") as "managed" | "inline";
        let handoff: Awaited<ReturnType<NonNullable<OrchestrationOptions["createHandoff"]>>> | undefined;
        let createdWorkerId: string | undefined;
        let stage = "handoff";
        try {
          if (handoffMode === "managed") {
            if (typeof rawInput.brief !== "string" || !rawInput.brief.trim()) throw new Error("$.brief: required for managed create");
            handoff = await dependency(options.createHandoff, "createHandoff")({ projectPath: options.projectId ?? cwd, runId: run.runId, brief: rawInput.brief, producer: { kind: "captain", id: "captain" } });
          }
          stage = "worker";
          const worker = await options.createWorker({
            name,
            agent: agentName,
            role: agent.role,
            modelSlot,
            resolvedSlot: slot.resolvedSlot,
            model: slot.model,
            thinking: slot.thinking,
            cwd,
            prompt: handoff ? `${agent.prompt}\n\nManaged handoff: read ${handoff.worker.briefPath} and write reports to ${handoff.worker.reportPath}.` : agent.prompt,
            tools: agent.tools,
            handoffMode,
            ...(handoff ? { handoffRunId: run.runId, initialMessage: `Read your assigned brief at ${handoff.worker.briefPath}. Write the completed report to ${handoff.worker.reportPath}.` } : {}),
          });
          createdWorkerId = worker.workerId;
          const persistentIdentity: WorkerIdentity = Object.freeze({
            name, agent: agentName, role: agent.role, requestedSlot: modelSlot, resolvedSlot: slot.resolvedSlot,
            model: slot.model, thinking: slot.thinking, handoffMode, invocationId: `${run.runId}-1`, runId: run.runId,
          });
          try { options.onProgress?.({ type: "accepted", identity: persistentIdentity, ...("telemetry" in worker && worker.telemetry ? { telemetry: worker.telemetry as never } : {}) }); } catch { /* observational */ }
          const settleCreate = async () => {
            if (!handoff) {
              await options.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: "create completed" });
              return undefined;
            }
            const messageId = typeof worker.initialMessageId === "string"
              ? worker.initialMessageId
              : typeof worker.activeMessageId === "string" ? worker.activeMessageId : undefined;
            if (!messageId) throw new Error("Managed persistent create did not start its initial message");
            const abortPersistent = () => { void options.abortWorker?.(worker.workerId); };
            options.signal?.addEventListener("abort", abortPersistent, { once: true });
            if (options.signal?.aborted) abortPersistent();
            try {
              await observeMessage((worker as { workerId: string }).workerId, messageId);
              stage = "handoff_report";
              const evidence = await dependency(options.validateHandoffReport, "validateHandoffReport")({ projectPath: options.projectId ?? cwd, runId: run.runId, producer: { kind: "worker", id: (worker as { workerId: string }).workerId } });
              await options.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: "create completed", evidenceRefs: [JSON.stringify(evidence)] });
              let telemetry: OneShotProgress["telemetry"];
              try { telemetry = (options.statusWorker?.(worker.workerId) as { telemetry?: OneShotProgress["telemetry"] } | undefined)?.telemetry; } catch { telemetry = undefined; }
              try { options.onProgress?.({ type: "completed", identity: persistentIdentity, ...(telemetry ? { telemetry } : {}) }); } catch { /* observational */ }
              return evidence;
            } catch (cause) {
              return finalizeDispatchFailure({ action: "create", runId: run.runId, stage, cause, projectPath: options.projectId ?? cwd, handoffRunIds: [run.runId], ...(options.signal?.aborted ? { status: "canceled" as const } : {}) });
            } finally { options.signal?.removeEventListener("abort", abortPersistent); }
          };
          const settlement = settleCreate();
          options.trackSettlement?.(settlement);
          void settlement.catch(() => undefined);
          return { ...worker, runId: run.runId, slot, ...(handoff ? { handoff: handoff.reference } : {}) };
        } catch (cause) {
          const primary = stage === "worker" ? workerRejection(slot, cause) ?? cause : cause;
          if (createdWorkerId && options.destroyWorker) await options.destroyWorker(createdWorkerId, true).catch(() => undefined);
          return finalizeDispatchFailure({
            action: "create",
            runId: run.runId,
            stage,
            cause: primary,
            projectPath: options.projectId ?? cwd,
            handoffRunIds: handoff ? [run.runId] : [],
            ...(options.signal?.aborted ? { status: "canceled" as const } : {}),
          });
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
        let stage = managed ? "handoff" : "worker";
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
          stage = "worker";
          immediate = await sendWorker({
            workerId,
            message: dispatchMessage,
            delivery: action === "steer" ? "steer" : rawInput.delivery ?? "reject",
            wait: false,
            ...(rawInput.timeoutMs === undefined ? {} : { timeoutMs: rawInput.timeoutMs }),
          });
        } catch (cause) {
          let primary = cause;
          let summary: unknown;
          try { summary = options.statusWorker?.(workerId); } catch { summary = undefined; }
          if (stage === "worker" && summary !== null && typeof summary === "object") {
            const workerModel = (summary as { model?: unknown }).model;
            const thinking = (summary as { thinking?: unknown }).thinking;
            if (typeof workerModel === "string" && typeof thinking === "string") {
              primary = workerRejection({ model: workerModel, thinking: thinking as ResolvedSlot["thinking"] }, cause) ?? cause;
            }
          }
          return finalizeDispatchFailure({
            action,
            runId: run.runId,
            stage,
            cause: primary,
            projectPath: options.projectId ?? cwd,
            handoffRunIds: managed && handoffRunId ? [handoffRunId] : [],
          });
        }
        const messageId = immediate !== null && typeof immediate === "object" &&
          typeof (immediate as { messageId?: unknown }).messageId === "string"
          ? (immediate as { messageId: string }).messageId
          : undefined;
        if (!messageId) {
          return finalizeDispatchFailure({
            action,
            runId: run.runId,
            stage: "worker",
            cause: new Error(`${action} did not return a messageId`),
            projectPath: options.projectId ?? cwd,
            handoffRunIds: managed && handoffRunId ? [handoffRunId] : [],
          });
        }
        let persistentIdentity: WorkerIdentity | undefined;
        try {
          const summary = options.statusWorker?.(workerId) as {
            name?: unknown; agent?: unknown; role?: unknown; modelSlot?: unknown; resolvedSlot?: unknown;
            model?: unknown; thinking?: unknown; handoffMode?: unknown; telemetry?: OneShotProgress["telemetry"];
          } | undefined;
          if (summary && typeof summary.name === "string" && typeof summary.agent === "string" &&
            typeof summary.modelSlot === "string" && typeof summary.model === "string" && typeof summary.thinking === "string") {
            const role = typeof summary.role === "string" ? summary.role : options.getAgent(summary.agent).role;
            persistentIdentity = Object.freeze({
              name: summary.name, agent: summary.agent, role, requestedSlot: summary.modelSlot,
              resolvedSlot: typeof summary.resolvedSlot === "string" ? summary.resolvedSlot : summary.modelSlot,
              model: summary.model, thinking: summary.thinking as ResolvedSlot["thinking"],
              handoffMode: summary.handoffMode === "managed" ? "managed" : handoffMode,
              invocationId: `${run.runId}-1`, runId: run.runId,
            });
            try { options.onProgress?.({ type: "accepted", identity: persistentIdentity, ...(summary.telemetry ? { telemetry: summary.telemetry } : {}) }); } catch { /* observational */ }
          }
        } catch { /* persistent card projection is observational */ }
        const settle = async () => {
          const abortPersistent = () => { void options.abortWorker?.(workerId); };
          options.signal?.addEventListener("abort", abortPersistent, { once: true });
          if (options.signal?.aborted) abortPersistent();
          try {
            const completed = rawInput.wait === false
              ? (await observeMessage(workerId, messageId), { accepted: true, workerId, messageId, status: messageStatus(workerId, messageId) })
              : await waitForMessage(workerId, messageId);
            stage = "handoff_report";
            const evidence = managed && handoffRunId ? await dependency(options.validateHandoffReport, "validateHandoffReport")({ projectPath: options.projectId ?? cwd, runId: handoffRunId, producer: { kind: "worker", id: workerId }, ...(reportRevision === undefined ? {} : { expectedRevision: reportRevision }) }) : undefined;
            await options.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: `${action} completed`, ...(evidence ? { evidenceRefs: [JSON.stringify(evidence)] } : {}) });
            if (persistentIdentity) {
              let telemetry: OneShotProgress["telemetry"];
              try { telemetry = (options.statusWorker?.(workerId) as { telemetry?: OneShotProgress["telemetry"] } | undefined)?.telemetry; } catch { telemetry = undefined; }
              try { options.onProgress?.({ type: "completed", identity: persistentIdentity, ...(telemetry ? { telemetry } : {}) }); } catch { /* observational */ }
            }
            return evidence ? { handoff: evidence } : completed;
          } catch (cause) {
            let messageTerminal: "completed" | "failed" | "canceled" = "failed";
            try {
              const observed = messageStatus(workerId, messageId);
              if (observed === "completed" || observed === "failed" || observed === "canceled") messageTerminal = observed;
            } catch { /* diagnostic only */ }
            let primary = cause;
            let summary: unknown;
            try { summary = options.statusWorker?.(workerId); } catch { summary = undefined; }
            if (stage === "worker" && summary !== null && typeof summary === "object") {
              const workerModel = (summary as { model?: unknown }).model;
              const thinking = (summary as { thinking?: unknown }).thinking;
              if (typeof workerModel === "string" && typeof thinking === "string") {
                primary = workerRejection({ model: workerModel, thinking: thinking as ResolvedSlot["thinking"] }, cause) ?? cause;
              }
            }
            return finalizeDispatchFailure({
              action,
              runId: run.runId,
              stage,
              cause: primary,
              projectPath: options.projectId ?? cwd,
              handoffRunIds: managed && handoffRunId ? [handoffRunId] : [],
              status: options.signal?.aborted || messageTerminal === "canceled" ? "canceled" : "failed",
            });
          } finally {
            options.signal?.removeEventListener("abort", abortPersistent);
          }
        };
        const settlement = settle();
        options.trackSettlement?.(settlement);
        if (rawInput.wait === false) {
          void settlement.catch(() => undefined);
          return { status: "accepted", runId: run.runId, result: immediate };
        }
        const settled = await settlement;
        if (settled !== null && typeof settled === "object" &&
          ((settled as { status?: unknown }).status === "failed" || (settled as { status?: unknown }).status === "canceled")) {
          return settled;
        }
        return { status: "completed", runId: run.runId, result: settled };
      }

      throw new Error(`Unsupported orchestration action: ${action}`);
    },
  };
}
