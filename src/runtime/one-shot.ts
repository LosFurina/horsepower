import type { ThinkingLevel } from "../slots/registry.js";

export type OneShotProgress =
  | { type: "accepted" }
  | { type: "starting" }
  | { type: "assistant"; summary: string }
  | { type: "tool_start" | "tool_update"; toolName: string; toolCallId: string; operation: string; target?: string }
  | { type: "tool_end"; toolName: string; toolCallId: string; operation: string; target?: string; isError: boolean }
  | { type: "handoff_created"; runId: string }
  | { type: "report_validated"; runId: string }
  | { type: "completed" }
  | { type: "failed"; stage: string; summary: string }
  | { type: "canceled"; summary: string };

export interface WorkerIdentity {
  name: string;
  agent: string;
  role: string;
  requestedSlot: string;
  resolvedSlot: string;
  model: string;
  thinking: ThinkingLevel;
  handoffMode: "managed" | "inline";
  invocationId: string;
  runId?: string;
}

export interface OneShotInvocation {
  name: string;
  agent: string;
  modelSlot: string;
  model: string;
  thinking: ThinkingLevel;
  cwd: string;
  prompt: string;
  tools: readonly string[];
  task: string;
  identity?: WorkerIdentity;
  signal?: AbortSignal;
  onProgress?: (event: OneShotProgress) => void;
}

export interface OneShotUsage {
  input?: number;
  output?: number;
  totalCost?: number;
}

export interface OneShotResult {
  name: string;
  text: string;
  displayText?: string;
  usage?: OneShotUsage;
}

export interface OneShotExecutor {
  single(task: OneShotInvocation): Promise<OneShotResult>;
  parallel(tasks: readonly OneShotInvocation[]): Promise<OneShotResult[]>;
  chain(tasks: readonly OneShotInvocation[]): Promise<OneShotResult[]>;
}

export type OneShotBatchOutcome =
  | { status: "fulfilled"; value: OneShotResult }
  | { status: "rejected"; reason: unknown }
  | { status: "skipped" };

export class OneShotBatchError extends Error {
  readonly outcomes: readonly OneShotBatchOutcome[];
  constructor(outcomes: readonly OneShotBatchOutcome[]) {
    const rejected = outcomes.find((outcome): outcome is { status: "rejected"; reason: unknown } => outcome.status === "rejected");
    super(rejected?.reason instanceof Error ? rejected.reason.message : "One-shot batch did not complete every invocation");
    this.name = "OneShotBatchError";
    this.outcomes = outcomes;
  }
}

export interface OneShotExecutorOptions {
  run(invocation: OneShotInvocation): Promise<OneShotResult>;
  concurrency?: number;
  displayByteLimit?: number;
}

function displayText(text: string, byteLimit: number): string {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= byteLimit) return text;
  let end = byteLimit;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  while (end > 0) {
    const notice = `\n… output omitted (${bytes.length - end} bytes)`;
    const budget = byteLimit - Buffer.byteLength(notice, "utf8");
    end = Math.min(end, Math.max(0, budget));
    try {
      return `${decoder.decode(bytes.subarray(0, end))}${notice}`;
    } catch {
      end -= 1;
    }
  }
  return "… output omitted";
}

export function createOneShotExecutor(options: OneShotExecutorOptions): OneShotExecutor {
  const concurrency = Math.min(options.concurrency ?? 4, 4);
  const displayByteLimit = options.displayByteLimit ?? 50 * 1024;

  function preflight(tasks: readonly OneShotInvocation[]): void {
    for (const task of tasks) {
      if (!task.modelSlot?.trim()) throw new Error(`One-shot modelSlot is required for ${task.name}`);
      if (!task.model?.trim()) throw new Error(`One-shot model is required for ${task.name}`);
      if (!task.thinking?.trim()) throw new Error(`One-shot thinking is required for ${task.name}`);
      if (!task.task?.trim()) throw new Error(`One-shot task is required for ${task.name}`);
    }
  }

  async function single(invocation: OneShotInvocation): Promise<OneShotResult> {
    preflight([invocation]);
    const result = await options.run(invocation);
    return { ...result, displayText: displayText(result.text, displayByteLimit) };
  }

  return {
    single,
    async parallel(tasks) {
      if (tasks.length > 8) throw new Error("Parallel one-shot accepts at most 8 tasks");
      preflight(tasks);
      const outcomes = new Array<OneShotBatchOutcome>(tasks.length);
      let next = 0;
      async function worker(): Promise<void> {
        while (next < tasks.length) {
          const index = next;
          next += 1;
          try { outcomes[index] = { status: "fulfilled", value: await single(tasks[index]!) }; }
          catch (reason) { outcomes[index] = { status: "rejected", reason }; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
      if (outcomes.some((outcome) => outcome.status === "rejected")) throw new OneShotBatchError(outcomes);
      return outcomes.map((outcome) => (outcome as { status: "fulfilled"; value: OneShotResult }).value);
    },
    async chain(tasks) {
      preflight(tasks);
      const outcomes: OneShotBatchOutcome[] = [];
      const results: OneShotResult[] = [];
      for (const task of tasks) {
        const previous = results.at(-1)?.text ?? "";
        try {
          const value = await single({ ...task, task: task.task.replaceAll("{previous}", previous) });
          outcomes.push({ status: "fulfilled", value }); results.push(value);
        } catch (reason) {
          outcomes.push({ status: "rejected", reason });
          while (outcomes.length < tasks.length) outcomes.push({ status: "skipped" });
          throw new OneShotBatchError(outcomes);
        }
      }
      return results;
    },
  };
}
