export interface ObservationWorker { workerId: string; status: string; lastActivityAt: number; activeMessageId?: string; telemetry?: { elapsedMs: number; latestAssistantSummary?: string } }
export interface ObservationProbe { workerId: string; status: string; elapsedMs?: number; lastProgressAgeMs?: number; lastOperation?: string; progressRevision: number }
export interface ObservationEvent { type: "WORKER_PROGRESS_STALLED" | "WORKER_SETTLED" | "WORKER_FAILED"; workerId: string; dispatchStatus: string; elapsedMs: number; lastProgressAgeMs: number; lastOperation?: string; episode: number }
export interface ObservationSchedulerOptions { intervalSeconds: number; now?: () => number; setTimeout?: typeof setTimeout; clearTimeout?: typeof clearTimeout; probe: () => readonly ObservationProbe[]; emit: (event: ObservationEvent) => void }

const MAX_TIMER_DELAY_SECONDS = Math.floor(2_147_483_647 / 1000);

export function validatePollInterval(value: unknown, fallback = 30): number {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(resolved) || (resolved as number) <= 0 || (resolved as number) > MAX_TIMER_DELAY_SECONDS) {
    throw new Error("Campaign polling interval must be a positive integer within timer limits");
  }
  return resolved as number;
}

export class ObservationScheduler {
  readonly #options: ObservationSchedulerOptions;
  readonly #set: typeof setTimeout;
  readonly #clear: typeof clearTimeout;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #generation = 0;
  #previous = new Map<string, ObservationProbe>();
  #unchanged = new Map<string, number>();
  #episodes = new Map<string, number>();
  #running = false;

  constructor(options: ObservationSchedulerOptions) {
    const intervalSeconds = validatePollInterval(options.intervalSeconds);
    this.#options = { ...options, intervalSeconds };
    this.#set = options.setTimeout ?? setTimeout;
    this.#clear = options.clearTimeout ?? clearTimeout;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const generation = ++this.#generation;
    const tick = () => {
      if (!this.#running || generation !== this.#generation) return;
      this.poll();
      this.#timer = this.#set(tick, this.#options.intervalSeconds * 1000);
    };
    this.#timer = this.#set(tick, this.#options.intervalSeconds * 1000);
  }

  poll(): void {
    if (!this.#running && this.#generation > 0) return;
    const seen = new Set<string>();
    for (const current of this.#options.probe()) {
      if (seen.has(current.workerId)) continue;
      seen.add(current.workerId);
      const prior = this.#previous.get(current.workerId);
      const unchanged = prior?.progressRevision === current.progressRevision;
      const count = unchanged ? (this.#unchanged.get(current.workerId) ?? 0) + 1 : 0;
      this.#unchanged.set(current.workerId, count);
      if (count === 2 && current.status === "running") {
        const episode = (this.#episodes.get(current.workerId) ?? 0) + 1;
        this.#episodes.set(current.workerId, episode);
        this.#options.emit({ type: "WORKER_PROGRESS_STALLED", workerId: current.workerId, dispatchStatus: current.status, elapsedMs: current.elapsedMs ?? 0, lastProgressAgeMs: current.lastProgressAgeMs ?? 0, ...(current.lastOperation ? { lastOperation: current.lastOperation } : {}), episode });
      }
      this.#previous.set(current.workerId, { ...current });
    }
    for (const workerId of this.#previous.keys()) {
      if (!seen.has(workerId)) {
        this.#previous.delete(workerId);
        this.#unchanged.delete(workerId);
        this.#episodes.delete(workerId);
      }
    }
  }

  stop(): void {
    this.#running = false;
    ++this.#generation;
    if (this.#timer !== undefined) this.#clear(this.#timer);
    this.#timer = undefined;
    this.#previous.clear();
    this.#unchanged.clear();
    this.#episodes.clear();
  }
}
