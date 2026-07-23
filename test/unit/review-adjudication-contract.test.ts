import { Check } from "typebox/value";
import { expect, test, vi } from "vitest";
import { createReviewCampaignManager } from "../../src/lifecycle/review-campaign.js";
import { createOrchestration } from "../../src/orchestration/facade.js";
import { horsepowerActionSchemas } from "../../src/orchestration/schema.js";

const base = { cwd: "/project", changeId: "change-a", campaignId: "review-1", rootCauseId: "root-1" };
const dependencies = () => ({
  authorize: async () => undefined,
  resolveSlot: (slot: string) => ({ requestedSlot: slot, resolvedSlot: slot, model: "provider/model", thinking: "high" as const, fallbackPath: [slot], revision: "r" }),
  validateModel: () => undefined,
  getAgent: (name: string) => ({ name, role: "review", prompt: "Review", tools: [], standards: [] }),
  createWorker: async () => ({ workerId: "worker" }),
  beginDispatch: () => ({ runId: "run" }),
  reportDispatchTerminal: async () => undefined,
});

test("public schema exposes strict disposition, resolution, and corrective root-cause fields", () => {
  expect(Check(horsepowerActionSchemas.disposition_review_finding, { action: "disposition_review_finding", ...base, disposition: "accepted", rationale: "Captain reproduced it" })).toBe(true);
  expect(Check(horsepowerActionSchemas.disposition_review_finding, { action: "disposition_review_finding", ...base, disposition: "pending", rationale: "worker says so" })).toBe(false);
  expect(Check(horsepowerActionSchemas.resolve_review_finding, { action: "resolve_review_finding", ...base, verification: {
    observedAt: "2026-07-22T12:00:00.000Z", commands: [{ id: "targeted", kind: "targeted", command: "npm test", exitCode: 0, summary: "passed", acceptanceRefs: ["review-finding:root-1"] }], acceptance: [{ ref: "review-finding:root-1", evidenceIds: ["targeted"] }],
  } })).toBe(true);
  expect(Check(horsepowerActionSchemas.single, { action: "single", cwd: "/project", changeId: "change-a", handoffMode: "inline", implementationCampaignId: "implementation-1", taskScope: "2.1", workKind: "fix", reviewCampaignId: "review-1", reviewFindingRootCauseId: "root-1", name: "fix", agent: "coder", modelSlot: "craft", task: "fix it" })).toBe(true);
});

test("only Captain can disposition or resolve and neither action dispatches or consumes budget", async () => {
  const mutate = vi.fn(() => ({ campaignId: "review-1" }) as never);
  const consume = vi.fn();
  const createWorker = vi.fn(async () => ({ workerId: "worker" }));
  const orchestration = createOrchestration({ ...dependencies(), createWorker, consumeReviewCampaign: consume as never, dispositionReviewFinding: mutate, resolveReviewFinding: mutate });
  const disposition = { action: "disposition_review_finding", ...base, disposition: "accepted", rationale: "Captain reproduced it" };
  await expect(orchestration.execute(disposition, { captain: false })).rejects.toThrow(/Captain capability/);
  await expect(orchestration.execute(disposition, { captain: true })).resolves.toMatchObject({ campaignId: "review-1" });
  await expect(orchestration.execute({ action: "resolve_review_finding", ...base, verification: { observedAt: "2026-07-22T12:00:00.000Z", commands: [{ id: "targeted", kind: "targeted", command: "npm test", exitCode: 0, summary: "passed", acceptanceRefs: ["review-finding:root-1"] }], acceptance: [{ ref: "review-finding:root-1", evidenceIds: ["targeted"] }] } }, { captain: true })).resolves.toMatchObject({ campaignId: "review-1" });
  expect(mutate).toHaveBeenCalledTimes(2);
  expect(consume).not.toHaveBeenCalled();
  expect(createWorker).not.toHaveBeenCalled();
});

test("fix dispatch requires a named root cause before budget consumption or work creation", async () => {
  const consume = vi.fn(() => ({}) as never);
  const worker = vi.fn(async () => ({ workerId: "worker" }));
  const orchestration = createOrchestration({ ...dependencies(), createWorker: worker, consumeReviewCampaign: consume });
  const input = { action: "create", cwd: "/project", changeId: "change-a", handoffMode: "inline", implementationCampaignId: "implementation-1", taskScope: "2.1", workKind: "fix", reviewCampaignId: "review-1", name: "fix", agent: "coder", modelSlot: "craft" };
  await expect(orchestration.execute(input, { captain: true })).rejects.toThrow(/reviewFindingRootCauseId.*required/);
  expect(consume).not.toHaveBeenCalled();
  expect(worker).not.toHaveBeenCalled();
});

test.each(["pending", "rejected", "needs_clarification", "blocked_needs_human"] as const)("%s finding cannot authorize corrective dispatch or consume budget", (disposition) => {
  const campaigns = createReviewCampaignManager({ makeId: () => "review-1" });
  campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "2.1", budget: 1, implementationCampaignId: "implementation-1", taskScope: "2.1" });
  campaigns.recordFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "finding", scope: "in_scope" });
  if (disposition !== "pending") campaigns.dispositionFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition, rationale: "Captain evaluation" });
  expect(() => campaigns.consume({ campaignId: "review-1", changeId: "change-a", projectId: "/project", kind: "fix", rootCauseId: "root-1", dispatchSummary: "fix" })).toThrow(/NOT_ACCEPTED/);
  expect(campaigns.status("review-1", "/project")).toMatchObject({ consumed: 0, remaining: 1, dispatches: [] });
});

test("accepted unresolved finding authorizes exactly one correlated fix and resolved/out-of-scope/unknown/cross-campaign findings do not", () => {
  let id = 0;
  let time = Date.parse("2026-07-22T12:00:00.000Z");
  const campaigns = createReviewCampaignManager({ makeId: () => `review-${++id}`, now: () => new Date(time) });
  campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "2.1", budget: 2, implementationCampaignId: "implementation-1", taskScope: "2.1" });
  campaigns.recordFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "finding", scope: "in_scope" });
  campaigns.recordFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "outside", summary: "outside", scope: "out_of_scope" });
  campaigns.dispositionFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Captain reproduced" });
  expect(campaigns.consume({ campaignId: "review-1", changeId: "change-a", projectId: "/project", kind: "fix", rootCauseId: "root-1", dispatchSummary: "fix root-1" })).toMatchObject({ consumed: 1, remaining: 1, dispatches: [{ kind: "fix", rootCauseId: "root-1" }] });
  expect(() => campaigns.consume({ campaignId: "review-1", changeId: "change-a", projectId: "/project", kind: "fix", rootCauseId: "outside", dispatchSummary: "outside" })).toThrow(/OUT_OF_SCOPE/);
  expect(() => campaigns.consume({ campaignId: "review-1", changeId: "change-a", projectId: "/project", kind: "fix", rootCauseId: "unknown", dispatchSummary: "unknown" })).toThrow(/UNKNOWN/);
  time = Date.parse("2026-07-22T12:01:00.000Z");
  campaigns.resolveFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", verification: { observedAt: new Date(time).toISOString(), commands: [{ id: "targeted", kind: "targeted", command: "npm test", exitCode: 0, summary: "passed", acceptanceRefs: ["review-finding:root-1"] }], acceptance: [{ ref: "review-finding:root-1", evidenceIds: ["targeted"] }] } });
  expect(() => campaigns.consume({ campaignId: "review-1", changeId: "change-a", projectId: "/project", kind: "fix", rootCauseId: "root-1", dispatchSummary: "repeat" })).toThrow(/NOT_OPEN/);
  campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "2.1", budget: 1, implementationCampaignId: "implementation-1", taskScope: "2.1" });
  expect(() => campaigns.consume({ campaignId: "review-2", changeId: "change-a", projectId: "/project", kind: "fix", rootCauseId: "root-1", dispatchSummary: "cross" })).toThrow(/UNKNOWN/);
});

test("review evidence and lifecycle mutations never auto-dispatch or mutate finite budget", () => {
  const campaigns = createReviewCampaignManager({ makeId: () => "review-1" });
  campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "2.1", budget: 2, implementationCampaignId: "implementation-1", taskScope: "2.1" });
  campaigns.recordFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Reviewer says NOT APPROVED and recommends fixer", scope: "in_scope", evidenceRef: "artifact:reviewer" });
  campaigns.recordFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "duplicate", scope: "in_scope", evidenceRef: "artifact:variant" });
  campaigns.dispositionFinding({ campaignId: "review-1", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "needs_clarification", rationale: "Requirement unclear" });
  expect(campaigns.status("review-1", "/project")).toMatchObject({ budget: 2, consumed: 0, remaining: 2, dispatches: [], findings: [{ occurrences: 2 }] });
  expect(() => campaigns.end({ campaignId: "review-1", changeId: "change-a", projectId: "/project", outcome: "accepted", summary: "reviewer approved" })).toThrow(/ACCEPTANCE_BLOCKED/);
  expect(campaigns.status("review-1", "/project")).toMatchObject({ status: "active", budget: 2, consumed: 0, remaining: 2, dispatches: [] });
});

test("fixed review scope rejects another implementation campaign, task scope, change, or project", () => {
  const campaigns = createReviewCampaignManager({ makeId: () => "review-1" });
  campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "task 2.1", budget: 1, implementationCampaignId: "implementation-1", taskScope: "2.1" });
  const common = { campaignId: "review-1", changeId: "change-a", projectId: "/project", implementationCampaignId: "implementation-1", taskScope: "2.1", kind: "review" as const };
  expect(() => campaigns.validateDispatchAuthority({ ...common, implementationCampaignId: "implementation-2" })).toThrow(/IMPLEMENTATION_CAMPAIGN_MISMATCH/);
  expect(() => campaigns.validateDispatchAuthority({ ...common, taskScope: "2.2" })).toThrow(/ACCEPTANCE_SCOPE_MISMATCH/);
  expect(() => campaigns.validateDispatchAuthority({ ...common, changeId: "change-b" })).toThrow(/CHANGE_MISMATCH/);
  expect(() => campaigns.validateDispatchAuthority({ ...common, projectId: "/other" })).toThrow(/PROJECT_MISMATCH/);
  expect(campaigns.status("review-1", "/project")).toMatchObject({ consumed: 0, remaining: 1, dispatches: [] });
});
