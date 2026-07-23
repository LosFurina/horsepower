import { expect, test } from "vitest";
import { createReviewCampaignManager } from "../../src/lifecycle/review-campaign.js";

test("Captain-defined finite budget is consumed and exhaustion blocks further dispatch", () => {
  const campaigns = createReviewCampaignManager({ makeId: () => "campaign-1" });
  const begun = campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "OpenSpec task 4.6 only", budget: 2 });
  expect(begun).toMatchObject({ campaignId: "campaign-1", budget: 2, consumed: 0, remaining: 2, status: "active" });
  campaigns.consume({ campaignId: begun.campaignId, changeId: "change-a", projectId: "/project", dispatchSummary: "review" });
  campaigns.consume({ campaignId: begun.campaignId, changeId: "change-a", projectId: "/project", dispatchSummary: "fix" });
  expect(campaigns.status(begun.campaignId, "/project")).toMatchObject({ consumed: 2, remaining: 0 });
  expect(() => campaigns.consume({ campaignId: begun.campaignId, changeId: "change-a", projectId: "/project", dispatchSummary: "review again" }))
    .toThrow("Review campaign budget exhausted: campaign-1");
});

test("findings deduplicate by root cause and preserve out-of-scope evidence", () => {
  const campaigns = createReviewCampaignManager({ makeId: () => "campaign-1" });
  campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "release modes", budget: 1 });
  campaigns.recordFinding({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project", rootCauseId: "umask-mode", summary: "asset mode differs", scope: "in_scope", evidenceRef: "evidence:1" });
  campaigns.recordFinding({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project", rootCauseId: "umask-mode", summary: "another syntax variant", scope: "in_scope", evidenceRef: "evidence:2" });
  campaigns.recordFinding({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project", rootCauseId: "new-language-parser", summary: "expand scanner grammar", scope: "out_of_scope", evidenceRef: "evidence:3" });
  expect(campaigns.status("campaign-1", "/project").findings).toEqual([
    expect.objectContaining({ rootCauseId: "umask-mode", occurrences: 2, evidenceRefs: ["evidence:1", "evidence:2"] }),
    expect.objectContaining({ rootCauseId: "new-language-parser", scope: "out_of_scope", occurrences: 1 }),
  ]);
});

test("only explicit human-reasoned override extends a budget and terminal campaigns cannot dispatch", () => {
  const campaigns = createReviewCampaignManager({ makeId: () => "campaign-1" });
  campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "task", budget: 1 });
  expect(() => campaigns.extend({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project", additionalBudget: 1, humanAuthorized: false, reason: "continue" }))
    .toThrow("human authorization");
  expect(() => campaigns.extend({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project", additionalBudget: 1, humanAuthorized: true, reason: " " }))
    .toThrow("reason");
  expect(campaigns.extend({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project", additionalBudget: 2, humanAuthorized: true, reason: "Human approved one more bounded pass" }))
    .toMatchObject({ budget: 3, overrideReasons: ["Human approved one more bounded pass"] });
  campaigns.end({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project", outcome: "accepted", summary: "Evidence accepted" });
  expect(() => campaigns.consume({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project", dispatchSummary: "late" }))
    .toThrow("is not active");
});

test("campaign correlation rejects another change or project for dispatch, mutation, and observation", () => {
  const campaigns = createReviewCampaignManager({ makeId: () => "campaign-1" });
  campaigns.begin({ changeId: "change-a", projectId: "/project-a", acceptanceScope: "task", budget: 1 });
  expect(() => campaigns.consume({ campaignId: "campaign-1", changeId: "change-b", projectId: "/project-a", dispatchSummary: "review" })).toThrow("belongs to change change-a");
  expect(() => campaigns.consume({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project-b", dispatchSummary: "review" })).toThrow("belongs to another project");
  expect(() => campaigns.recordFinding({ campaignId: "campaign-1", changeId: "change-b", projectId: "/project-a", rootCauseId: "r", summary: "s", scope: "in_scope" })).toThrow("belongs to change change-a");
  expect(() => campaigns.extend({ campaignId: "campaign-1", changeId: "change-a", projectId: "/project-b", additionalBudget: 1, humanAuthorized: true, reason: "human" })).toThrow("belongs to another project");
  expect(() => campaigns.end({ campaignId: "campaign-1", changeId: "change-b", projectId: "/project-a", outcome: "canceled", summary: "stop" })).toThrow("belongs to change change-a");
  expect(() => campaigns.status("campaign-1", "/project-b")).toThrow("belongs to another project");
});

const targetedVerification = (rootCauseId: string, observedAt = "2026-07-22T12:01:00.000Z", exitCode = 0) => ({
  observedAt,
  commands: [{ id: "targeted-1", kind: "targeted" as const, command: "npx vitest run regression.test.ts", exitCode, summary: "Targeted regression passed", acceptanceRefs: [`review-finding:${rootCauseId}`] }],
  acceptance: [{ ref: `review-finding:${rootCauseId}`, evidenceIds: ["targeted-1"] }],
});

function adjudicationCampaign() {
  let time = Date.parse("2026-07-22T12:00:00.000Z");
  const campaigns = createReviewCampaignManager({ makeId: () => "campaign-adjudication", now: () => new Date(time) });
  campaigns.begin({ changeId: "change-a", projectId: "/project", acceptanceScope: "tasks 2.1-5.4", budget: 3, implementationCampaignId: "implementation-1", taskScope: "2.1,2.2" });
  const advance = (iso: string) => { time = Date.parse(iso); };
  return { campaigns, advance };
}

test("in-scope findings start pending and only explicit bounded Captain dispositions change authority", () => {
  const { campaigns, advance } = adjudicationCampaign();
  const found = campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Unchecked result", scope: "in_scope", evidenceRef: "artifact:review-1" });
  expect(found.findings[0]).toMatchObject({ disposition: "pending", occurrences: 1, foundAt: "2026-07-22T12:00:00.000Z" });
  expect(() => campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: " ", evidenceRef: "artifact:captain" })).toThrow(/rationale/i);
  expect(() => campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "x".repeat(1_001) })).toThrow(/1000/);
  advance("2026-07-22T12:00:30.000Z");
  expect(campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Captain reproduced the missing guard", evidenceRef: "artifact:captain-check" }).findings[0]).toMatchObject({
    disposition: "accepted", resolution: "open", dispositionRationale: "Captain reproduced the missing guard", dispositionEvidenceRef: "artifact:captain-check", dispositionAt: "2026-07-22T12:00:30.000Z",
  });
  for (const disposition of ["rejected", "needs_clarification", "blocked_needs_human"] as const) {
    expect(campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition, rationale: `Captain technical decision: ${disposition}` }).findings[0]).toMatchObject({ disposition });
  }
  expect(campaigns.status("campaign-adjudication", "/project")).toMatchObject({ consumed: 0, remaining: 3, dispatches: [] });
});

test("duplicate occurrences preserve disposition and resolution while surfacing conflicting new evidence", () => {
  const { campaigns } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Original", scope: "in_scope", evidenceRef: "evidence:1" });
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Reproduced" });
  const duplicate = campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Variant", scope: "in_scope", evidenceRef: "evidence:2" });
  expect(duplicate.findings[0]).toMatchObject({ disposition: "accepted", resolution: "open", occurrences: 2, evidenceRefs: ["evidence:1", "evidence:2"] });
  expect(duplicate.findings[0]?.hasDispositionConflict).toBe(false);
  expect(duplicate).toMatchObject({ consumed: 0, remaining: 3, dispatches: [] });
});

test("disposition rejects unknown, out-of-scope, cross-change, cross-project, and cross-campaign findings", () => {
  const { campaigns } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "outside", summary: "Outside fixed scope", scope: "out_of_scope" });
  const input = { campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "outside", disposition: "rejected" as const, rationale: "Not in fixed acceptance" };
  expect(() => campaigns.dispositionFinding(input)).toThrow(/OUT_OF_SCOPE/);
  expect(() => campaigns.dispositionFinding({ ...input, rootCauseId: "missing" })).toThrow(/UNKNOWN/);
  expect(() => campaigns.dispositionFinding({ ...input, changeId: "change-b" })).toThrow(/CHANGE_MISMATCH/);
  expect(() => campaigns.dispositionFinding({ ...input, projectId: "/other" })).toThrow(/PROJECT_MISMATCH/);
  expect(() => campaigns.dispositionFinding({ ...input, campaignId: "other" })).toThrow(/CAMPAIGN_UNKNOWN/);
});

test("accepted-open finding resolves only with fresh successful claim-matched targeted evidence", () => {
  const { campaigns, advance } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Bug", scope: "in_scope" });
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Captain reproduced" });
  advance("2026-07-22T12:01:00.000Z");
  const resolved = campaigns.resolveFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", verification: targetedVerification("root-1") });
  expect(resolved.findings[0]).toMatchObject({ disposition: "accepted", resolution: "resolved", resolvedAt: "2026-07-22T12:01:00.000Z", resolutionVerification: { kind: "e2e" } });
  expect(resolved).toMatchObject({ consumed: 0, remaining: 3, dispatches: [] });
  expect(() => campaigns.resolveFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", verification: targetedVerification("root-1") })).toThrow(/ALREADY_RESOLVED/);
});

test.each([
  ["stale", targetedVerification("root-1", "2026-07-22T11:59:00.000Z"), /STALE/],
  ["failed", targetedVerification("root-1", "2026-07-22T12:01:00.000Z", 1), /COMMAND_FAILED/],
  ["missing reference", { ...targetedVerification("root-1"), acceptance: [{ ref: "review-finding:root-1", evidenceIds: ["missing"] }] }, /REFERENCE_MISSING/],
  ["mismatched root", targetedVerification("root-2"), /SCOPE_DRIFT/],
  ["worker report only", { workerReport: { status: "success" } }, /WORKER_REPORT_ONLY/],
] as const)("resolution rejects %s evidence without mutating finding", (_label, verification, error) => {
  const { campaigns, advance } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Bug", scope: "in_scope" });
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Captain reproduced" });
  advance("2026-07-22T12:01:00.000Z");
  expect(() => campaigns.resolveFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", verification: verification as never })).toThrow(error);
  expect(campaigns.status("campaign-adjudication", "/project").findings[0]).toMatchObject({ resolution: "open" });
});

test("invalid finding transitions cannot fabricate resolution", () => {
  const { campaigns } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "pending", summary: "Pending", scope: "in_scope" });
  expect(() => campaigns.resolveFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "pending", verification: targetedVerification("pending") })).toThrow(/NOT_ACCEPTED/);
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "pending", disposition: "rejected", rationale: "Invalid suggestion" });
  expect(() => campaigns.resolveFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "pending", verification: targetedVerification("pending") })).toThrow(/NOT_ACCEPTED/);
});

test("accepted campaign outcome requires every in-scope finding adjudicated and closed", () => {
  const { campaigns, advance } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "fix", summary: "Fix", scope: "in_scope" });
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "reject", summary: "Reject", scope: "in_scope" });
  expect(() => campaigns.end({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", outcome: "accepted", summary: "done" })).toThrow(/ACCEPTANCE_BLOCKED.*fix:pending.*reject:pending/);
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "fix", disposition: "accepted", rationale: "Valid" });
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "reject", disposition: "rejected", rationale: "Incorrect recommendation" });
  expect(() => campaigns.end({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", outcome: "accepted", summary: "done" })).toThrow(/fix:accepted\/open/);
  advance("2026-07-22T12:01:00.000Z");
  campaigns.resolveFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "fix", verification: targetedVerification("fix") });
  expect(campaigns.end({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", outcome: "accepted", summary: "All findings adjudicated" })).toMatchObject({ status: "ended", outcome: "accepted" });
});

test.each(["scope_changed", "blocked_needs_human", "canceled"] as const)("truthful %s outcome remains available with unresolved findings", (outcome) => {
  const { campaigns } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "pending", summary: "Pending", scope: "in_scope" });
  expect(campaigns.end({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", outcome, summary: "Cannot safely accept" })).toMatchObject({ status: "ended", outcome });
});

test("conflicting duplicate evidence blocks acceptance until explicit Captain acknowledgment without implicit reopen", () => {
  const { campaigns, advance } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Bug", scope: "in_scope", evidenceRef: "evidence:original" });
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Captain reproduced" });
  advance("2026-07-22T12:01:00.000Z");
  campaigns.resolveFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", verification: targetedVerification("root-1") });
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Materially conflicting reproduction", scope: "in_scope", evidenceRef: "evidence:conflict", materiallyConflictsDisposition: true });
  expect(() => campaigns.end({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", outcome: "accepted", summary: "done" })).toThrow(/ACCEPTANCE_BLOCKED/);
  const acknowledged = campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Captain inspected the new variant; existing targeted evidence still proves the same root cause fixed" });
  expect(acknowledged.findings[0]).toMatchObject({ disposition: "accepted", resolution: "resolved", hasDispositionConflict: false });
  expect(campaigns.end({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", outcome: "accepted", summary: "Conflict adjudicated" })).toMatchObject({ outcome: "accepted" });
});

test("rejected dispositions cannot reuse stale rationale to falsely close a finding", () => {
  const { campaigns } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Bug", scope: "in_scope" });
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Captain reproduced" });
  const before = JSON.stringify(campaigns.status("campaign-adjudication", "/project"));

  expect(() => campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "rejected", rationale: " " })).toThrow(/rationale/i);

  expect(JSON.stringify(campaigns.status("campaign-adjudication", "/project"))).toBe(before);
  expect(() => campaigns.end({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", outcome: "accepted", summary: "Must remain open" })).toThrow(/root-1:accepted\/open/);
});

test("materially conflicting evidence revokes fix authority until explicit Captain re-disposition", () => {
  const { campaigns } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Bug", scope: "in_scope" });
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Reproduced" });
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Conflicting evidence", scope: "in_scope", materiallyConflictsDisposition: true });
  const before = campaigns.status("campaign-adjudication", "/project");

  expect(() => campaigns.consume({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", kind: "fix", rootCauseId: "root-1", dispatchSummary: "fix" })).toThrow("REVIEW_FINDING_DISPOSITION_CONFLICT");
  expect(campaigns.status("campaign-adjudication", "/project")).toMatchObject({ consumed: before.consumed, remaining: before.remaining, dispatches: before.dispatches });
});

test("an overlong dispatch summary cannot consume review budget", () => {
  const { campaigns } = adjudicationCampaign();
  const before = JSON.stringify(campaigns.status("campaign-adjudication", "/project"));

  expect(() => campaigns.consume({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", dispatchSummary: "x".repeat(501) })).toThrow(/500/);

  expect(JSON.stringify(campaigns.status("campaign-adjudication", "/project"))).toBe(before);
});

test("an invalid outcome summary cannot make a review campaign terminal", () => {
  const { campaigns } = adjudicationCampaign();
  const before = JSON.stringify(campaigns.status("campaign-adjudication", "/project"));

  expect(() => campaigns.end({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", outcome: "canceled", summary: "x".repeat(501) })).toThrow(/500/);

  expect(JSON.stringify(campaigns.status("campaign-adjudication", "/project"))).toBe(before);
});

test("a rejected duplicate finding record leaves occurrence and conflict state unchanged", () => {
  const { campaigns } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Bug", scope: "in_scope" });
  campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "rejected", rationale: "Not reproducible" });
  const before = JSON.stringify(campaigns.status("campaign-adjudication", "/project"));

  expect(() => campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Duplicate", scope: "in_scope", evidenceRef: "x".repeat(2_049), materiallyConflictsDisposition: true })).toThrow(/2048/);

  expect(JSON.stringify(campaigns.status("campaign-adjudication", "/project"))).toBe(before);
});

test("an invalid disposition evidence reference cannot partially change adjudication", () => {
  const { campaigns } = adjudicationCampaign();
  campaigns.recordFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", summary: "Bug", scope: "in_scope" });
  const before = JSON.stringify(campaigns.status("campaign-adjudication", "/project"));

  expect(() => campaigns.dispositionFinding({ campaignId: "campaign-adjudication", changeId: "change-a", projectId: "/project", rootCauseId: "root-1", disposition: "accepted", rationale: "Reproduced", evidenceRef: "x".repeat(2_049) })).toThrow(/2048/);

  expect(JSON.stringify(campaigns.status("campaign-adjudication", "/project"))).toBe(before);
});
