import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { discoverAgents, type AgentDefinition } from "../agents/catalog.js";
import { resolveHorsepowerPaths } from "../config/paths.js";
import { createHandoffStore } from "../handoffs/store.js";
import { createRunLifecycle } from "../lifecycle/run-lifecycle.js";
import { createReviewCampaignManager } from "../lifecycle/review-campaign.js";
import { createImplementationCampaignManager, type ContinuationLease, type ImplementationMode, type WorkKind } from "../lifecycle/implementation-campaign.js";
import type { AcceptanceSnapshot } from "../lifecycle/verification-gate.js";
import { resolveOutputLocale } from "../localization/index.js";
import { createWebhookNotifier, type WebhookNotifierOptions } from "../lifecycle/webhook-notifier.js";
import { createOpenSpecBoundary, type OpenSpecChangeCandidate } from "../openspec/boundary.js";
import type { OpenSpecTaskInventory } from "../openspec/task-inventory.js";
import { type OutputLocale } from "../localization/index.js";
import { createOpenSpecCliRunner } from "../openspec/cli-runner.js";
import { createOrchestration } from "../orchestration/facade.js";
import { createOneShotExecutor, type OneShotProgress, type WorkerIdentity } from "../runtime/one-shot.js";
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
  signal?: AbortSignal;
  onProgress?: (event: OneShotProgress & { identity: WorkerIdentity }) => void;
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
  loadTaskInventory?: (input: { cwd: string; changeId: string }) => Promise<OpenSpecTaskInventory>;
  discoverUnfinishedChanges?: (input: { cwd: string }) => Promise<OpenSpecChangeCandidate[]>;
  acceptanceSnapshot?: (input: { runId: string; changeId: string; projectId: string }) => AcceptanceSnapshot | Promise<AcceptanceSnapshot>;
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
      acceptanceSnapshot: async ({ runId, changeId, projectId }): Promise<AcceptanceSnapshot> => {
        const campaign = this.#implementations.activeCampaign(projectId, changeId);
        const snapshot: AcceptanceSnapshot = options.acceptanceSnapshot
          ? await options.acceptanceSnapshot({ runId, changeId, projectId })
          : await this.#boundary.snapshotAcceptance({ cwd: projectId, changeId, selectedTaskIds: campaign.selectedTaskIds, selectedTasks: campaign.selectedTasks, requireComplete: true });
        const expected = campaign.selectedTaskIds.map((id) => `task:${id}`);
        if (snapshot.refs.join("\0") !== expected.join("\0")) throw new Error("VERIFICATION_SCOPE_DRIFT: acceptance snapshot does not match the active implementation campaign");
        await this.#revalidateCampaignTasks({ campaignId: campaign.campaignId, changeId, projectId, cwd: projectId });
        return { digest: snapshot.digest, refs: snapshot.refs };
      },
    });
    const readText = options.readText ?? ((path: string) => readFile(path, "utf8"));
    this.#boundary = createOpenSpecBoundary({ run: options.runOpenSpec ?? createOpenSpecCliRunner(), readText });
  }

  async discoverImplementationChanges(input: { projectId: string }) {
    const cwd = resolve(input.projectId);
    return this.#options.discoverUnfinishedChanges
      ? this.#options.discoverUnfinishedChanges({ cwd })
      : this.#boundary.discoverUnfinishedChanges({ cwd });
  }

  async loadImplementationTaskInventory(input: { changeId: string; projectId: string }) {
    const requestedProjectId = resolve(input.projectId);
    await this.#boundary.authorize({ action: "begin_change", cwd: requestedProjectId, changeId: input.changeId });
    return this.#loadTaskInventory(requestedProjectId, input.changeId);
  }


  async beginImplementationCampaign(input: {
    changeId: string;
    projectId: string;
    selectedTaskIds: string[];
    selectedTasks: Array<{ id: string; description: string; status: "pending"; sectionId: string; checks?: string[] }>;
    inventoryDigest: string;
    mode: ImplementationMode;
    testingPrompt: string;
  } | {
    changeId: string;
    projectId: string;
    taskScopes: string[];
    mode: ImplementationMode;
  }) {
    if ("taskScopes" in input) {
      throw new Error("Campaign taskScopes are unsupported; select canonical unfinished OpenSpec task IDs with /horsepower-campaign");
    }
    const requestedProjectId = resolve(input.projectId);
    const projectId = await realpath(requestedProjectId).catch(() => requestedProjectId);
    await this.#boundary.authorize({ action: "begin_change", cwd: requestedProjectId, changeId: input.changeId });
    const inventory = await this.#loadTaskInventory(requestedProjectId, input.changeId);
    const inventoryProjectId = await realpath(resolve(inventory.projectRoot)).catch(() => resolve(inventory.projectRoot));
    if (inventory.changeId !== input.changeId || inventoryProjectId !== projectId) {
      throw new Error("OpenSpec task inventory ownership changed during campaign creation");
    }
    if (inventory.digest !== input.inventoryDigest) throw new Error("OpenSpec task inventory changed before campaign confirmation; run /horsepower-campaign again");
    if (!inventory.sections.some((section) => section.tasks.some((task) => task.status === "pending"))) throw new Error("OpenSpec change is no longer unfinished; run /horsepower-campaign again");
    const current = new Map(inventory.sections.flatMap((section) => section.tasks.map((task) => [task.id, { ...task, sectionTitle: section.title }] as const)));
    const selectedTasks = input.selectedTaskIds.map((id) => {
      const task = current.get(id);
      if (!task) throw new Error(`Unknown OpenSpec task ID: ${id}`);
      if (task.status !== "pending") throw new Error(`OpenSpec task is already complete: ${id}`);
      return task;
    });
    return this.#implementations.begin({
      changeId: input.changeId,
      projectId,
      selectedTaskIds: input.selectedTaskIds,
      selectedTasks,
      inventoryDigest: input.inventoryDigest,
      testing: { prompt: input.testingPrompt, selectedTaskChecks: selectedTasks.map((task) => ({ taskId: task.id, checks: task.checks ?? [] })) },
      mode: input.mode,
    });
  }

  clearCampaignContinuation(): void {
    this.#implementations.clearContinuation();
  }

  pauseCampaignContinuation(projectId: string): ContinuationLease | undefined {
    const normalized = resolve(projectId);
    const lease = this.#implementations.currentContinuation(normalized);
    if (!lease || lease.disposition !== "active") return undefined;
    this.#implementations.setContinuationDisposition(lease.campaignId, "paused");
    return this.#implementations.continuation(lease.campaignId, normalized);
  }

  currentCampaignContinuation(projectId: string): ContinuationLease | undefined {
    const normalized = resolve(projectId);
    return this.#implementations.currentContinuation(normalized);
  }

  async prepareCampaignContinuation(input: { campaignId: string; projectId: string; generation?: number }): Promise<ContinuationLease | undefined> {
    const projectId = await realpath(resolve(input.projectId)).catch(() => resolve(input.projectId));
    const lease = this.#implementations.continuation(input.campaignId, projectId);
    if (!lease || lease.disposition !== "active") return undefined;
    try {
      await this.#boundary.authorize({ action: "begin_change", cwd: projectId, changeId: lease.changeId });
      const inventory = await this.#loadTaskInventory(projectId, lease.changeId);
      const inventoryProjectId = await realpath(resolve(inventory.projectRoot)).catch(() => resolve(inventory.projectRoot));
      if (inventoryProjectId !== lease.projectId || inventory.changeId !== lease.changeId || inventory.digest !== lease.inventoryDigest) return undefined;
      const ordered = inventory.sections.flatMap((section) => section.tasks.map((task) => ({ ...task, sectionTitle: section.title })));
      const selectedOrder = ordered.filter((task) => lease.selectedTaskIds.includes(task.id)).map((task) => task.id);
      if (selectedOrder.join("\0") !== lease.selectedTaskIds.join("\0")) return undefined;
      const campaign = this.#implementations.status(lease.campaignId, lease.projectId);
      for (const selected of campaign.selectedTasks) {
        const current = ordered.find((task) => task.id === selected.id);
        if (!current || current.status !== "pending" || current.description !== selected.description || current.sectionId !== selected.sectionId || current.sectionTitle !== selected.sectionTitle) return undefined;
      }
      await this.#revalidateCampaignTasks({ campaignId: lease.campaignId, changeId: lease.changeId, projectId: lease.projectId, cwd: projectId, selectedTaskIds: lease.selectedTaskIds });
      return this.#implementations.beginContinuationGeneration(lease.campaignId, lease.projectId, input.generation);
    } catch { return undefined; }
  }

  async #loadTaskInventory(cwd: string, changeId: string): Promise<OpenSpecTaskInventory> {
    return this.#options.loadTaskInventory
      ? this.#options.loadTaskInventory({ cwd, changeId })
      : this.#boundary.loadTaskInventory({ cwd, changeId });
  }

  async #revalidateCampaignTasks(input: {
    campaignId: string;
    changeId: string;
    projectId: string;
    cwd: string;
    selectedTaskIds?: readonly string[];
  }): Promise<OpenSpecTaskInventory> {
    const campaign = this.#implementations.status(input.campaignId, input.projectId);
    if (campaign.changeId !== input.changeId) throw new Error(`Implementation campaign ${input.campaignId} belongs to change ${campaign.changeId}`);
    const inventory = await this.#loadTaskInventory(input.cwd, input.changeId);
    const selectedTaskIds = input.selectedTaskIds ?? campaign.selectedTaskIds;
    const ordered = inventory.sections.flatMap((section) => section.tasks.map((task) => ({ ...task, sectionTitle: section.title })));
    const selectedOrder = ordered.filter((task) => selectedTaskIds.includes(task.id)).map((task) => task.id);
    if (selectedOrder.join("\0") !== selectedTaskIds.join("\0")) throw new Error("Selected OpenSpec task ordering drifted; create a new implementation campaign");
    for (const selected of campaign.selectedTasks.filter((task) => selectedTaskIds.includes(task.id))) {
      const current = ordered.find((task) => task.id === selected.id);
      if (!current || current.status !== "pending" || current.description !== selected.description || current.sectionId !== selected.sectionId
        || current.sectionTitle !== selected.sectionTitle || JSON.stringify(current.checks ?? []) !== JSON.stringify(selected.checks ?? [])) {
        throw new Error(`Selected OpenSpec task drifted: ${selected.id}; create a new implementation campaign`);
      }
    }
    return inventory;
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
    const lifecycleOnly = new Set(["begin_change", "report_terminal", "begin_review_campaign", "record_review_finding", "disposition_review_finding", "resolve_review_finding", "extend_review_campaign", "end_review_campaign"]);
    const workProducing = new Set(["single", "parallel", "chain", "create", "send", "steer"]);
    if (workProducing.has(String(raw.action)) && context.signal?.aborted) {
      return { status: "canceled", action: String(raw.action), failure: {
        stage: "preflight", code: "DISPATCH_CANCELED", boundary: "cancellation",
        message: "Dispatch canceled before OpenSpec authorization or campaign accounting",
        remediation: "Start a new Captain turn and retry the explicit dispatch.",
      } };
    }
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
        const campaign = this.#implementations.status(campaignId, projectId);
        // Revalidate official selected tasks and checks before side effects.
        await this.#revalidateCampaignTasks({ campaignId, changeId: String(raw.changeId), projectId, cwd });
        const inventory = await this.#loadTaskInventory(cwd, String(raw.changeId));
        const inventoryProjectId = await realpath(resolve(inventory.projectRoot)).catch(() => resolve(inventory.projectRoot));
        if (inventory.changeId !== campaign.changeId || inventoryProjectId !== campaign.projectId || inventory.digest !== campaign.inventoryDigest) {
          throw new Error("OpenSpec task inventory ownership drifted; create a new implementation campaign");
        }
        const current = new Map(inventory.sections.flatMap((section) => section.tasks.map((task) => [task.id, { ...task, sectionTitle: section.title }] as const)));
        const currentSelectedOrder = inventory.sections.flatMap((section) => section.tasks).filter((task) => campaign.selectedTaskIds.includes(task.id)).map((task) => task.id);
        if (currentSelectedOrder.join("\0") !== campaign.selectedTaskIds.join("\0")) throw new Error("Selected OpenSpec task ordering drifted; create a new implementation campaign");
        for (const selected of campaign.selectedTasks) {
          const task = current.get(selected.id);
          if (!task || task.status !== "pending" || task.description !== selected.description || task.sectionId !== selected.sectionId || task.sectionTitle !== selected.sectionTitle) {
            throw new Error(`Selected OpenSpec task drifted: ${selected.id}; create a new implementation campaign`);
          }
        }
        if (typeof raw.reviewCampaignId === "string") {
          if (workKind !== "review" && workKind !== "fix") throw new Error("Review campaign dispatch must be review or fix work");
          const review = this.#reviews.validateDispatchAuthority({
            campaignId: raw.reviewCampaignId, changeId: String(raw.changeId), projectId, implementationCampaignId: campaignId, taskScope, kind: workKind,
            ...(workKind === "fix" && typeof raw.reviewFindingRootCauseId === "string" ? { rootCauseId: raw.reviewFindingRootCauseId } : {}),
          });
          if (campaign.mode === "main_agent") {
            const authorization = campaign.reviewerAuthorizations.find((item) => item.reviewCampaignId === raw.reviewCampaignId);
            if (!authorization || authorization.acceptanceScope !== review.acceptanceScope) throw new Error(`REVIEW_ACCEPTANCE_SCOPE_MISMATCH: ${raw.reviewCampaignId}`);
          }
        } else if (workKind === "review" || workKind === "fix") {
          throw new Error(`${workKind} work requires a review campaign`);
        }
        this.#implementations.validateDispatch({
          campaignId, changeId: String(raw.changeId), projectId, taskScope, workKind,
          ...(typeof raw.reviewCampaignId === "string" ? { reviewCampaignId: raw.reviewCampaignId } : {}),
          ...(typeof raw.reviewFindingRootCauseId === "string" ? { reviewFindingRootCauseId: raw.reviewFindingRootCauseId } : {}),
        });
        if (typeof raw.reviewCampaignId !== "string") this.#implementations.authorizeDispatch({ campaignId, changeId: String(raw.changeId), projectId, taskScope, workKind });
      } catch (cause) {
        const stableCode = cause instanceof Error ? /^([A-Z][A-Z0-9_]+):/u.exec(cause.message)?.[1] : undefined;
        throw toolFailure({
          code: stableCode?.startsWith("REVIEW_") ? stableCode : "CAMPAIGN_AUTHORIZATION_FAILED", boundary: "campaign",
          remediation: stableCode?.startsWith("REVIEW_")
            ? "Inspect and explicitly adjudicate the correlated review finding before retrying corrective dispatch."
            : "Select a valid implementation campaign and retry with an authorized change and task scope.",
        }, cause);
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
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.onProgress ? { onProgress: context.onProgress } : {}),
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
      reportChangeTerminal: async (report) => {
        const result = await this.#lifecycle.reportChangeTerminal(report);
        const identity = this.#lifecycle.identity(report.runId);
        try {
          const campaign = this.#implementations.activeCampaign(identity.projectId, identity.changeId);
          this.#implementations.setContinuationDisposition(campaign.campaignId, "terminal");
        } catch { /* no active campaign */ }
        return result;
      },
      identityForRun: (runId) => this.#lifecycle.identity(runId),
      projectId,
      createHandoff: (input) => handoffs.create(input).catch((cause) => { throw toolFailure({ code: "HANDOFF_FAILED", boundary: "handoff", remediation: "Inspect the managed handoff evidence and retry the bounded dispatch." }, cause); }),
      prepareHandoffMessage: (input) => handoffs.prepareMessage(input).catch((cause) => { throw toolFailure({ code: "HANDOFF_FAILED", boundary: "handoff", remediation: "Inspect the managed handoff evidence and retry the bounded dispatch." }, cause); }),
      validateHandoffReport: (input) => handoffs.validateReport(input).catch((cause) => { throw toolFailure({ code: "HANDOFF_FAILED", boundary: "handoff", remediation: "Inspect the managed handoff evidence and retry the bounded dispatch." }, cause); }),
      recordHandoffTerminal: (input) => handoffs.recordTerminal(input).catch((cause) => { throw toolFailure({ code: "HANDOFF_FAILED", boundary: "handoff", remediation: "Inspect the managed handoff evidence and retry the bounded dispatch." }, cause); }),
      beginReviewCampaign: (input) => {
        const implementation = this.#implementations.status(input.implementationCampaignId, input.projectId);
        if (implementation.status !== "active" || implementation.changeId !== input.changeId) throw new Error("Review campaign does not match an active implementation campaign");
        const requested = input.taskScope.split(",").map((id) => id.trim());
        if (!requested.length || requested.some((id) => !/^\d+(?:\.\d+)+$/u.test(id)) || new Set(requested).size !== requested.length) throw new Error("Review campaign requires unique exact OpenSpec task IDs");
        const canonical = implementation.selectedTaskIds.filter((id) => requested.includes(id));
        if (canonical.join("\0") !== requested.join("\0")) throw new Error("Review campaign task scope is outside or reordered from the implementation campaign");
        return this.#reviews.begin({ ...input, taskScope: canonical.join(",") });
      },
      consumeReviewCampaign: (input) => {
        const review = this.#reviews.consume(input);
        const implementationCampaignId = review.implementationCampaignId!;
        this.#implementations.authorizeDispatch({ campaignId: implementationCampaignId, changeId: input.changeId, projectId: input.projectId, taskScope: review.taskScope!, workKind: input.kind ?? "review", reviewCampaignId: input.campaignId, ...(input.rootCauseId ? { reviewFindingRootCauseId: input.rootCauseId } : {}) });
        return review;
      },
      recordReviewFinding: (input) => this.#reviews.recordFinding(input),
      dispositionReviewFinding: (input) => this.#reviews.dispositionFinding(input),
      resolveReviewFinding: (input) => this.#reviews.resolveFinding(input),
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
