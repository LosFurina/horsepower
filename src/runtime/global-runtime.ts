import { randomUUID } from "node:crypto";

export const RUNTIME_SYMBOL = Symbol.for("horsepower.runtime");

export interface GlobalRuntimeValue {
  shutdown(): Promise<void>;
  abandon(): void;
}

export interface RuntimeRecord<T extends GlobalRuntimeValue> {
  generation: string;
  value: T;
  cleanup?: Promise<void>;
  abandoned: boolean;
  handlers?: Readonly<Record<"exit" | "SIGHUP" | "SIGINT" | "SIGTERM", () => void>>;
}

interface ProcessEvents {
  on(event: "exit" | NodeJS.Signals, handler: () => void): unknown;
  off(event: "exit" | NodeJS.Signals, handler: () => void): unknown;
}

export interface AcquireGlobalRuntimeOptions<T extends GlobalRuntimeValue> {
  host?: Record<PropertyKey, unknown>;
  events?: ProcessEvents;
  create(): T;
  makeGeneration?: () => string;
  terminate?: (signal: NodeJS.Signals) => void;
}

export interface RuntimeLease<T extends GlobalRuntimeValue> {
  generation: string;
  value: T;
  cleanup(): Promise<void>;
  abandon(): void;
}

function current<T extends GlobalRuntimeValue>(host: Record<PropertyKey, unknown>): RuntimeRecord<T> | undefined {
  return host[RUNTIME_SYMBOL] as RuntimeRecord<T> | undefined;
}

function removeHandlers(
  record: RuntimeRecord<GlobalRuntimeValue>,
  events: ProcessEvents,
  includeExit = true,
): void {
  if (!record.handlers) return;
  for (const [event, handler] of Object.entries(record.handlers)) {
    if (!includeExit && event === "exit") continue;
    events.off(event as "exit" | NodeJS.Signals, handler);
  }
}

export function acquireGlobalRuntime<T extends GlobalRuntimeValue>(
  options: AcquireGlobalRuntimeOptions<T>,
): RuntimeLease<T> {
  const host = options.host ?? globalThis as Record<PropertyKey, unknown>;
  const events = options.events ?? process;
  let record = current<T>(host);
  if (!record) {
    record = {
      generation: options.makeGeneration?.() ?? randomUUID(),
      value: options.create(),
      abandoned: false,
    };
    host[RUNTIME_SYMBOL] = record;
    const abandon = () => abandonGeneration(host, record!, events, true);
    const terminate = options.terminate ?? ((signal: NodeJS.Signals) => process.kill(process.pid, signal));
    const signal = (name: NodeJS.Signals) => () => {
      void cleanupGeneration(host, record!, events).catch(() => undefined).finally(() => terminate(name));
    };
    record.handlers = {
      exit: abandon,
      SIGHUP: signal("SIGHUP"),
      SIGINT: signal("SIGINT"),
      SIGTERM: signal("SIGTERM"),
    };
    for (const [event, handler] of Object.entries(record.handlers)) {
      events.on(event as "exit" | NodeJS.Signals, handler);
    }
  }
  const acquired = record;
  return {
    generation: acquired.generation,
    value: acquired.value,
    cleanup: () => cleanupGeneration(host, acquired, events),
    abandon: () => abandonGeneration(host, acquired, events),
  };
}

async function cleanupGeneration<T extends GlobalRuntimeValue>(
  host: Record<PropertyKey, unknown>,
  record: RuntimeRecord<T>,
  events: ProcessEvents,
): Promise<void> {
  if (record.cleanup) return record.cleanup;
  if (current(host) !== record || record.abandoned) return;
  delete host[RUNTIME_SYMBOL];
  // Signals are no longer useful once graceful cleanup begins, but exit must
  // remain as a synchronous backstop until shutdown settles.
  removeHandlers(record, events, false);
  record.cleanup = record.value.shutdown().finally(() => {
    removeHandlers(record!, events);
  });
  return record.cleanup;
}

function abandonGeneration<T extends GlobalRuntimeValue>(
  host: Record<PropertyKey, unknown>,
  record: RuntimeRecord<T>,
  events: ProcessEvents,
  duringExit = false,
): void {
  const owner = current(host);
  const ownsPendingCleanup = duringExit && record.cleanup !== undefined;
  if ((owner !== record && !ownsPendingCleanup) || record.abandoned || (record.cleanup && !duringExit)) return;
  record.abandoned = true;
  if (owner === record) delete host[RUNTIME_SYMBOL];
  removeHandlers(record, events);
  record.value.abandon();
}

export function replaceGlobalRuntimeForTest<T extends GlobalRuntimeValue>(
  host: Record<PropertyKey, unknown>,
  value: T,
): { record: RuntimeRecord<T> } {
  const record: RuntimeRecord<T> = { generation: randomUUID(), value, abandoned: false };
  host[RUNTIME_SYMBOL] = record;
  return { record };
}
