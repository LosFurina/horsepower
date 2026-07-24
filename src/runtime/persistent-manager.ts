import { randomUUID } from "node:crypto";
import type { ThinkingLevel } from "../slots/registry.js";
import { capabilityRejectionError, type CapabilityRejectionError } from "./capability-rejection.js";
import { createEventStream, type EventStream, type EventStreamReadOptions, type EventStreamReadResult } from "./event-stream.js";
import { addProgressUsage, normalizeAssistantSummary, telemetrySnapshot, type ProgressTelemetry, type ProgressUsage } from "./progress-telemetry.js";
import { projectFailure, type CaptainFailure } from "../failures/captain-failure.js";

export type WorkerStatus = "starting" | "idle" | "running" | "failed" | "destroying" | "destroyed";
export type MessageStatus = "accepted" | "queued" | "running" | "completed" | "failed" | "canceled";
export type DeliveryMode = "reject" | "followUp" | "steer";

export interface WorkerLaunchInput {
  name: string;
  agent: string;
  role?: string;
  modelSlot: string;
  resolvedSlot?: string;
  model: string;
  thinking: ThinkingLevel;
  cwd: string;
  prompt: string;
  tools: readonly string[];
  initialMessage?: string;
  handoffMode?: "managed" | "inline";
  handoffRunId?: string;
}

export interface WorkerConnection {
  request(type: string, payload?: Readonly<Record<string, unknown>>): Promise<unknown>;
  kill(signal: NodeJS.Signals): void;
  cleanup(): Promise<void>;
  on(event: "event", listener: (event: Readonly<Record<string, unknown>>) => void): this;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

export interface WorkerSummary {
  workerId: string;
  name: string;
  agent: string;
  role?: string;
  modelSlot: string;
  resolvedSlot?: string;
  model: string;
  thinking: ThinkingLevel;
  cwd: string;
  status: WorkerStatus;
  activeMessageId?: string;
  initialMessageId?: string;
  queuedMessageIds: string[];
  createdAt: number;
  lastActivityAt: number;
  error?: string;
  failure?: CaptainFailure;
  secondaryFailures?: CaptainFailure[];
  handoffMode?: "managed" | "inline";
  handoffRunId?: string;
  telemetry?: ProgressTelemetry;
}

interface MessageState {
  messageId: string;
  text: string;
  status: MessageStatus;
  finalText?: string;
  error?: string;
  failure?: CapabilityRejectionError;
  structuredFailure?: CaptainFailure;
  abortObserved?: boolean;
  abortRequested?: boolean;
  startedAt: number;
  stoppedAt?: number;
  usage: ProgressUsage;
  latestAssistantSummary?: string;
  progressEvents: number;
  progressBytes: number;
  promise: Promise<MessageState>;
  resolve: (state: MessageState) => void;
  reject: (error: Error) => void;
}

interface WorkerState {
  summary: WorkerSummary;
  connection: WorkerConnection;
  events: EventStream;
  messages: Map<string, MessageState>;
  queue: string[];
  destroyRequested: boolean;
  exited: boolean;
}

export interface PersistentWorkerManagerOptions {
  startWorker(input: WorkerLaunchInput): Promise<WorkerConnection>;
  maxWorkers?: number;
  eventByteLimit?: number;
  gracefulShutdownMs?: number;
  now?: () => number;
  progressEventLimit?: number;
  progressByteLimit?: number;
}

export interface SendWorkerInput {
  workerId: string;
  message: string;
  delivery?: DeliveryMode;
  wait?: boolean;
  timeoutMs?: number;
}

export interface SendWorkerResult {
  accepted: true;
  workerId: string;
  messageId: string;
  status: MessageStatus | WorkerStatus;
  text?: string;
  error?: string;
  failure?: CaptainFailure;
  timedOut?: true;
  telemetry?: ProgressTelemetry;
}

function assistantText(event: Readonly<Record<string, unknown>>): string {
  const message = event.message as { role?: unknown; content?: unknown } | undefined;
  if (message?.role !== "assistant" || !Array.isArray(message.content)) return "";
  return message.content
    .filter((part): part is { type: "text"; text: string } =>
      part !== null && typeof part === "object" &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    )
    .map((part) => part.text)
    .join("\n");
}

export class PersistentWorkerManager {
  readonly #workers = new Map<string, WorkerState>();
  readonly #startWorker: PersistentWorkerManagerOptions["startWorker"];
  readonly #maxWorkers: number;
  readonly #eventByteLimit: number;
  readonly #gracefulShutdownMs: number;
  readonly #now: () => number;
  readonly #creationSettlements = new Set<Promise<void>>();
  readonly #progressEventLimit: number;
  readonly #progressByteLimit: number;
  readonly #creatingNames = new Set<string>();
  #creating = 0;
  #shuttingDown = false;

  constructor(options: PersistentWorkerManagerOptions) {
    this.#startWorker = options.startWorker;
    this.#maxWorkers = Math.min(options.maxWorkers ?? 8, 8);
    this.#eventByteLimit = options.eventByteLimit ?? 10 * 1024 * 1024;
    this.#gracefulShutdownMs = options.gracefulShutdownMs ?? 1000;
    this.#now = options.now ?? Date.now;
    this.#progressEventLimit = options.progressEventLimit ?? 200;
    this.#progressByteLimit = options.progressByteLimit ?? 64 * 1024;
  }

  async create(input: WorkerLaunchInput): Promise<WorkerSummary> {
    if (this.#shuttingDown) throw new Error("Persistent worker manager is shutting down");
    if ([...this.#workers.values()].some((worker) => worker.summary.name === input.name) || this.#creatingNames.has(input.name)) {
      throw new Error(`Persistent worker name already exists: ${input.name}`);
    }
    if (this.#workers.size + this.#creating >= this.#maxWorkers) {
      throw new Error(`Persistent worker limit reached (${this.#maxWorkers})`);
    }

    this.#creating += 1;
    this.#creatingNames.add(input.name);
    let settleCreation!: () => void;
    const creationSettlement = new Promise<void>((resolve) => { settleCreation = resolve; });
    this.#creationSettlements.add(creationSettlement);
    let connection: WorkerConnection | undefined;
    let workerId: string | undefined;
    try {
      connection = await this.#startWorker(input);
      if (this.#shuttingDown) throw new Error("Persistent worker manager is shutting down");
      workerId = `${input.agent}-${randomUUID()}`;
      const now = this.#now();
      const state: WorkerState = {
        summary: {
          workerId,
          name: input.name,
          agent: input.agent,
          ...(input.role ? { role: input.role } : {}),
          modelSlot: input.modelSlot,
          ...(input.resolvedSlot ? { resolvedSlot: input.resolvedSlot } : {}),
          model: input.model,
          thinking: input.thinking,
          cwd: input.cwd,
          status: "starting",
          queuedMessageIds: [],
          createdAt: now,
          lastActivityAt: now,
          ...(input.handoffMode ? { handoffMode: input.handoffMode } : {}),
          ...(input.handoffRunId ? { handoffRunId: input.handoffRunId } : {}),
        },
        connection,
        events: createEventStream({ byteLimit: this.#eventByteLimit }),
        messages: new Map(),
        queue: [],
        destroyRequested: false,
        exited: false,
      };
      this.#workers.set(workerId, state);
      connection.on("event", (event) => this.#processEvent(state, event));
      connection.on("exit", (code, signal) => this.#processExit(state, code, signal));

      await connection.request("get_state");
      if (this.#shuttingDown) throw new Error("Persistent worker manager is shutting down");
      if (state.summary.status === "failed") {
        throw new Error(state.summary.error ?? "Persistent worker exited during startup");
      }
      state.summary.status = "idle";
      this.#append(state, "worker.created");
      let initialMessageId: string | undefined;
      if (input.initialMessage !== undefined) {
        const initial = await this.send({ workerId, message: input.initialMessage, wait: false });
        initialMessageId = initial.messageId;
      }
      return { ...this.status(workerId), ...(initialMessageId ? { initialMessageId } : {}) };
    } catch (cause) {
      if (workerId) this.#workers.delete(workerId);
      if (connection) {
        connection.kill("SIGKILL");
        await connection.cleanup().catch(() => undefined);
      }
      throw cause;
    } finally {
      this.#creating -= 1;
      this.#creatingNames.delete(input.name);
      this.#creationSettlements.delete(creationSettlement);
      settleCreation();
    }
  }

  status(workerId: string): WorkerSummary {
    const worker = this.#require(workerId);
    const active = worker.summary.activeMessageId ? worker.messages.get(worker.summary.activeMessageId) : undefined;
    const latest = active ?? [...worker.messages.values()].at(-1);
    return structuredClone({ ...worker.summary, ...(latest ? { telemetry: this.#telemetry(worker, latest) } : {}) });
  }

  list(): WorkerSummary[] {
    return [...this.#workers.values()]
      .map((worker) => this.status(worker.summary.workerId))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  read(workerId: string, options?: EventStreamReadOptions): EventStreamReadResult {
    return this.#require(workerId).events.read(options);
  }

  async send(input: SendWorkerInput): Promise<SendWorkerResult> {
    const worker = this.#require(input.workerId);
    if (worker.summary.status === "failed") {
      const failure = worker.summary.failure;
      const error = new Error(`Persistent worker failed: ${failure?.message ?? worker.summary.error ?? "unknown error"}`);
      Object.assign(error, { failure });
      throw error;
    }
    if (worker.summary.status === "destroying" || worker.summary.status === "destroyed") {
      throw new Error(`Persistent worker ${input.workerId} is being destroyed`);
    }
    if (!input.message.trim()) throw new Error("Persistent worker message must not be empty");
    const delivery = input.delivery ?? "reject";
    const busy = worker.summary.status === "running";
    if (busy && delivery === "reject") {
      throw new Error(`Persistent worker ${input.workerId} is busy`);
    }
    if (!busy && delivery !== "reject") {
      throw new Error(`Delivery mode ${delivery} requires a busy worker`);
    }
    if (busy && worker.queue.length > 0) {
      throw new Error(`Persistent worker ${input.workerId} already has a queued message`);
    }

    const messageId = `msg-${randomUUID()}`;
    let resolve!: (state: MessageState) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<MessageState>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    void promise.catch(() => undefined);
    const message: MessageState = {
      messageId,
      text: input.message,
      status: busy ? "queued" : "running",
      promise,
      resolve,
      reject,
      startedAt: this.#now(),
      usage: {},
      progressEvents: 0,
      progressBytes: 0,
    };
    worker.messages.set(messageId, message);
    this.#append(worker, "message.accepted", messageId, input.message);

    try {
      if (!busy) {
        worker.summary.status = "running";
        worker.summary.activeMessageId = messageId;
        await worker.connection.request("prompt", { message: input.message });
        this.#append(worker, "turn.started", messageId);
      } else {
        worker.queue.push(messageId);
        worker.summary.queuedMessageIds.push(messageId);
        await worker.connection.request(delivery === "followUp" ? "follow_up" : "steer", {
          message: input.message,
        });
        this.#append(worker, `message.${delivery}`, messageId);
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      message.status = "failed";
      message.error = error.message;
      message.structuredFailure = projectFailure({ code: "HP-PERSISTENT-RPC-REQUEST", boundary: "persistent-worker", stage: "rpc", message: error.message, remediation: "Inspect the worker status and event stream before retrying." });
      message.reject(error);
      worker.queue = worker.queue.filter((id) => id !== messageId);
      worker.summary.queuedMessageIds = worker.summary.queuedMessageIds.filter((id) => id !== messageId);
      if (worker.summary.activeMessageId === messageId) delete worker.summary.activeMessageId;
      if (!worker.summary.activeMessageId && worker.queue.length === 0) worker.summary.status = "idle";
      this.#append(worker, "message.failed", messageId, undefined, error.message, message.structuredFailure);
      throw error;
    }

    const immediate: SendWorkerResult = {
      accepted: true,
      workerId: input.workerId,
      messageId,
      status: message.status,
    };
    if (!input.wait) return immediate;
    if (input.timeoutMs !== undefined && input.timeoutMs > 0) {
      const result = await Promise.race([
        promise.then((completed) => ({ completed })),
        new Promise<{ timedOut: true }>((resolveTimeout) =>
          setTimeout(() => resolveTimeout({ timedOut: true }), input.timeoutMs)
        ),
      ]);
      if ("timedOut" in result) return { ...immediate, timedOut: true };
      return this.#completedResult(input.workerId, result.completed);
    }
    return this.#completedResult(input.workerId, await promise);
  }

  async waitForMessage(workerId: string, messageId: string): Promise<SendWorkerResult> {
    const message = this.#require(workerId).messages.get(messageId);
    if (!message) throw new Error(`Unknown messageId: ${messageId}`);
    return this.#completedResult(workerId, await message.promise);
  }

  associateHandoff(workerId: string, runId: string): void {
    const worker = this.#require(workerId);
    worker.summary.handoffMode = "managed";
    worker.summary.handoffRunId = runId;
  }

  messageStatus(workerId: string, messageId: string): MessageStatus {
    const message = this.#require(workerId).messages.get(messageId);
    if (!message) throw new Error(`Unknown messageId: ${messageId}`);
    return message.status;
  }

  async abort(workerId: string): Promise<{ workerId: string; aborted: true }> {
    const worker = this.#require(workerId);
    const activeId = worker.summary.activeMessageId;
    if (!activeId) throw new Error(`Persistent worker ${workerId} has no active turn`);
    const message = worker.messages.get(activeId)!;
    message.abortRequested = true;
    try {
      await worker.connection.request("abort");
    } catch (cause) {
      delete message.abortRequested;
      throw cause;
    }
    try {
      await message.promise;
    } catch {
      if (message.status !== "canceled") throw new Error(message.error ?? "Worker abort failed");
    }
    if (message.status !== "canceled") {
      throw new Error("Worker turn completed without semantic abort evidence");
    }
    return { workerId, aborted: true };
  }

  async destroy(workerId: string, force = false): Promise<{ workerId: string; destroyed: true }> {
    const worker = this.#require(workerId);
    worker.destroyRequested = true;
    worker.summary.status = "destroying";
    this.#append(worker, "worker.destroying");
    const error = new Error("Persistent worker destroyed");
    for (const message of worker.messages.values()) {
      if (["accepted", "queued", "running"].includes(message.status)) {
        message.status = "failed";
        message.error = error.message;
        message.reject(error);
      }
    }

    let exit = worker.exited
      ? Promise.resolve(true)
      : this.#waitForExit(worker.connection, this.#gracefulShutdownMs);
    if (!worker.exited) worker.connection.kill(force ? "SIGKILL" : "SIGTERM");
    let exited = await exit;
    if (!exited && !force) {
      exit = this.#waitForExit(worker.connection, this.#gracefulShutdownMs);
      worker.connection.kill("SIGKILL");
      exited = await exit;
    }
    if (!exited) {
      worker.summary.status = "failed";
      worker.summary.error = "Persistent worker did not exit after termination signal";
      throw new Error(worker.summary.error);
    }
    try {
      await worker.connection.cleanup();
    } catch (cause) {
      worker.summary.status = "failed";
      worker.summary.error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }
    worker.summary.status = "destroyed";
    this.#workers.delete(workerId);
    return { workerId, destroyed: true };
  }

  async destroyAll(force = false): Promise<void> {
    this.#shuttingDown = true;
    await Promise.all([...this.#creationSettlements]);
    const results = await Promise.allSettled(
      [...this.#workers.keys()].map((workerId) => this.destroy(workerId, force)),
    );
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(failures.map((failure) => failure.reason), "Failed to destroy all workers");
    }
  }

  abandonAll(): void {
    this.#shuttingDown = true;
    const error = new Error("Persistent worker abandoned during synchronous host exit");
    for (const [workerId, worker] of this.#workers) {
      worker.destroyRequested = true;
      worker.summary.status = "destroyed";
      for (const message of worker.messages.values()) {
        if (["accepted", "queued", "running"].includes(message.status)) {
          message.status = "failed";
          message.error = error.message;
          message.reject(error);
        }
      }
      worker.connection.kill("SIGKILL");
      void worker.connection.cleanup().catch(() => undefined);
      this.#workers.delete(workerId);
    }
  }

  #waitForExit(connection: WorkerConnection, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let finished = false;
      const complete = (exited: boolean) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(exited);
      };
      const timer = setTimeout(() => complete(false), timeoutMs);
      connection.once("exit", () => complete(true));
    });
  }

  #completedResult(workerId: string, message: MessageState): SendWorkerResult {
    return {
      accepted: true,
      workerId,
      messageId: message.messageId,
      status: message.status,
      text: message.finalText ?? "",
      telemetry: this.#telemetry(this.#require(workerId), message),
      ...(message.error === undefined ? {} : { error: message.error }),
      ...(message.structuredFailure ? { failure: message.structuredFailure } : {}),
    };
  }

  #require(workerId: string): WorkerState {
    const worker = this.#workers.get(workerId);
    if (!worker) throw new Error(`Unknown persistent worker: ${workerId}`);
    return worker;
  }

  #append(worker: WorkerState, type: string, messageId?: string, text?: string, error?: string, details?: unknown): void {
    if (type === "progress" && details !== undefined && messageId !== undefined) {
      const message = worker.messages.get(messageId);
      if (!message) return;
      const bytes = Buffer.byteLength(JSON.stringify(details), "utf8");
      if (message.progressEvents >= this.#progressEventLimit || message.progressBytes + bytes > this.#progressByteLimit) return;
      message.progressEvents += 1;
      message.progressBytes += bytes;
    }
    worker.events.append({
      type,
      timestamp: this.#now(),
      ...(messageId === undefined ? {} : { messageId }),
      ...(text === undefined ? {} : { text }),
      ...(error === undefined ? {} : { error }),
      ...(details === undefined ? {} : { details }),
    });
    worker.summary.lastActivityAt = this.#now();
  }

  #telemetry(_worker: WorkerState, message: MessageState): ProgressTelemetry {
    return telemetrySnapshot(message.startedAt, () => message.stoppedAt ?? this.#now(), message.usage, message.latestAssistantSummary);
  }

  #processEvent(worker: WorkerState, event: Readonly<Record<string, unknown>>): void {
    worker.events.append({ type: "rpc.raw", timestamp: this.#now(), details: event }, true);
    if (event.type === "message_start") {
      const message = event.message as { role?: unknown; content?: unknown } | undefined;
      if (message?.role === "user") {
        const text = typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
              .filter((part): part is { type: "text"; text: string } =>
                part !== null && typeof part === "object" &&
                (part as { type?: unknown }).type === "text" &&
                typeof (part as { text?: unknown }).text === "string"
              )
              .map((part) => part.text)
              .join("\n")
            : "";
        const queuedId = worker.queue.length === 1
          ? worker.queue[0]
          : worker.queue.find((id) => worker.messages.get(id)?.text === text);
        if (queuedId) this.#activateQueued(worker, queuedId);
      }
      return;
    }
    const activeId = worker.summary.activeMessageId;
    if (event.type === "error" && activeId) {
      const failure = capabilityRejectionError(event.error);
      if (failure) {
        const message = worker.messages.get(activeId);
        if (message) {
          message.failure = failure;
          message.structuredFailure = projectFailure({ code: failure.code ?? "HP-PERSISTENT-RPC-FAILURE", boundary: "persistent-worker", stage: "rpc", message: failure.message, remediation: "Inspect the worker status and event stream before retrying." });
          message.error = failure.message;
        }
      }
      return;
    }
    if (event.type === "message_end" && activeId) {
      const message = worker.messages.get(activeId);
      const value = event.message as { stopReason?: unknown; errorMessage?: unknown; usage?: unknown } | undefined;
      if (value?.stopReason === "error" || value?.stopReason === "aborted") {
        message!.error = typeof value.errorMessage === "string"
          ? value.errorMessage
          : `Worker message ${String(value.stopReason)}`;
        message!.structuredFailure ??= projectFailure({ code: value.stopReason === "aborted" ? "HP-PERSISTENT-MESSAGE-CANCELED" : "HP-PERSISTENT-MESSAGE-FAILED", boundary: "persistent-worker", stage: "message", message: message!.error, remediation: "Inspect the worker event stream and retry if appropriate." });
        message!.abortObserved = value.stopReason === "aborted";
      } else {
        const text = assistantText(event);
        if (text) {
          message!.finalText = text;
          const summary = normalizeAssistantSummary(text);
          if (summary === undefined) delete message!.latestAssistantSummary;
          else message!.latestAssistantSummary = summary;
        }
        const usage = value?.usage as Record<string, unknown> | undefined;
        message!.usage = addProgressUsage(message!.usage, {
          ...(typeof usage?.input === "number" ? { input: usage.input } : {}),
          ...(typeof usage?.output === "number" ? { output: usage.output } : {}),
        });
        delete message!.error;
        delete message!.abortObserved;
        this.#append(worker, "progress", activeId, undefined, undefined, { telemetry: this.#telemetry(worker, message!) });
      }
      return;
    }
    if (event.type === "agent_end" && event.willRetry !== true) this.#completeActive(worker);
  }

  #activateQueued(worker: WorkerState, messageId: string): void {
    if (worker.summary.activeMessageId && worker.summary.activeMessageId !== messageId) {
      this.#completeActive(worker);
    }
    const message = worker.messages.get(messageId);
    if (!message) return;
    worker.queue = worker.queue.filter((id) => id !== messageId);
    worker.summary.queuedMessageIds = worker.summary.queuedMessageIds.filter((id) => id !== messageId);
    message.status = "running";
    worker.summary.status = "running";
    worker.summary.activeMessageId = messageId;
    this.#append(worker, "turn.started", messageId);
  }

  #completeActive(worker: WorkerState): void {
    const activeId = worker.summary.activeMessageId;
    if (!activeId) return;
    const message = worker.messages.get(activeId);
    if (!message) return;
    message.stoppedAt ??= this.#now();
    if (message.error || message.abortRequested) {
      message.status = message.abortObserved || message.abortRequested ? "canceled" : "failed";
      message.error ??= "Worker turn settled after abort";
      message.reject(message.failure ?? new Error(message.error));
      this.#append(worker, "turn.failed", activeId, undefined, message.error);
      if (message.status === "canceled") {
        for (const queuedId of worker.queue) {
          const queued = worker.messages.get(queuedId);
          if (!queued) continue;
          queued.status = "canceled";
          queued.error = "Queued message canceled by abort";
          queued.structuredFailure = projectFailure({ code: "HP-PERSISTENT-MESSAGE-CANCELED", boundary: "persistent-worker", stage: "cancellation", message: queued.error, remediation: "Resubmit the message after the worker is idle.", messageId: queued.messageId });
          queued.reject(new Error(queued.error));
          this.#append(worker, "message.canceled", queuedId, undefined, queued.error);
        }
        worker.queue = [];
        worker.summary.queuedMessageIds = [];
      }
    } else {
      message.status = "completed";
      message.resolve(message);
      this.#append(worker, "turn.completed", activeId, message.latestAssistantSummary ?? "");
    }
    delete worker.summary.activeMessageId;
    if (worker.queue.length === 0 && worker.summary.status !== "destroying") {
      worker.summary.status = "idle";
    }
  }

  #processExit(worker: WorkerState, code: number | null, signal: NodeJS.Signals | null): void {
    worker.exited = true;
    if (worker.destroyRequested) return;
    const error = `Persistent worker exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`;
    const failure = projectFailure({ code: "HP-PERSISTENT-WORKER-EXIT", boundary: "persistent-worker", stage: "worker-exit", message: error, remediation: "Inspect the worker event stream and restart the worker.", retryable: true, workerId: worker.summary.workerId });
    worker.summary.status = "failed";
    worker.summary.error = error;
    worker.summary.failure = failure;
    this.#append(worker, "worker.failed", worker.summary.activeMessageId, undefined, error);
    for (const message of worker.messages.values()) {
      if (message.status === "running" || message.status === "queued" || message.status === "accepted") {
        message.status = "failed";
        message.error = error;
        message.structuredFailure = projectFailure({ ...failure, message: error, messageId: message.messageId });
        message.reject(new Error(error));
      }
    }
  }
}
