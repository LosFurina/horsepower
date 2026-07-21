import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { discoverAgents, type AgentDefinition } from "../agents/catalog.js";
import { resolveHorsepowerPaths } from "../config/paths.js";
import { createHandoffStore } from "../handoffs/store.js";
import { createRunLifecycle } from "../lifecycle/run-lifecycle.js";
import { createReviewCampaignManager } from "../lifecycle/review-campaign.js";
import { createImplementationCampaignManager, type ImplementationMode, type WorkKind } from "../lifecycle/implementation-campaign.js";
import { resolveOutputLocale } from "../localization/index.js";
import { createWebhookNotifier, type WebhookNotifierOptions } from "../lifecycle/webhook-notifier.js";
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
  webhook?: WebhookNotifierOptions & {
    notifications?: { change?: boolean; dispatch?: boolean };
  };
  resolveWebhook?: (cwd: string) => (WebhookNotifierOptions & {
    notifications?: { change?: boolean; dispatch?: boolean };
  }) | undefined;
  oneShot?: ReturnType<typeof createOneShotExecutor>;
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
  readonly #reviews = createReviewCampaignManager();
  readonly #implementations = createImplementationCampaignManager();
  readonly #boundary: ReturnType<typeof createOpenSpecBoundary>;
  readonly #notifiers = new Set<ReturnType<typeof createWebhookNotifier>>();
  readonly #operations = new Set<Promise<unknown>>();
  #closed = false;
  #shutdown?: Promise<void>;

  constructor(options: CreateHorsepowerRuntimeOptions) {
    this.#options = options;
    this.#manager = options.manager ?? new PersistentWorkerManager({ startWorker: createPersistentWorkerStarter() });
    const notifier = options.webhook ? createWebhookNotifier(options.webhook) : undefined;
    if (notifier) this.#notifiers.add(notifier);
    this.#lifecycle = createRunLifecycle({
      ...(options.webhook?.notifications ? { notifications: options.webhook.notifications } : {}),
      ...(notifier ? { notify: (event) => notifier.notify(event) } : {}),
      stopNotifications: () => {
        for (const active of this.#notifiers) active.abandon();
      },
    });
    const readText = options.readText ?? ((path: string) => readFile(path, "utf8"));
    this.#boundary = createOpenSpecBoundary({ run: options.runOpenSpec ?? createOpenSpecCliRunner(), readText });
  }

  async beginImplementationCampaign(input: { changeId: string; projectId: string; taskScopes: string[]; mode: ImplementationMode }) {
    const projectId = await realpath(resolve(input.projectId)).catch(() => resolve(input.projectId));
    return this.#implementations.begin({ ...input, projectId });
  }

  async authorizeImplementationReviewer(input: { campaignId: string; projectId: string; reviewCampaignId: string; acceptanceScope: string; budget: number }) {
    const projectId = await realpath(resolve(input.projectId)).catch(() => resolve(input.projectId));
    return this.#implementations.authorizeReviewer({ ...input, projectId });
  }

  execute(input: unknown, context: HorsepowerRuntimeContext): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("Horsepower runtime is closed"));
    return this.#track(this.#execute(input, context));
  }

  #track<T>(operation: Promise<T>): Promise<T> {
    this.#operations.add(operation);
    void operation.then(
      () => this.#operations.delete(operation),
      () => this.#operations.delete(operation),
    );
    return operation;
  }

  async #execute(input: unknown, context: HorsepowerRuntimeContext): Promise<unknown> {
    const raw = input as Record<string, unknown>;
    const cwd = resolve(context.cwd);
    const projectId = await realpath(cwd).catch(() => cwd);
    const paths = resolveHorsepowerPaths({ homeDir: this.#options.homeDir, projectDir: cwd });
    const readText = this.#options.readText ?? ((path: string) => readFile(path, "utf8"));
    const safe = new Set(["status", "list", "read", "abort", "destroy", "doctor", "review_campaign_status"]);
    const lifecycleOnly = new Set(["begin_change", "report_terminal", "begin_review_campaign", "record_review_finding", "extend_review_campaign", "end_review_campaign"]);
    if (!safe.has(String(raw.action))) {
      if (!context.captain) throw new Error(`Captain capability is required for ${String(raw.action)}`);
      await this.#boundary.authorize({
        action: raw.action as never,
        cwd,
        ...(typeof raw.changeId === "string" ? { changeId: raw.changeId } : {}),
      });
    }
    const workProducing = new Set(["single", "parallel", "chain", "create", "send", "steer"]);
    if (workProducing.has(String(raw.action))) {
      const campaignId = typeof raw.implementationCampaignId === "string" ? raw.implementationCampaignId : "";
      const taskScope = typeof raw.taskScope === "string" ? raw.taskScope : "";
      const workKind = typeof raw.workKind === "string" ? raw.workKind as WorkKind : undefined;
      if (!campaignId || !taskScope || !workKind) {
        throw new Error("Work requires a user-selected implementation campaign: choose multi_agent or main_agent with /horsepower-campaign");
      }
      this.#implementations.authorizeDispatch({
        campaignId, changeId: String(raw.changeId), projectId, taskScope, workKind,
        ...(typeof raw.reviewCampaignId === "string" ? { reviewCampaignId: raw.reviewCampaignId } : {}),
      });
    }
    let slots: ReturnType<typeof createSlotRegistry> | undefined;
    let catalog: Map<string, AgentDefinition> | undefined;
    if (!safe.has(String(raw.action)) && !lifecycleOnly.has(String(raw.action))) {
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
    const outputLocale = await resolveOutputLocale(paths.global.settings, paths.project.settings);
    const oneShot = this.#options.oneShot ?? createOneShotExecutor({ run: createPiJsonRunner() });
    const handoffs = createHandoffStore({ stateRoot: resolve(paths.global.root, "state") });
    const bindNotification = (scope: "change" | "dispatch") => {
      const webhook = this.#options.resolveWebhook?.(cwd);
      if (!webhook) return undefined;
      const enabled = webhook.notifications?.[scope] ?? (scope === "change");
      if (!enabled) return { enabled: false, outputLocale };
      const active = createWebhookNotifier(webhook);
      this.#notifiers.add(active);
      return {
        enabled: true,
        outputLocale,
        notify: async (event: Parameters<ReturnType<typeof createWebhookNotifier>["notify"]>[0]) => {
          try {
            return await active.notify(event);
          } finally {
            this.#notifiers.delete(active);
          }
        },
      };
    };
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
      beginChange: (change) => this.#lifecycle.beginChange(change, bindNotification("change")),
      beginDispatch: (dispatch) => this.#lifecycle.beginDispatch(dispatch, bindNotification("dispatch")),
      oneShot,
      sendWorker: (send) => this.#manager.send(send as never),
      waitForMessage: (workerId, messageId) => this.#manager.waitForMessage(workerId, messageId),
      messageStatus: (workerId, messageId) => this.#manager.messageStatus(workerId, messageId) as "completed" | "failed" | "canceled",
      statusWorker: (workerId) => this.#manager.status(workerId),
      associateHandoff: (workerId, runId) => this.#manager.associateHandoff(workerId, runId),
      listWorkers: () => this.#manager.list(),
      readWorker: (workerId, options) => this.#manager.read(workerId, options),
      abortWorker: (workerId) => this.#manager.abort(workerId),
      destroyWorker: (workerId, force) => this.#manager.destroy(workerId, force),
      doctor: () => ({ generation: "process", workers: this.#manager.list().length }),
      reportDispatchTerminal: (report) => this.#lifecycle.reportDispatchTerminal(report),
      reportChangeTerminal: (report) => this.#lifecycle.reportChangeTerminal(report),
      identityForRun: (runId) => this.#lifecycle.identity(runId),
      projectId,
      createHandoff: (input) => handoffs.create(input),
      prepareHandoffMessage: (input) => handoffs.prepareMessage(input),
      validateHandoffReport: (input) => handoffs.validateReport(input),
      recordHandoffTerminal: (input) => handoffs.recordTerminal(input),
      beginReviewCampaign: (input) => this.#reviews.begin(input),
      consumeReviewCampaign: (input) => this.#reviews.consume(input),
      recordReviewFinding: (input) => this.#reviews.recordFinding(input),
      extendReviewCampaign: (input) => this.#reviews.extend(input),
      endReviewCampaign: (input) => this.#reviews.end(input),
      reviewCampaignStatus: (campaignId, campaignProjectId) => this.#reviews.status(campaignId, campaignProjectId),
      trackSettlement: (settlement) => { this.#track(settlement); },
    });
    return orchestration.execute({ ...raw, cwd }, { captain: context.captain });
  }

  shutdown(): Promise<void> {
    this.#closed = true;
    if (this.#shutdown) return this.#shutdown;
    this.#shutdown = (async () => {
      while (this.#operations.size > 0) {
        await Promise.allSettled([...this.#operations]);
      }
      const results: PromiseSettledResult<void>[] = [];
      try {
        await this.#lifecycle.shutdown();
        results.push({ status: "fulfilled", value: undefined });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }
      try {
        await this.#manager.destroyAll();
        results.push({ status: "fulfilled", value: undefined });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(failures.map((failure) => failure.reason), "Failed to shut down Horsepower runtime");
      }
    })();
    return this.#shutdown;
  }

  abandon(): void {
    this.#closed = true;
    this.#lifecycle.abandon();
    this.#manager.abandonAll();
  }
}

export function createHorsepowerRuntime(options: CreateHorsepowerRuntimeOptions): HorsepowerRuntime {
  return new HorsepowerRuntime(options);
}
