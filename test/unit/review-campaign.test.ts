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
