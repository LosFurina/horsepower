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
import { capabilityRejectionError } from "../runtime/capability-rejection.js";
import { PersistentWorkerManager } from "../runtime/persistent-manager.js";
import { createPersistentWorkerStarter } from "../runtime/persistent-worker-connection.js";
import { createCapabilityEvidenceCache } from "../capabilities/evidence-cache.js";
import { createPiModelCatalog } from "../capabilities/model-catalog.js";
import type { ModelCapabilityProbe } from "../runtime/model-capability-probe.js";
import { createPiCapabilityProbe } from "../runtime/pi-capability-probe.js";
import { createPreLaunchCapabilityGate } from "../runtime/pre-launch-capability-gate.js";
import { createSlotRegistry, type SlotConfiguration } from "../slots/registry.js";

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
  capabilityProbe?: ModelCapabilityProbe;
}

interface ToolFailureMetadata { code: string; boundary: string; remediation: string }
function toolFailure(metadata: ToolFailureMetadata, cause: unknown): Error & { horsepowerFailure: ToolFailureMetadata } {
  if (cause instanceof Error && "horsepowerFailure" in cause) return cause as Error & { horsepowerFailure: ToolFailureMetadata };
  if (cause instanceof Error) return Object.assign(cause, { horsepowerFailure: metadata });
  return Object.assign(new Error(String(cause), { cause }), { horsepowerFailure: metadata });
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

export class HorsepowerRuntime {
  readonly #options: CreateHorsepowerRuntimeOptions;
  readonly #manager: PersistentWorkerManager;
  readonly #lifecycle: ReturnType<typeof createRunLifecycle>;
  readonly #reviews = createReviewCampaignManager();
  readonly #implementations = createImplementationCampaignManager();
  readonly #capabilityGate: ReturnType<typeof createPreLaunchCapabilityGate>;
  readonly #boundary: ReturnType<typeof createOpenSpecBoundary>;
  readonly #notifiers = new Set<ReturnType<typeof createWebhookNotifier>>();
  readonly #operations = new Set<Promise<unknown>>();
  #closed = false;
  #shutdown?: Promise<void>;

  constructor(options: CreateHorsepowerRuntimeOptions) {
    this.#options = options;
    this.#manager = options.manager ?? new PersistentWorkerManager({ startWorker: createPersistentWorkerStarter() });
    this.#capabilityGate = createPreLaunchCapabilityGate({
      cache: createCapabilityEvidenceCache(),
      probe: options.capabilityProbe ?? createPiCapabilityProbe(),
    });
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
    const requestedProjectId = resolve(input.projectId);
    const projectId = await realpath(requestedProjectId).catch(() => requestedProjectId);
    await this.#boundary.authorize({ action: "begin_change", cwd: requestedProjectId, changeId: input.changeId });
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
      try {
        await this.#boundary.authorize({
          action: raw.action as never,
          cwd,
          ...(typeof raw.changeId === "string" ? { changeId: raw.changeId } : {}),
        });
      } catch (cause) {
        throw toolFailure({ code: "OPENSPEC_BOUNDARY_FAILED", boundary: "openspec", remediation: "Run openspec doctor and resolve the reported project problem before retrying." }, cause);
      }
    }
    const workProducing = new Set(["single", "parallel", "chain", "create", "send", "steer"]);
    if (workProducing.has(String(raw.action))) {
      const campaignId = typeof raw.implementationCampaignId === "string" ? raw.implementationCampaignId : "";
      const taskScope = typeof raw.taskScope === "string" ? raw.taskScope : "";
      const workKind = typeof raw.workKind === "string" ? raw.workKind as WorkKind : undefined;
      if (!campaignId || !taskScope || !workKind) {
        throw toolFailure(
          { code: "CAMPAIGN_AUTHORIZATION_FAILED", boundary: "campaign", remediation: "Select a valid implementation campaign and retry with an authorized change and task scope." },
          new Error("Work requires a user-selected implementation campaign: choose multi_agent or main_agent with /horsepower-campaign"),
        );
      }
      try {
        this.#implementations.authorizeDispatch({
          campaignId, changeId: String(raw.changeId), projectId, taskScope, workKind,
          ...(typeof raw.reviewCampaignId === "string" ? { reviewCampaignId: raw.reviewCampaignId } : {}),
        });
      } catch (cause) {
        throw toolFailure({ code: "CAMPAIGN_AUTHORIZATION_FAILED", boundary: "campaign", remediation: "Select a valid implementation campaign and retry with an authorized change and task scope." }, cause);
      }
    }
    let slots: ReturnType<typeof createSlotRegistry> | undefined;
    let piCatalog: ReturnType<typeof createPiModelCatalog> | undefined;
    let catalog: Map<string, AgentDefinition> | undefined;
    if (!safe.has(String(raw.action)) && !lifecycleOnly.has(String(raw.action))) {
      const agentFailure = { code: "AGENT_CATALOG_FAILED", boundary: "agent_catalog", remediation: "Run horsepower doctor --json and repair the bundled or overridden agent catalog before retrying." };
      const [globalSlots, projectSlots, agents] = await Promise.all([
        optionalJson(paths.global.modelSlots, readText),
        optionalJson(paths.project.modelSlots, readText),
        discoverAgents({
          bundledDir: this.#options.bundledAgentsDir,
          globalDir: paths.global.agents,
          projectDir: paths.project.agents,
        }).catch((cause) => { throw toolFailure(agentFailure, cause); }),
      ]);
      piCatalog = createPiModelCatalog(context.modelRegistry);
      slots = createSlotRegistry({
        global: globalSlots as SlotConfiguration,
        project: projectSlots as SlotConfiguration,
        ...(piCatalog.status === "available" ? { models: piCatalog.models } : {}),
      });
      catalog = new Map(agents.map((agent) => [agent.name, agent]));
    }
    const outputLocale = await resolveOutputLocale(paths.global.settings, paths.project.settings);
    const oneShotSource = this.#options.oneShot ?? createOneShotExecutor({ run: createPiJsonRunner() });
    const processFailure = { code: "WORKER_PROCESS_FAILED", boundary: "process", remediation: "Run horsepower doctor --json, inspect the process evidence, and retry the dispatch." };
    const oneShot = {
      single: async (invocation: Parameters<typeof oneShotSource.single>[0]) => oneShotSource.single(invocation).catch((cause) => { throw capabilityRejectionError(cause) ?? toolFailure(processFailure, cause); }),
      parallel: async (invocations: Parameters<typeof oneShotSource.parallel>[0]) => oneShotSource.parallel(invocations).catch((cause) => { throw capabilityRejectionError(cause) ?? toolFailure(processFailure, cause); }),
      chain: async (invocations: Parameters<typeof oneShotSource.chain>[0]) => oneShotSource.chain(invocations).catch((cause) => { throw capabilityRejectionError(cause) ?? toolFailure(processFailure, cause); }),
    };
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
        try {
          if (!slots) throw new Error("Model slots are unavailable for this action");
          return slots.resolve(slot);
        } catch (cause) {
          throw toolFailure({ code: "MODEL_CONFIGURATION_FAILED", boundary: "model_configuration", remediation: "Run horsepower setup --interactive to configure the required model slot before retrying." }, cause);
        }
      },
      validateModel: () => undefined,
      validateCapability: async (slot) => {
        const modelFailure = { code: "MODEL_CAPABILITY_FAILED", boundary: "model_capability", remediation: "Run horsepower setup --interactive to validate or reconfigure the selected model slot." };
        try {
          if (!piCatalog || piCatalog.status !== "available") {
            throw new Error("MODEL_CATALOG_UNAVAILABLE: current Pi model catalog cannot be established");
          }
          await this.#capabilityGate.ensure(
            { model: slot.model, thinking: slot.thinking, catalogRevision: piCatalog.revision },
            piCatalog.models[slot.model]?.thinkingLevels,
          );
        } catch (cause) {
          throw toolFailure(modelFailure, cause);
        }
      },
      handleWorkerCapabilityRejection: (slot, cause) => {
        if (!piCatalog || piCatalog.status !== "available") return undefined;
        const failure = this.#capabilityGate.handleWorkerRejection(
          { model: slot.model, thinking: slot.thinking, catalogRevision: piCatalog.revision },
          cause,
        );
        return failure ? toolFailure({ code: "MODEL_CAPABILITY_FAILED", boundary: "model_capability", remediation: "Run horsepower setup --interactive to validate or reconfigure the selected model slot." }, failure) : undefined;
      },
      getAgent: (name) => {
        const agent = catalog?.get(name);
        if (!agent) throw toolFailure({ code: "AGENT_CATALOG_FAILED", boundary: "agent_catalog", remediation: "Run horsepower doctor --json and repair the bundled or overridden agent catalog before retrying." }, new Error(`Unknown agent: ${name}`));
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
      createHandoff: (input) => handoffs.create(input).catch((cause) => { throw toolFailure({ code: "HANDOFF_FAILED", boundary: "handoff", remediation: "Inspect the managed handoff evidence and retry the bounded dispatch." }, cause); }),
      prepareHandoffMessage: (input) => handoffs.prepareMessage(input).catch((cause) => { throw toolFailure({ code: "HANDOFF_FAILED", boundary: "handoff", remediation: "Inspect the managed handoff evidence and retry the bounded dispatch." }, cause); }),
      validateHandoffReport: (input) => handoffs.validateReport(input).catch((cause) => { throw toolFailure({ code: "HANDOFF_FAILED", boundary: "handoff", remediation: "Inspect the managed handoff evidence and retry the bounded dispatch." }, cause); }),
      recordHandoffTerminal: (input) => handoffs.recordTerminal(input).catch((cause) => { throw toolFailure({ code: "HANDOFF_FAILED", boundary: "handoff", remediation: "Inspect the managed handoff evidence and retry the bounded dispatch." }, cause); }),
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
