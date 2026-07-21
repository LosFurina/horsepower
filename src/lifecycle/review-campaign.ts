import { createHash, randomUUID } from "node:crypto";

export type ReviewFindingScope = "in_scope" | "out_of_scope";
export type ReviewCampaignOutcome = "accepted" | "scope_changed" | "blocked_needs_human" | "canceled";

export interface ReviewFinding {
  rootCauseId: string;
  summary: string;
  scope: ReviewFindingScope;
  occurrences: number;
  evidenceRefs: string[];
}

export interface ReviewCampaign {
  campaignId: string;
  changeId: string;
  projectId: string;
  acceptanceScope: string;
  scopeDigest: string;
  budget: number;
  consumed: number;
  remaining: number;
  status: "active" | "ended";
  findings: ReviewFinding[];
  dispatches: Array<{ summary: string }>;
  overrideReasons: string[];
  outcome?: ReviewCampaignOutcome;
  outcomeSummary?: string;
}

export interface ReviewCampaignManagerOptions {
  makeId?: () => string;
}

function nonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function snapshot(campaign: ReviewCampaign): ReviewCampaign {
  return structuredClone(campaign);
}

export function createReviewCampaignManager(options: ReviewCampaignManagerOptions = {}) {
  const campaigns = new Map<string, ReviewCampaign>();
  const makeId = options.makeId ?? (() => randomUUID());

  function required(campaignId: string): ReviewCampaign {
    const campaign = campaigns.get(campaignId);
    if (!campaign) throw new Error(`Unknown review campaign: ${campaignId}`);
    return campaign;
  }

  function correlated(campaignId: string, changeId: string, projectId: string): ReviewCampaign {
    const campaign = required(campaignId);
    if (campaign.changeId !== changeId) throw new Error(`Review campaign ${campaignId} belongs to change ${campaign.changeId}`);
    if (campaign.projectId !== projectId) throw new Error(`Review campaign ${campaignId} belongs to another project`);
    return campaign;
  }

  function active(campaignId: string, changeId?: string, projectId?: string): ReviewCampaign {
    const campaign = changeId === undefined || projectId === undefined ? required(campaignId) : correlated(campaignId, changeId, projectId);
    if (campaign.status !== "active") throw new Error(`Review campaign ${campaignId} is not active`);
    return campaign;
  }

  return {
    begin(input: { changeId: string; projectId: string; acceptanceScope: string; budget: number }): ReviewCampaign {
      const acceptanceScope = nonEmpty(input.acceptanceScope, "Review acceptance scope");
      const budget = positiveInteger(input.budget, "Review campaign budget");
      const campaignId = makeId();
      if (campaigns.has(campaignId)) throw new Error(`Review campaign already exists: ${campaignId}`);
      const campaign: ReviewCampaign = {
        campaignId,
        changeId: nonEmpty(input.changeId, "Review change ID"),
        projectId: nonEmpty(input.projectId, "Review project ID"),
        acceptanceScope,
        scopeDigest: createHash("sha256").update(acceptanceScope).digest("hex"),
        budget,
        consumed: 0,
        remaining: budget,
        status: "active",
        findings: [],
        dispatches: [],
        overrideReasons: [],
      };
      campaigns.set(campaignId, campaign);
      return snapshot(campaign);
    },

    consume(input: { campaignId: string; changeId: string; projectId: string; dispatchSummary: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      if (campaign.remaining <= 0) throw new Error(`Review campaign budget exhausted: ${input.campaignId}`);
      campaign.consumed += 1;
      campaign.remaining -= 1;
      campaign.dispatches.push({ summary: nonEmpty(input.dispatchSummary, "Review dispatch summary") });
      return snapshot(campaign);
    },

    recordFinding(input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string; summary: string; scope: ReviewFindingScope; evidenceRef?: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      const rootCauseId = nonEmpty(input.rootCauseId, "Review root cause ID");
      const summary = nonEmpty(input.summary, "Review finding summary");
      let finding = campaign.findings.find((item) => item.rootCauseId === rootCauseId);
      if (finding) {
        if (finding.scope !== input.scope) throw new Error(`Review finding scope mismatch: ${rootCauseId}`);
        finding.occurrences += 1;
      } else {
        finding = { rootCauseId, summary, scope: input.scope, occurrences: 1, evidenceRefs: [] };
        campaign.findings.push(finding);
      }
      if (input.evidenceRef && !finding.evidenceRefs.includes(input.evidenceRef)) finding.evidenceRefs.push(input.evidenceRef);
      return snapshot(campaign);
    },

    extend(input: { campaignId: string; changeId: string; projectId: string; additionalBudget: number; humanAuthorized: boolean; reason: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      if (input.humanAuthorized !== true) throw new Error("Review budget extension requires human authorization");
      const reason = nonEmpty(input.reason, "Review budget override reason");
      const additionalBudget = positiveInteger(input.additionalBudget, "Additional review budget");
      campaign.budget += additionalBudget;
      campaign.remaining += additionalBudget;
      campaign.overrideReasons.push(reason);
      return snapshot(campaign);
    },

    end(input: { campaignId: string; changeId: string; projectId: string; outcome: ReviewCampaignOutcome; summary: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      campaign.status = "ended";
      campaign.outcome = input.outcome;
      campaign.outcomeSummary = nonEmpty(input.summary, "Review campaign outcome summary");
      return snapshot(campaign);
    },

    status(campaignId: string, projectId: string): ReviewCampaign {
      const campaign = required(campaignId);
      if (campaign.projectId !== projectId) throw new Error(`Review campaign ${campaignId} belongs to another project`);
      return snapshot(campaign);
    },

    list(): ReviewCampaign[] {
      return [...campaigns.values()].map(snapshot).sort((left, right) => left.campaignId.localeCompare(right.campaignId));
    },
  };
}

export type ReviewCampaignManager = ReturnType<typeof createReviewCampaignManager>;
