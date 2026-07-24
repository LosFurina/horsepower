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

export interface CampaignTaskSnapshot extends Pick<OpenSpecTask, "id" | "description" | "status" | "sectionId" | "checks"> { sectionTitle?: string }

export interface CampaignTestingGuidance {
  prompt: string;
  selectedTaskChecks: Array<{ taskId: string; checks: string[] }>;
}

export interface ImplementationCampaign {
  campaignId: string;
  changeId: string;
  projectId: string;
  selectedTaskIds: string[];
  selectedTasks: CampaignTaskSnapshot[];
  inventoryDigest: string;
  testing: CampaignTestingGuidance;
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
  testingPrompt: string;
  mode: ImplementationMode;
  generation: number;
  disposition: "active" | "paused" | "blocked" | "terminal" | "superseded";
  queuedGeneration?: number;
}

const taskIdPattern = /^\d+(?:\.\d+)+$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
// Must remain representable by the claim-matched verification manifest.
const MAX_SELECTED_TASKS = 100;
const MAX_ID_BYTES = 128;
const MAX_PROJECT_ID_BYTES = 4_096;
const MAX_CONTINUATION_IDENTITY_BYTES = 32 * 1_024;

function text(value: string, label: string, maxBytes?: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (maxBytes !== undefined && Buffer.byteLength(normalized, "utf8") > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  return normalized;
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
function copy(campaign: ImplementationCampaign): ImplementationCampaign { return structuredClone(campaign); }

function testingGuidance(input: CampaignTestingGuidance, selectedTaskIds: readonly string[]): CampaignTestingGuidance {
  const prompt = text(input.prompt, "Implementation testing-intensity prompt", 2_000).replace(/\s+/gu, " ");
  if (input.selectedTaskChecks.length !== selectedTaskIds.length) throw new Error("Implementation testing guidance does not match selected tasks");
  const records = new Map(input.selectedTaskChecks.map((entry) => [entry.taskId, entry]));
  if (records.size !== input.selectedTaskChecks.length) throw new Error("Implementation testing guidance contains duplicate task IDs");
  const selectedTaskChecks = selectedTaskIds.map((taskId) => {
    const entry = records.get(taskId);
    if (!entry) throw new Error(`Implementation testing guidance is missing selected task: ${taskId}`);
    if (entry.checks.length > 20 || new Set(entry.checks).size !== entry.checks.length) throw new Error(`Implementation task checks are invalid: ${taskId}`);
    return { taskId, checks: entry.checks.map((check) => text(check, `Implementation task ${taskId} check`, 500).replace(/\s+/gu, " ")) };
  });
  return { prompt, selectedTaskChecks };
}

function exactTaskIds(values: readonly string[], label: string): string[] {
  if (values.length === 0) throw new Error(`At least one ${label} is required`);
  if (values.length > MAX_SELECTED_TASKS) throw new Error(`${label} permits at most ${MAX_SELECTED_TASKS} task IDs`);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const id = text(raw, label, MAX_ID_BYTES);
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
      testing: CampaignTestingGuidance;
      mode: ImplementationMode;
    }): ImplementationCampaign {
      const selectedTaskIds = exactTaskIds(input.selectedTaskIds, "implementation task ID");
      if (!digestPattern.test(input.inventoryDigest)) throw new Error("Implementation inventory digest is invalid");
      const testing = testingGuidance(input.testing, selectedTaskIds);
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
      const campaignId = text(makeId(), "Implementation campaign ID", MAX_ID_BYTES);
      if (campaigns.has(campaignId)) throw new Error(`Implementation campaign ID already exists: ${campaignId}`);
      const campaign: ImplementationCampaign = {
        campaignId, changeId: text(input.changeId, "Implementation change ID", MAX_ID_BYTES),
        projectId: text(input.projectId, "Implementation project ID", MAX_PROJECT_ID_BYTES), selectedTaskIds, selectedTasks,
        inventoryDigest: input.inventoryDigest, testing, mode: input.mode, status: "active",
        reviewerAuthorizations: [], dispatches: [], captainDirect: [],
      };
      const nextContinuation: ContinuationLease = {
        campaignId: campaign.campaignId, projectId: campaign.projectId, changeId: campaign.changeId,
        selectedTaskIds: [...campaign.selectedTaskIds], inventoryDigest: campaign.inventoryDigest, testingPrompt: campaign.testing.prompt,
        mode: campaign.mode, generation: 0, disposition: "active",
      };
      if (Buffer.byteLength(JSON.stringify(nextContinuation), "utf8") > MAX_CONTINUATION_IDENTITY_BYTES) {
        throw new Error(`Implementation continuation identity exceeds ${MAX_CONTINUATION_IDENTITY_BYTES} bytes`);
      }
      for (const existing of campaigns.values()) {
        if (existing.projectId === input.projectId && existing.status === "active") {
          existing.status = "ended";
          existing.outcome = "switched";
          if (continuation?.campaignId === existing.campaignId) continuation = { ...continuation, disposition: "superseded" };
        }
      }
      campaigns.set(campaign.campaignId, campaign);
      continuation = nextContinuation;
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
      const campaign = campaigns.get(campaignId);
      // Ended/switched campaigns cannot mint continuation even if disposition was left active.
      if (!campaign || campaign.status !== "active" || campaign.projectId !== projectId) return undefined;
      // The caller supplies one process-local generation for each successful compaction.
      // Repeated lifecycle hooks for that generation must be idempotent, while a later
      // compaction is allowed to create its own bounded continuation.
      const generation = compactionGeneration ?? continuation.generation + 1;
      if (!Number.isSafeInteger(generation) || generation < 1) return undefined;
      // Duplicate generation is suppressed; stale/out-of-order generations cannot rewind authority.
      if (continuation.queuedGeneration === generation || generation <= continuation.generation) return undefined;
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
