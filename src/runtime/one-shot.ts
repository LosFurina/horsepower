import type { ThinkingLevel } from "../slots/registry.js";

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
  signal?: AbortSignal;
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
      const results = new Array<OneShotResult>(tasks.length);
      let next = 0;
      async function worker(): Promise<void> {
        while (next < tasks.length) {
          const index = next;
          next += 1;
          results[index] = await single(tasks[index]!);
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
      return results;
    },
    async chain(tasks) {
      preflight(tasks);
      const results: OneShotResult[] = [];
      for (const task of tasks) {
        const previous = results.at(-1)?.text ?? "";
        results.push(await single({ ...task, task: task.task.replaceAll("{previous}", previous) }));
      }
      return results;
    },
  };
}
