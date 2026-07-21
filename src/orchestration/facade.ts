import { Check, Errors } from "typebox/value";
import type { AgentDefinition } from "../agents/catalog.js";
import type { ChangeTerminalReport, DispatchTerminalReport } from "../lifecycle/run-lifecycle.js";
import type { CompletionEvidence, E2EWaiver } from "../lifecycle/verification-gate.js";
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
}

export interface OrchestrationOptions {
  authorize(input: { action: string; changeId?: string; cwd: string }): Promise<unknown>;
  resolveSlot(slot: string): ResolvedSlot;
  validateModel(slot: ResolvedSlot): void;
  getAgent(name: string): AgentDefinition | Omit<AgentDefinition, "source" | "scope">;
  createWorker(input: CreateWorkerInput): Promise<{ workerId: string }>;
  beginChange?: (input: { changeId: string }) => { runId: string };
  beginDispatch(input: { changeId: string; summary: string }): { runId: string };
  oneShot?: OneShotExecutor;
  sendWorker?: (input: Record<string, unknown>) => Promise<unknown>;
  waitForMessage?: (workerId: string, messageId: string) => Promise<unknown>;
  messageStatus?: (workerId: string, messageId: string) => "completed" | "failed" | "canceled";
  statusWorker?: (workerId: string) => unknown;
  listWorkers?: () => unknown;
  readWorker?: (workerId: string, options: Record<string, unknown>) => unknown;
  abortWorker?: (workerId: string) => Promise<unknown>;
  destroyWorker?: (workerId: string, force?: boolean) => Promise<unknown>;
  doctor?: () => Promise<unknown> | unknown;
  reportDispatchTerminal: (report: DispatchTerminalReport) => Promise<unknown>;
  reportChangeTerminal?: (report: ChangeTerminalReport) => Promise<unknown>;
  changeIdForRun?: (runId: string) => string;
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
  if (action === "create") {
    for (const field of ["changeId", "cwd", "name", "agent", "modelSlot"]) required(input, field);
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
    const invocations = resolved.map((item) => item.invocation);
    const slots = resolved.map((item) => item.slot);
    const executor = dependency(options.oneShot, "oneShot");
    const run = options.beginDispatch({ changeId, summary: `${action} ${invocations.length}` });
    try {
      const result = action === "single"
        ? await executor.single(invocations[0]!)
        : action === "parallel"
          ? await executor.parallel(invocations)
          : await executor.chain(invocations);
      await options.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: `${action} completed` });
      return { runId: run.runId, result, slots };
    } catch (cause) {
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
      const safe = new Set(["status", "list", "read", "abort", "destroy", "doctor"]);
      if (!safe.has(action) && !caller.captain) throw new Error(`Captain capability is required for ${action}`);
      const changeId = safe.has(action) ? undefined : required(rawInput, "changeId");
      await options.authorize({ action, ...(changeId === undefined ? {} : { changeId }), cwd });

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

      if (action === "begin_change") {
        return dependency(options.beginChange, "beginChange")({ changeId: changeId! });
      }

      if (action === "report_terminal") {
        const report = dependency(options.reportChangeTerminal, "reportChangeTerminal");
        const runId = required(rawInput, "runId");
        const runChangeId = dependency(options.changeIdForRun, "changeIdForRun")(runId);
        if (runChangeId !== changeId) {
          throw new Error(`Run ${runId} belongs to change ${runChangeId}, not ${changeId}`);
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
        const run = options.beginDispatch({ changeId: changeId!, summary: `create ${name}` });
        try {
          const worker = await options.createWorker({
            name,
            agent: agentName,
            modelSlot,
            model: slot.model,
            thinking: slot.thinking,
            cwd,
            prompt: agent.prompt,
            tools: agent.tools,
          });
          await options.reportDispatchTerminal({
            runId: run.runId,
            status: "completed",
            summary: "create completed",
          });
          return { ...worker, runId: run.runId, slot };
        } catch (cause) {
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
        const sendWorker = dependency(options.sendWorker, "sendWorker");
        const waitForMessage = dependency(options.waitForMessage, "waitForMessage");
        const messageStatus = dependency(options.messageStatus, "messageStatus");
        const run = options.beginDispatch({ changeId: changeId!, summary: `${action} ${workerId}` });
        let immediate: unknown;
        try {
          immediate = await sendWorker({
            workerId,
            message,
            delivery: action === "steer" ? "steer" : rawInput.delivery ?? "reject",
            wait: false,
            ...(rawInput.timeoutMs === undefined ? {} : { timeoutMs: rawInput.timeoutMs }),
          });
        } catch (cause) {
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
            await options.reportDispatchTerminal({ runId: run.runId, status: "completed", summary: `${action} completed` });
            return completed;
          } catch (cause) {
            const status = messageStatus(workerId, messageId);
            await options.reportDispatchTerminal({
              runId: run.runId,
              status: status === "canceled" ? "canceled" : "failed",
              summary: status === "canceled" ? `${action} canceled` : `${action} failed`,
            });
            throw cause;
          }
        };
        const settlement = settle();
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
              return { runId: run.runId, result: immediate, timedOut: true };
            }
            return { runId: run.runId, result: waited.result };
          }
          return { runId: run.runId, result: await settlement };
        }
        void settlement.catch(() => undefined);
        return { runId: run.runId, result: immediate };
      }

      throw new Error(`Unsupported orchestration action: ${action}`);
    },
  };
}
