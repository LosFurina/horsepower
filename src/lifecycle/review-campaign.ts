import { createHash, randomUUID } from "node:crypto";
import { verifyFreshEvidence, type VerificationDecision, type VerificationManifest } from "./verification-gate.js";

export type ReviewFindingScope = "in_scope" | "out_of_scope";
export type ReviewFindingDisposition = "pending" | "accepted" | "rejected" | "needs_clarification" | "blocked_needs_human";
export type ReviewFindingResolution = "open" | "resolved";
export type ReviewCampaignOutcome = "accepted" | "scope_changed" | "blocked_needs_human" | "canceled";

export interface ReviewFinding {
  rootCauseId: string;
  summary: string;
  scope: ReviewFindingScope;
  occurrences: number;
  evidenceRefs: string[];
  foundAt: string;
  disposition: ReviewFindingDisposition;
  dispositionRationale?: string;
  dispositionEvidenceRef?: string;
  dispositionAt?: string;
  resolution?: ReviewFindingResolution;
  resolutionVerification?: VerificationDecision;
  resolvedAt?: string;
  hasDispositionConflict?: boolean;
}

export interface ReviewCampaign {
  campaignId: string;
  changeId: string;
  projectId: string;
  acceptanceScope: string;
  implementationCampaignId?: string;
  taskScope?: string;
  scopeDigest: string;
  budget: number;
  consumed: number;
  remaining: number;
  status: "active" | "ended";
  findings: ReviewFinding[];
  dispatches: Array<{ summary: string; kind: "review" | "fix"; rootCauseId?: string }>;
  overrideReasons: string[];
  outcome?: ReviewCampaignOutcome;
  outcomeSummary?: string;
}

export interface ReviewCampaignManagerOptions {
  makeId?: () => string;
  now?: () => Date;
}

const MAX_RATIONALE = 1_000;
const MAX_EVIDENCE_REF = 2_048;
const MAX_EVIDENCE_REFS = 20;

function bounded(value: string, label: string, max = 4_096): string {
  if (!value.trim()) throw new Error(`${label} is required`);
  if (value.length > max) throw new Error(`${label} exceeds ${max} characters`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function snapshot(campaign: ReviewCampaign): ReviewCampaign { return structuredClone(campaign); }

export function reviewFindingAcceptanceRef(rootCauseId: string): string {
  return `review-finding:${rootCauseId}`;
}

export function createReviewCampaignManager(options: ReviewCampaignManagerOptions = {}) {
  const campaigns = new Map<string, ReviewCampaign>();
  const makeId = options.makeId ?? (() => randomUUID());
  const now = options.now ?? (() => new Date());

  function required(campaignId: string): ReviewCampaign {
    const campaign = campaigns.get(campaignId);
    if (!campaign) throw new Error(`REVIEW_CAMPAIGN_UNKNOWN: ${campaignId}`);
    return campaign;
  }

  function correlated(campaignId: string, changeId: string, projectId: string): ReviewCampaign {
    const campaign = required(campaignId);
    if (campaign.changeId !== changeId) throw new Error(`REVIEW_CAMPAIGN_CHANGE_MISMATCH: ${campaignId} belongs to change ${campaign.changeId}`);
    if (campaign.projectId !== projectId) throw new Error(`REVIEW_CAMPAIGN_PROJECT_MISMATCH: ${campaignId} belongs to another project`);
    return campaign;
  }

  function active(campaignId: string, changeId?: string, projectId?: string): ReviewCampaign {
    const campaign = changeId === undefined || projectId === undefined ? required(campaignId) : correlated(campaignId, changeId, projectId);
    if (campaign.status !== "active") throw new Error(`REVIEW_CAMPAIGN_NOT_ACTIVE: Review campaign ${campaignId} is not active`);
    return campaign;
  }

  function finding(campaign: ReviewCampaign, rootCauseId: string): ReviewFinding {
    const result = campaign.findings.find((item) => item.rootCauseId === rootCauseId);
    if (!result) throw new Error(`REVIEW_FINDING_UNKNOWN: ${rootCauseId}`);
    return result;
  }

  function authorizeFix(campaign: ReviewCampaign, rootCauseId: string): ReviewFinding {
    const item = finding(campaign, rootCauseId);
    if (item.scope !== "in_scope") throw new Error(`REVIEW_FINDING_OUT_OF_SCOPE: ${rootCauseId}`);
    if (item.hasDispositionConflict === true) throw new Error(`REVIEW_FINDING_DISPOSITION_CONFLICT: ${rootCauseId} requires explicit Captain re-disposition`);
    if (item.disposition !== "accepted") throw new Error(`REVIEW_FINDING_NOT_ACCEPTED: ${rootCauseId} is ${item.disposition}`);
    if (item.resolution !== "open") throw new Error(`REVIEW_FINDING_NOT_OPEN: ${rootCauseId} is ${item.resolution ?? "not_accepted"}`);
    return item;
  }

  return {
    begin(input: { changeId: string; projectId: string; acceptanceScope: string; budget: number; implementationCampaignId?: string; taskScope?: string }): ReviewCampaign {
      const acceptanceScope = bounded(input.acceptanceScope, "Review acceptance scope");
      const budget = positiveInteger(input.budget, "Review campaign budget");
      const campaignId = makeId();
      if (campaigns.has(campaignId)) throw new Error(`Review campaign already exists: ${campaignId}`);
      const campaign: ReviewCampaign = {
        campaignId,
        changeId: bounded(input.changeId, "Review change ID", 256),
        projectId: bounded(input.projectId, "Review project ID", 4_096),
        acceptanceScope,
        ...(input.implementationCampaignId ? { implementationCampaignId: bounded(input.implementationCampaignId, "Implementation campaign ID", 128) } : {}),
        ...(input.taskScope ? { taskScope: bounded(input.taskScope, "Review campaign task scope", 256) } : {}),
        scopeDigest: createHash("sha256").update(acceptanceScope).digest("hex"),
        budget, consumed: 0, remaining: budget, status: "active", findings: [], dispatches: [], overrideReasons: [],
      };
      campaigns.set(campaignId, campaign);
      return snapshot(campaign);
    },

    validateDispatchAuthority(input: { campaignId: string; changeId: string; projectId: string; implementationCampaignId: string; taskScope: string; kind: "review" | "fix"; rootCauseId?: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      if (!campaign.implementationCampaignId || campaign.implementationCampaignId !== input.implementationCampaignId) throw new Error(`REVIEW_IMPLEMENTATION_CAMPAIGN_MISMATCH: ${input.campaignId}`);
      if (!campaign.taskScope || campaign.taskScope !== input.taskScope) throw new Error(`REVIEW_ACCEPTANCE_SCOPE_MISMATCH: ${input.campaignId}`);
      if (input.kind === "fix") authorizeFix(campaign, bounded(input.rootCauseId ?? "", "Corrective dispatch review finding root cause ID", 128));
      else if (input.rootCauseId !== undefined) throw new Error("REVIEW_FINDING_CORRELATION_INVALID: reviewer dispatch must not name a corrective root cause");
      return snapshot(campaign);
    },

    authorizeCorrective(input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      authorizeFix(campaign, bounded(input.rootCauseId, "Review root cause ID", 128));
      if (campaign.remaining <= 0) throw new Error(`REVIEW_CAMPAIGN_BUDGET_EXHAUSTED: Review campaign budget exhausted: ${input.campaignId}`);
      return snapshot(campaign);
    },

    consume(input: { campaignId: string; changeId: string; projectId: string; dispatchSummary: string; kind?: "review" | "fix"; rootCauseId?: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      const kind = input.kind ?? "review";
      let rootCauseId: string | undefined;
      if (kind === "fix") {
        rootCauseId = bounded(input.rootCauseId ?? "", "Corrective dispatch review finding root cause ID", 128);
        authorizeFix(campaign, rootCauseId);
      } else if (input.rootCauseId !== undefined) {
        throw new Error("REVIEW_FINDING_CORRELATION_INVALID: reviewer dispatch must not name a corrective root cause");
      }
      if (campaign.remaining <= 0) throw new Error(`REVIEW_CAMPAIGN_BUDGET_EXHAUSTED: Review campaign budget exhausted: ${input.campaignId}`);
      const dispatchSummary = bounded(input.dispatchSummary, "Review dispatch summary", 500);
      campaign.consumed += 1;
      campaign.remaining -= 1;
      campaign.dispatches.push({ summary: dispatchSummary, kind, ...(rootCauseId ? { rootCauseId } : {}) });
      return snapshot(campaign);
    },

    recordFinding(input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string; summary: string; scope: ReviewFindingScope; evidenceRef?: string; materiallyConflictsDisposition?: boolean }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      const rootCauseId = bounded(input.rootCauseId, "Review root cause ID", 128);
      const summary = bounded(input.summary, "Review finding summary", 500);
      const existing = campaign.findings.find((candidate) => candidate.rootCauseId === rootCauseId);
      if (existing?.scope !== undefined && existing.scope !== input.scope) throw new Error(`REVIEW_FINDING_SCOPE_MISMATCH: ${rootCauseId}`);
      const evidenceRef = input.evidenceRef ? bounded(input.evidenceRef, "Review finding evidence reference", MAX_EVIDENCE_REF) : undefined;
      const shouldAddEvidence = evidenceRef !== undefined && !existing?.evidenceRefs.includes(evidenceRef);
      if (shouldAddEvidence && existing && existing.evidenceRefs.length >= MAX_EVIDENCE_REFS) throw new Error(`Review finding permits at most ${MAX_EVIDENCE_REFS} evidence references`);
      const foundAt = existing ? undefined : now().toISOString();

      let item: ReviewFinding;
      if (existing) {
        item = existing;
        item.occurrences += 1;
        if (item.disposition !== "pending" && input.materiallyConflictsDisposition === true) item.hasDispositionConflict = true;
      } else {
        item = { rootCauseId, summary, scope: input.scope, occurrences: 1, evidenceRefs: [], foundAt: foundAt!, disposition: "pending" };
        campaign.findings.push(item);
      }
      if (shouldAddEvidence) item.evidenceRefs.push(evidenceRef);
      return snapshot(campaign);
    },

    dispositionFinding(input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string; disposition: Exclude<ReviewFindingDisposition, "pending">; rationale: string; evidenceRef?: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      const item = finding(campaign, bounded(input.rootCauseId, "Review root cause ID", 128));
      if (item.scope !== "in_scope") throw new Error(`REVIEW_FINDING_OUT_OF_SCOPE: ${item.rootCauseId}`);
      const acknowledgingResolvedConflict = item.resolution === "resolved" && item.hasDispositionConflict === true && input.disposition === "accepted";
      if (item.resolution === "resolved" && !acknowledgingResolvedConflict) throw new Error(`REVIEW_FINDING_ALREADY_RESOLVED: ${item.rootCauseId}`);
      if (!["accepted", "rejected", "needs_clarification", "blocked_needs_human"].includes(input.disposition)) throw new Error("REVIEW_FINDING_DISPOSITION_INVALID");
      const rationale = bounded(input.rationale, "Review finding disposition rationale", MAX_RATIONALE);
      const dispositionAt = now().toISOString();
      const evidenceRef = input.evidenceRef === undefined ? undefined : bounded(input.evidenceRef, "Review disposition evidence reference", MAX_EVIDENCE_REF);

      item.disposition = input.disposition;
      item.dispositionRationale = rationale;
      item.dispositionAt = dispositionAt;
      item.hasDispositionConflict = false;
      if (evidenceRef === undefined) delete item.dispositionEvidenceRef;
      else item.dispositionEvidenceRef = evidenceRef;
      if (!acknowledgingResolvedConflict) {
        if (input.disposition === "accepted") item.resolution = "open";
        else delete item.resolution;
        delete item.resolutionVerification;
        delete item.resolvedAt;
      }
      return snapshot(campaign);
    },

    resolveFinding(input: { campaignId: string; changeId: string; projectId: string; rootCauseId: string; verification: VerificationManifest }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      const item = finding(campaign, bounded(input.rootCauseId, "Review root cause ID", 128));
      if (item.scope !== "in_scope") throw new Error(`REVIEW_FINDING_OUT_OF_SCOPE: ${item.rootCauseId}`);
      if (item.disposition !== "accepted") throw new Error(`REVIEW_FINDING_NOT_ACCEPTED: ${item.rootCauseId} is ${item.disposition}`);
      if (item.resolution === "resolved") throw new Error(`REVIEW_FINDING_ALREADY_RESOLVED: ${item.rootCauseId}`);
      if (item.resolution !== "open" || !item.dispositionAt) throw new Error(`REVIEW_FINDING_INVALID_TRANSITION: ${item.rootCauseId}`);
      const ref = reviewFindingAcceptanceRef(item.rootCauseId);
      const resolvedAt = now().toISOString();
      const decision = verifyFreshEvidence(input.verification, {
        runStartedAt: item.dispositionAt,
        now: resolvedAt,
        currentAcceptanceSnapshot: {
          digest: createHash("sha256").update(JSON.stringify({ campaignId: campaign.campaignId, scopeDigest: campaign.scopeDigest, rootCauseId: item.rootCauseId })).digest("hex"),
          refs: [ref],
        },
      });
      item.resolution = "resolved";
      item.resolutionVerification = decision;
      item.resolvedAt = resolvedAt;
      return snapshot(campaign);
    },

    extend(input: { campaignId: string; changeId: string; projectId: string; additionalBudget: number; humanAuthorized: boolean; reason: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      if (input.humanAuthorized !== true) throw new Error("Review budget extension requires human authorization");
      const reason = bounded(input.reason, "Review budget override reason", 500);
      const additionalBudget = positiveInteger(input.additionalBudget, "Additional review budget");
      campaign.budget += additionalBudget;
      campaign.remaining += additionalBudget;
      campaign.overrideReasons.push(reason);
      return snapshot(campaign);
    },

    end(input: { campaignId: string; changeId: string; projectId: string; outcome: ReviewCampaignOutcome; summary: string }): ReviewCampaign {
      const campaign = active(input.campaignId, input.changeId, input.projectId);
      if (input.outcome === "accepted") {
        const blockers = campaign.findings.filter((item) => item.scope === "in_scope" && !(
          item.hasDispositionConflict !== true && ((item.disposition === "rejected" && Boolean(item.dispositionRationale?.trim())) ||
          (item.disposition === "accepted" && item.resolution === "resolved" && item.resolutionVerification !== undefined))
        ));
        if (blockers.length) {
          const states = blockers.map((item) => `${item.rootCauseId}:${item.disposition}${item.resolution ? `/${item.resolution}` : ""}`).join(",");
          throw new Error(`REVIEW_CAMPAIGN_ACCEPTANCE_BLOCKED: ${states}`);
        }
      }
      const outcomeSummary = bounded(input.summary, "Review campaign outcome summary", 500);
      campaign.status = "ended";
      campaign.outcome = input.outcome;
      campaign.outcomeSummary = outcomeSummary;
      return snapshot(campaign);
    },

    status(campaignId: string, projectId: string): ReviewCampaign {
      const campaign = required(campaignId);
      if (campaign.projectId !== projectId) throw new Error(`REVIEW_CAMPAIGN_PROJECT_MISMATCH: ${campaignId} belongs to another project`);
      return snapshot(campaign);
    },

    list(): ReviewCampaign[] { return [...campaigns.values()].map(snapshot).sort((left, right) => left.campaignId.localeCompare(right.campaignId)); },
  };
}

export type ReviewCampaignManager = ReturnType<typeof createReviewCampaignManager>;
