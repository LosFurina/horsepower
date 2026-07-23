import { randomUUID } from "node:crypto";
import type { OpenSpecTask } from "../openspec/task-inventory.js";

export type ImplementationMode = "multi_agent" | "main_agent";
export type WorkKind = "implementation" | "research" | "test" | "fix" | "review";

interface ReviewerAuthorization {
  reviewCampaignId: string;
  acceptanceScope: string;
  budget: number;
  consumed: number;
  remaining: number;
}

export interface CampaignTaskSnapshot extends Pick<OpenSpecTask, "id" | "description" | "status" | "sectionId"> { sectionTitle?: string }

export interface CampaignPlanSnapshot {
  digest: string;
  testIntensity: "targeted" | "standard" | "exhaustive" | "custom";
  gateStrictness: "required" | "strict" | "release" | "custom";
  caseRefs: string[];
  gateRefs: string[];
  selectedTaskMappings: Array<{ taskId: string; caseRefs: string[]; gateRefs: string[]; nonApplicabilityRefs: string[] }>;
}

export interface ImplementationCampaign {
  campaignId: string;
  changeId: string;
  projectId: string;
  selectedTaskIds: string[];
  selectedTasks: CampaignTaskSnapshot[];
  inventoryDigest: string;
  plan: CampaignPlanSnapshot;
  mode: ImplementationMode;
  status: "active" | "ended";
  outcome?: "switched" | "ended";
  reviewerAuthorizations: ReviewerAuthorization[];
  dispatches: Array<{ taskIds: string[]; workKind: WorkKind; reviewCampaignId?: string; reviewFindingRootCauseId?: string }>;
  captainDirect: Array<{ taskIds: string[]; reason: string }>;
}

export interface ImplementationCampaignManagerOptions { makeId?: () => string }

export interface ContinuationLease {
  campaignId: string;
  projectId: string;
  changeId: string;
  selectedTaskIds: string[];
  inventoryDigest: string;
  planDigest: string;
  mode: ImplementationMode;
  generation: number;
  disposition: "active" | "paused" | "blocked" | "terminal" | "superseded";
  queuedGeneration?: number;
}

const taskIdPattern = /^\d+(?:\.\d+)+$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const planRefPattern = /^(?:TC|G|NA)-[1-9]\d*$/u;
// Must remain representable by the claim-matched verification manifest.
const MAX_SELECTED_TASKS = 100;

function text(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
function copy(campaign: ImplementationCampaign): ImplementationCampaign { return structuredClone(campaign); }

function planSnapshot(input: CampaignPlanSnapshot, selectedTaskIds: readonly string[]): CampaignPlanSnapshot {
  if (!digestPattern.test(input.digest)) throw new Error("Implementation test-and-gate plan digest is invalid");
  if (!["targeted", "standard", "exhaustive", "custom"].includes(input.testIntensity)) throw new Error("Implementation test intensity is invalid");
  if (!["required", "strict", "release", "custom"].includes(input.gateStrictness)) throw new Error("Implementation gate strictness is invalid");
  const refs = (values: readonly string[], prefix: "TC" | "G") => {
    if (!values.length || values.length > 100 || new Set(values).size !== values.length || values.some((value) => !planRefPattern.test(value) || !value.startsWith(`${prefix}-`))) throw new Error(`Implementation plan ${prefix} references are invalid`);
    return [...values];
  };
  const caseRefs = refs(input.caseRefs, "TC");
  const gateRefs = refs(input.gateRefs, "G");
  if (input.selectedTaskMappings.length !== selectedTaskIds.length) throw new Error("Implementation plan task mappings do not match selected tasks");
  const records = new Map(input.selectedTaskMappings.map((mapping) => [mapping.taskId, mapping]));
  if (records.size !== input.selectedTaskMappings.length) throw new Error("Implementation plan task mappings contain duplicate task IDs");
  const selectedTaskMappings = selectedTaskIds.map((taskId) => {
    const mapping = records.get(taskId);
    if (!mapping) throw new Error(`Implementation plan is missing selected task mapping: ${taskId}`);
    const mappedCases = [...mapping.caseRefs];
    const mappedGates = [...mapping.gateRefs];
    const nonApplicabilityRefs = [...mapping.nonApplicabilityRefs];
    if (new Set(mappedCases).size !== mappedCases.length || new Set(mappedGates).size !== mappedGates.length || new Set(nonApplicabilityRefs).size !== nonApplicabilityRefs.length
      || mappedCases.some((ref) => !caseRefs.includes(ref)) || mappedGates.some((ref) => !gateRefs.includes(ref))
      || nonApplicabilityRefs.some((ref) => !/^NA-[1-9]\d*$/u.test(ref))) throw new Error(`Implementation plan task mapping is invalid: ${taskId}`);
    if (!mappedCases.length && !nonApplicabilityRefs.length) throw new Error(`Implementation plan selected task is uncovered: ${taskId}`);
    return { taskId, caseRefs: mappedCases, gateRefs: mappedGates, nonApplicabilityRefs };
  });
  return { ...input, caseRefs, gateRefs, selectedTaskMappings };
}

function exactTaskIds(values: readonly string[], label: string): string[] {
  if (values.length === 0) throw new Error(`At least one ${label} is required`);
  if (values.length > MAX_SELECTED_TASKS) throw new Error(`${label} permits at most ${MAX_SELECTED_TASKS} task IDs`);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const id = text(raw, label);
    if (!taskIdPattern.test(id)) {
      throw new Error(`${label} must use exact OpenSpec task IDs; ranges and free-form scopes are unsupported: ${id}`);
    }
    if (!seen.has(id)) { seen.add(id); normalized.push(id); }
  }
  return normalized;
}

function requestedTaskIds(value: string): string[] {
  const raw = value.split(",").map((item) => item.trim());
  if (raw.some((item) => !item)) throw new Error("Dispatch task scope must be comma-separated exact OpenSpec task IDs");
  const ids = exactTaskIds(raw, "Dispatch task scope");
  if (ids.length !== raw.length) throw new Error("Dispatch task scope contains duplicate task IDs");
  return ids;
}

export function createImplementationCampaignManager(options: ImplementationCampaignManagerOptions = {}) {
  const campaigns = new Map<string, ImplementationCampaign>();
  let continuation: ContinuationLease | undefined;
  const makeId = options.makeId ?? (() => randomUUID());
  function required(id: string): ImplementationCampaign {
    const campaign = campaigns.get(id);
    if (!campaign) throw new Error(`Unknown implementation campaign: ${id}`);
    return campaign;
  }
  function owned(id: string, projectId: string): ImplementationCampaign {
    const campaign = required(id);
    if (campaign.projectId !== projectId) throw new Error(`Implementation campaign ${id} belongs to another project`);
    return campaign;
  }
  function active(id: string, changeId: string, projectId: string, taskScope: string): { campaign: ImplementationCampaign; taskIds: string[] } {
    const campaign = owned(id, projectId);
    if (campaign.status !== "active") throw new Error(`Implementation campaign ${id} is not active`);
    if (campaign.changeId !== changeId) throw new Error(`Implementation campaign ${id} belongs to change ${campaign.changeId}`);
    const taskIds = requestedTaskIds(taskScope);
    const unauthorized = taskIds.filter((taskId) => !campaign.selectedTaskIds.includes(taskId));
    if (unauthorized.length) throw new Error(`Implementation campaign ${id} does not include task IDs: ${unauthorized.join(",")}`);
    return { campaign, taskIds };
  }
  return {
    begin(input: {
      changeId: string;
      projectId: string;
      selectedTaskIds: readonly string[];
      selectedTasks: readonly CampaignTaskSnapshot[];
      inventoryDigest: string;
      plan: CampaignPlanSnapshot;
      mode: ImplementationMode;
    }): ImplementationCampaign {
      const selectedTaskIds = exactTaskIds(input.selectedTaskIds, "implementation task ID");
      if (!digestPattern.test(input.inventoryDigest)) throw new Error("Implementation inventory digest is invalid");
      const plan = planSnapshot(input.plan, selectedTaskIds);
      const records = new Map(input.selectedTasks.map((task) => [task.id, task]));
      if (records.size !== input.selectedTasks.length) throw new Error("Implementation task snapshot contains duplicate IDs");
      const selectedTasks = selectedTaskIds.map((id) => {
        const task = records.get(id);
        if (!task) throw new Error(`Implementation task snapshot is missing selected task: ${id}`);
        if (task.status !== "pending") throw new Error(`Implementation task is already complete: ${id}`);
        return structuredClone(task);
      });
      if (records.size !== selectedTaskIds.length) throw new Error("Implementation task snapshot contains unselected tasks");
      // Complete every fallible validation/allocation before replacing active authority.
      const campaignId = text(makeId(), "Implementation campaign ID");
      if (campaigns.has(campaignId)) throw new Error(`Implementation campaign ID already exists: ${campaignId}`);
      const campaign: ImplementationCampaign = {
        campaignId, changeId: text(input.changeId, "Implementation change ID"),
        projectId: text(input.projectId, "Implementation project ID"), selectedTaskIds, selectedTasks,
        inventoryDigest: input.inventoryDigest, plan, mode: input.mode, status: "active",
        reviewerAuthorizations: [], dispatches: [], captainDirect: [],
      };
      for (const existing of campaigns.values()) {
        if (existing.projectId === input.projectId && existing.status === "active") {
          existing.status = "ended";
          existing.outcome = "switched";
          if (continuation?.campaignId === existing.campaignId) continuation = { ...continuation, disposition: "superseded" };
        }
      }
      campaigns.set(campaign.campaignId, campaign);
      continuation = {
        campaignId: campaign.campaignId, projectId: campaign.projectId, changeId: campaign.changeId,
        selectedTaskIds: [...campaign.selectedTaskIds], inventoryDigest: campaign.inventoryDigest, planDigest: campaign.plan.digest,
        mode: campaign.mode, generation: 0, disposition: "active",
      };
      return copy(campaign);
    },
    authorizeReviewer(input: { campaignId: string; projectId?: string; reviewCampaignId: string; acceptanceScope: string; budget: number }): ImplementationCampaign {
      const campaign = input.projectId ? owned(input.campaignId, input.projectId) : required(input.campaignId);
      if (campaign.status !== "active") throw new Error(`Implementation campaign ${input.campaignId} is not active`);
      if (campaign.mode !== "main_agent") throw new Error("Separate reviewer authorization is only valid in main-Agent mode");
      const reviewCampaignId = text(input.reviewCampaignId, "Review campaign ID");
      if (campaign.reviewerAuthorizations.some((item) => item.reviewCampaignId === reviewCampaignId)) throw new Error(`Reviewer authorization already exists: ${reviewCampaignId}`);
      const budget = positive(input.budget, "Reviewer authorization budget");
      campaign.reviewerAuthorizations.push({ reviewCampaignId, acceptanceScope: text(input.acceptanceScope, "Reviewer acceptance scope"), budget, consumed: 0, remaining: budget });
      return copy(campaign);
    },
    validateDispatch(input: { campaignId: string; changeId: string; projectId: string; taskScope: string; workKind: WorkKind; reviewCampaignId?: string; reviewFindingRootCauseId?: string }): ImplementationCampaign {
      const { campaign } = active(input.campaignId, input.changeId, input.projectId, input.taskScope);
      if (campaign.mode !== "main_agent" && input.workKind === "fix") {
        if (!input.reviewCampaignId) throw new Error("Corrective dispatch requires a review campaign");
        text(input.reviewFindingRootCauseId ?? "", "Corrective dispatch review finding root cause ID");
      } else if (input.reviewFindingRootCauseId !== undefined) {
        throw new Error("Only corrective dispatch may name a review finding root cause ID");
      }
      if (campaign.mode === "main_agent") {
        if (input.workKind !== "review") throw new Error(`Main-Agent campaign prohibits worker dispatch: ${input.workKind}`);
        if (!input.reviewCampaignId) throw new Error("Reviewer is not user-authorized for this main-Agent campaign");
        const authorization = campaign.reviewerAuthorizations.find((item) => item.reviewCampaignId === input.reviewCampaignId);
        if (!authorization) throw new Error("Reviewer is not user-authorized for this main-Agent campaign");
        if (authorization.remaining <= 0) throw new Error(`Reviewer authorization exhausted: ${input.reviewCampaignId}`);
      }
      return copy(campaign);
    },
    authorizeDispatch(input: { campaignId: string; changeId: string; projectId: string; taskScope: string; workKind: WorkKind; reviewCampaignId?: string; reviewFindingRootCauseId?: string }): ImplementationCampaign & { reviewerAuthorization?: ReviewerAuthorization } {
      const { campaign, taskIds } = active(input.campaignId, input.changeId, input.projectId, input.taskScope);
      let reviewerAuthorization: ReviewerAuthorization | undefined;
      if (campaign.mode !== "main_agent" && input.workKind === "fix") {
        if (!input.reviewCampaignId) throw new Error("Corrective dispatch requires a review campaign");
        text(input.reviewFindingRootCauseId ?? "", "Corrective dispatch review finding root cause ID");
      } else if (input.reviewFindingRootCauseId !== undefined) {
        throw new Error("Only corrective dispatch may name a review finding root cause ID");
      }
      if (campaign.mode === "main_agent") {
        if (input.workKind !== "review") throw new Error(`Main-Agent campaign prohibits worker dispatch: ${input.workKind}`);
        if (!input.reviewCampaignId) throw new Error("Reviewer is not user-authorized for this main-Agent campaign");
        reviewerAuthorization = campaign.reviewerAuthorizations.find((item) => item.reviewCampaignId === input.reviewCampaignId);
        if (!reviewerAuthorization) throw new Error("Reviewer is not user-authorized for this main-Agent campaign");
        if (reviewerAuthorization.remaining <= 0) throw new Error(`Reviewer authorization exhausted: ${input.reviewCampaignId}`);
        reviewerAuthorization.consumed += 1;
        reviewerAuthorization.remaining -= 1;
      }
      campaign.dispatches.push({ taskIds, workKind: input.workKind, ...(input.reviewCampaignId ? { reviewCampaignId: input.reviewCampaignId } : {}), ...(input.reviewFindingRootCauseId ? { reviewFindingRootCauseId: input.reviewFindingRootCauseId } : {}) });
      return { ...copy(campaign), ...(reviewerAuthorization ? { reviewerAuthorization: structuredClone(reviewerAuthorization) } : {}) };
    },
    recordCaptainDirect(input: { campaignId: string; changeId: string; projectId: string; taskScope: string; reason: string }): ImplementationCampaign {
      const { campaign, taskIds } = active(input.campaignId, input.changeId, input.projectId, input.taskScope);
      if (campaign.mode !== "multi_agent") throw new Error("Captain-direct reason is only required in multi-Agent mode");
      campaign.captainDirect.push({ taskIds, reason: text(input.reason, "Captain-direct reason") });
      return copy(campaign);
    },
    end(input: { campaignId: string; projectId: string }): ImplementationCampaign {
      const campaign = owned(input.campaignId, input.projectId);
      if (campaign.status !== "active") throw new Error(`Implementation campaign ${input.campaignId} is not active`);
      campaign.status = "ended";
      campaign.outcome = "ended";
      if (continuation?.campaignId === campaign.campaignId) continuation = { ...continuation, disposition: "superseded" };
      return copy(campaign);
    },
    status(campaignId: string, projectId: string): ImplementationCampaign { return copy(owned(campaignId, projectId)); },
    activeCampaign(projectId: string, changeId: string): ImplementationCampaign {
      const matches = [...campaigns.values()].filter((campaign) => campaign.projectId === projectId && campaign.changeId === changeId && campaign.status === "active");
      if (matches.length !== 1) throw new Error("No unique active implementation campaign for acceptance snapshot");
      return copy(matches[0]!);
    },
    currentContinuation(projectId: string): ContinuationLease | undefined {
      if (!continuation || continuation.projectId !== projectId) return undefined;
      return structuredClone(continuation);
    },
    continuation(campaignId: string, projectId: string): ContinuationLease | undefined {
      if (!continuation || continuation.campaignId !== campaignId || continuation.projectId !== projectId) return undefined;
      return structuredClone(continuation);
    },
    beginContinuationGeneration(campaignId: string, projectId: string, compactionGeneration?: number): ContinuationLease | undefined {
      if (!continuation || continuation.campaignId !== campaignId || continuation.projectId !== projectId || continuation.disposition !== "active") return undefined;
      // The caller supplies one process-local generation for each successful compaction.
      // Repeated lifecycle hooks for that generation must be idempotent, while a later
      // compaction is allowed to create its own bounded continuation.
      const generation = compactionGeneration ?? continuation.generation + 1;
      if (!Number.isSafeInteger(generation) || generation < 1 || continuation.queuedGeneration === generation) return undefined;
      continuation = { ...continuation, generation, queuedGeneration: generation };
      return structuredClone(continuation);
    },
    clearContinuation(): void { continuation = undefined; },
    setContinuationDisposition(campaignId: string, disposition: ContinuationLease["disposition"]): void {
      if (continuation?.campaignId === campaignId) continuation = { ...continuation, disposition };
    },
  };
}

export type ImplementationCampaignManager = ReturnType<typeof createImplementationCampaignManager>;
