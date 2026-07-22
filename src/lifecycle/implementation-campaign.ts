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

export interface ImplementationCampaign {
  campaignId: string;
  changeId: string;
  projectId: string;
  selectedTaskIds: string[];
  selectedTasks: CampaignTaskSnapshot[];
  inventoryDigest: string;
  mode: ImplementationMode;
  status: "active" | "ended";
  outcome?: "switched" | "ended";
  reviewerAuthorizations: ReviewerAuthorization[];
  dispatches: Array<{ taskIds: string[]; workKind: WorkKind }>;
  captainDirect: Array<{ taskIds: string[]; reason: string }>;
}

export interface ImplementationCampaignManagerOptions { makeId?: () => string }

const taskIdPattern = /^\d+(?:\.\d+)+$/u;
const digestPattern = /^[a-f0-9]{64}$/u;
const MAX_SELECTED_TASKS = 1_000;

function text(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
function copy(campaign: ImplementationCampaign): ImplementationCampaign { return structuredClone(campaign); }

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
      mode: ImplementationMode;
    }): ImplementationCampaign {
      const selectedTaskIds = exactTaskIds(input.selectedTaskIds, "implementation task ID");
      if (!digestPattern.test(input.inventoryDigest)) throw new Error("Implementation inventory digest is invalid");
      const records = new Map(input.selectedTasks.map((task) => [task.id, task]));
      if (records.size !== input.selectedTasks.length) throw new Error("Implementation task snapshot contains duplicate IDs");
      const selectedTasks = selectedTaskIds.map((id) => {
        const task = records.get(id);
        if (!task) throw new Error(`Implementation task snapshot is missing selected task: ${id}`);
        if (task.status !== "pending") throw new Error(`Implementation task is already complete: ${id}`);
        return structuredClone(task);
      });
      if (records.size !== selectedTaskIds.length) throw new Error("Implementation task snapshot contains unselected tasks");
      for (const campaign of campaigns.values()) {
        if (campaign.projectId === input.projectId && campaign.status === "active") {
          campaign.status = "ended";
          campaign.outcome = "switched";
        }
      }
      const campaign: ImplementationCampaign = {
        campaignId: makeId(), changeId: text(input.changeId, "Implementation change ID"),
        projectId: text(input.projectId, "Implementation project ID"), selectedTaskIds, selectedTasks,
        inventoryDigest: input.inventoryDigest, mode: input.mode, status: "active",
        reviewerAuthorizations: [], dispatches: [], captainDirect: [],
      };
      campaigns.set(campaign.campaignId, campaign);
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
    authorizeDispatch(input: { campaignId: string; changeId: string; projectId: string; taskScope: string; workKind: WorkKind; reviewCampaignId?: string }): ImplementationCampaign & { reviewerAuthorization?: ReviewerAuthorization } {
      const { campaign, taskIds } = active(input.campaignId, input.changeId, input.projectId, input.taskScope);
      let reviewerAuthorization: ReviewerAuthorization | undefined;
      if (campaign.mode === "main_agent") {
        if (input.workKind !== "review") throw new Error(`Main-Agent campaign prohibits worker dispatch: ${input.workKind}`);
        if (!input.reviewCampaignId) throw new Error("Reviewer is not user-authorized for this main-Agent campaign");
        reviewerAuthorization = campaign.reviewerAuthorizations.find((item) => item.reviewCampaignId === input.reviewCampaignId);
        if (!reviewerAuthorization) throw new Error("Reviewer is not user-authorized for this main-Agent campaign");
        if (reviewerAuthorization.remaining <= 0) throw new Error(`Reviewer authorization exhausted: ${input.reviewCampaignId}`);
        reviewerAuthorization.consumed += 1;
        reviewerAuthorization.remaining -= 1;
      }
      campaign.dispatches.push({ taskIds, workKind: input.workKind });
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
      return copy(campaign);
    },
    status(campaignId: string, projectId: string): ImplementationCampaign { return copy(owned(campaignId, projectId)); },
  };
}

export type ImplementationCampaignManager = ReturnType<typeof createImplementationCampaignManager>;
