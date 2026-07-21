import { randomUUID } from "node:crypto";

export type ImplementationMode = "multi_agent" | "main_agent";
export type WorkKind = "implementation" | "research" | "test" | "fix" | "review";

interface ReviewerAuthorization {
  reviewCampaignId: string;
  acceptanceScope: string;
  budget: number;
  consumed: number;
  remaining: number;
}

export interface ImplementationCampaign {
  campaignId: string;
  changeId: string;
  projectId: string;
  taskScopes: string[];
  mode: ImplementationMode;
  status: "active" | "ended";
  outcome?: "switched" | "ended";
  reviewerAuthorizations: ReviewerAuthorization[];
  dispatches: Array<{ taskScope: string; workKind: WorkKind }>;
  captainDirect: Array<{ taskScope: string; reason: string }>;
}

export interface ImplementationCampaignManagerOptions { makeId?: () => string }

function text(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}
function copy(campaign: ImplementationCampaign): ImplementationCampaign { return structuredClone(campaign); }

function taskPoint(value: string): number[] | undefined {
  if (!/^\d+(?:\.\d+)*$/u.test(value)) return undefined;
  return value.split(".").map(Number);
}

function compareTaskPoints(left: readonly number[], right: readonly number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function taskRange(value: string): { start: number[]; end: number[] } | undefined {
  const parts = value.split("-");
  if (parts.length > 2) return undefined;
  const start = taskPoint(parts[0]!);
  const end = taskPoint(parts[1] ?? parts[0]!);
  if (!start || !end || compareTaskPoints(start, end) > 0) return undefined;
  return { start, end };
}

function includesTaskScope(authorized: readonly string[], requested: string): boolean {
  if (authorized.includes(requested)) return true;
  const requestedRange = taskRange(requested);
  if (!requestedRange) return false;
  return authorized.some((scope) => {
    const allowed = taskRange(scope);
    return allowed !== undefined
      && compareTaskPoints(allowed.start, requestedRange.start) <= 0
      && compareTaskPoints(allowed.end, requestedRange.end) >= 0;
  });
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
  function active(id: string, changeId: string, projectId: string, taskScope: string): ImplementationCampaign {
    const campaign = owned(id, projectId);
    if (campaign.status !== "active") throw new Error(`Implementation campaign ${id} is not active`);
    if (campaign.changeId !== changeId) throw new Error(`Implementation campaign ${id} belongs to change ${campaign.changeId}`);
    if (!includesTaskScope(campaign.taskScopes, taskScope)) throw new Error(`Implementation campaign ${id} does not include task scope ${taskScope}`);
    return campaign;
  }
  return {
    begin(input: { changeId: string; projectId: string; taskScopes: string[]; mode: ImplementationMode }): ImplementationCampaign {
      const taskScopes = [...new Set(input.taskScopes.map((scope) => text(scope, "Implementation task scope")))];
      if (taskScopes.length === 0) throw new Error("At least one implementation task scope is required");
      for (const campaign of campaigns.values()) {
        if (campaign.projectId === input.projectId && campaign.status === "active") {
          campaign.status = "ended";
          campaign.outcome = "switched";
        }
      }
      const campaign: ImplementationCampaign = {
        campaignId: makeId(), changeId: text(input.changeId, "Implementation change ID"),
        projectId: text(input.projectId, "Implementation project ID"), taskScopes,
        mode: input.mode, status: "active", reviewerAuthorizations: [], dispatches: [], captainDirect: [],
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
      const campaign = active(input.campaignId, input.changeId, input.projectId, input.taskScope);
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
      campaign.dispatches.push({ taskScope: input.taskScope, workKind: input.workKind });
      return { ...copy(campaign), ...(reviewerAuthorization ? { reviewerAuthorization: structuredClone(reviewerAuthorization) } : {}) };
    },
    recordCaptainDirect(input: { campaignId: string; changeId: string; projectId: string; taskScope: string; reason: string }): ImplementationCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId, input.taskScope);
      if (campaign.mode !== "multi_agent") throw new Error("Captain-direct reason is only required in multi-Agent mode");
      campaign.captainDirect.push({ taskScope: input.taskScope, reason: text(input.reason, "Captain-direct reason") });
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
