import { readFile } from "node:fs/promises";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { discoverAgents, type AgentDefinition } from "../agents/catalog.js";
import { resolveHorsepowerPaths } from "../config/paths.js";
import { createRunLifecycle } from "../lifecycle/run-lifecycle.js";
import { createOpenSpecBoundary } from "../openspec/boundary.js";
import { createOpenSpecCliRunner } from "../openspec/cli-runner.js";
import { createOrchestration } from "../orchestration/facade.js";
import { createOneShotExecutor } from "../runtime/one-shot.js";
import { createPiJsonRunner } from "../runtime/one-shot-runner.js";
import { PersistentWorkerManager } from "../runtime/persistent-manager.js";
import { createPersistentWorkerStarter } from "../runtime/persistent-worker-connection.js";
import { createSlotRegistry, thinkingLevels, type ModelCatalog, type SlotConfiguration } from "../slots/registry.js";

export interface HorsepowerRuntimeContext {
  captain: boolean;
  cwd: string;
  modelRegistry: Pick<ModelRegistry, "getAll">;
}

export interface CreateHorsepowerRuntimeOptions {
  homeDir: string;
  bundledAgentsDir: string;
  readText?: (path: string) => Promise<string>;
  runOpenSpec?: ReturnType<typeof createOpenSpecCliRunner>;
  manager?: PersistentWorkerManager;
}

async function optionalJson(path: string, readText: (path: string) => Promise<string>): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await readText(path));
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error(`Expected a JSON object in ${path}`);
    }
    return value as Record<string, unknown>;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {};
    if (cause instanceof SyntaxError) throw new Error(`Malformed JSON in ${path}`);
    throw cause;
  }
}

function modelCatalog(registry: HorsepowerRuntimeContext["modelRegistry"]): ModelCatalog {
  return Object.fromEntries(registry.getAll().map((model) => {
    const levels = model.reasoning ? thinkingLevels : ["off"] as const;
    return [`${model.provider}/${model.id}`, { thinkingLevels: levels }];
  }));
}

export class HorsepowerRuntime {
  readonly #options: CreateHorsepowerRuntimeOptions;
  readonly #manager: PersistentWorkerManager;
  readonly #lifecycle: ReturnType<typeof createRunLifecycle>;
  readonly #boundary: ReturnType<typeof createOpenSpecBoundary>;
  #shutdown?: Promise<void>;

  constructor(options: CreateHorsepowerRuntimeOptions) {
    this.#options = options;
    this.#manager = options.manager ?? new PersistentWorkerManager({ startWorker: createPersistentWorkerStarter() });
    this.#lifecycle = createRunLifecycle({});
    const readText = options.readText ?? ((path: string) => readFile(path, "utf8"));
    this.#boundary = createOpenSpecBoundary({ run: options.runOpenSpec ?? createOpenSpecCliRunner(), readText });
  }

  async execute(input: unknown, context: HorsepowerRuntimeContext): Promise<unknown> {
    const raw = input as Record<string, unknown>;
    const cwd = context.cwd;
    const paths = resolveHorsepowerPaths({ homeDir: this.#options.homeDir, projectDir: cwd });
    const readText = this.#options.readText ?? ((path: string) => readFile(path, "utf8"));
    const safe = new Set(["status", "list", "read", "abort", "destroy", "doctor"]);
    if (!safe.has(String(raw.action))) {
      if (!context.captain) throw new Error(`Captain capability is required for ${String(raw.action)}`);
      await this.#boundary.authorize({
        action: raw.action as never,
        cwd,
        ...(typeof raw.changeId === "string" ? { changeId: raw.changeId } : {}),
      });
    }
    let slots: ReturnType<typeof createSlotRegistry> | undefined;
    let catalog: Map<string, AgentDefinition> | undefined;
    if (!safe.has(String(raw.action))) {
      const [globalSlots, projectSlots, agents] = await Promise.all([
        optionalJson(paths.global.modelSlots, readText),
        optionalJson(paths.project.modelSlots, readText),
        discoverAgents({
          bundledDir: this.#options.bundledAgentsDir,
          globalDir: paths.global.agents,
          projectDir: paths.project.agents,
        }),
      ]);
      slots = createSlotRegistry({
        global: globalSlots as SlotConfiguration,
        project: projectSlots as SlotConfiguration,
        models: modelCatalog(context.modelRegistry),
      });
      catalog = new Map(agents.map((agent) => [agent.name, agent]));
    }
    const oneShot = createOneShotExecutor({ run: createPiJsonRunner() });
    const orchestration = createOrchestration({
      authorize: async () => undefined,
      resolveSlot: (slot) => {
        if (!slots) throw new Error("Model slots are unavailable for this action");
        return slots.resolve(slot);
      },
      validateModel: () => undefined,
      getAgent: (name) => {
        const agent = catalog?.get(name);
        if (!agent) throw new Error(`Unknown agent: ${name}`);
        return agent;
      },
      createWorker: (worker) => this.#manager.create(worker),
      beginDispatch: (dispatch) => this.#lifecycle.beginDispatch(dispatch),
      oneShot,
      sendWorker: (send) => this.#manager.send(send as never),
      waitForMessage: (workerId, messageId) => this.#manager.waitForMessage(workerId, messageId),
      messageStatus: (workerId, messageId) => this.#manager.messageStatus(workerId, messageId) as "completed" | "failed" | "canceled",
      statusWorker: (workerId) => this.#manager.status(workerId),
      listWorkers: () => this.#manager.list(),
      readWorker: (workerId, options) => this.#manager.read(workerId, options),
      abortWorker: (workerId) => this.#manager.abort(workerId),
      destroyWorker: (workerId, force) => this.#manager.destroy(workerId, force),
      doctor: () => ({ generation: "process", workers: this.#manager.list().length }),
      reportDispatchTerminal: (report) => this.#lifecycle.reportDispatchTerminal(report),
      reportChangeTerminal: (report) => this.#lifecycle.reportChangeTerminal(report),
      changeIdForRun: (runId) => this.#lifecycle.status(runId).changeId,
    });
    return orchestration.execute({ ...raw, cwd }, { captain: context.captain });
  }

  shutdown(): Promise<void> {
    this.#shutdown ??= Promise.allSettled([
      this.#manager.destroyAll(),
      this.#lifecycle.shutdown(),
    ]).then((results) => {
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(failures.map((failure) => failure.reason), "Failed to shut down Horsepower runtime");
      }
    });
    return this.#shutdown;
  }

  abandon(): void {
    this.#lifecycle.abandon();
    this.#manager.abandonAll();
  }
}

export function createHorsepowerRuntime(options: CreateHorsepowerRuntimeOptions): HorsepowerRuntime {
  return new HorsepowerRuntime(options);
}
