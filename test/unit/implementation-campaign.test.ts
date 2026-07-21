import { expect, test } from "vitest";
import { createImplementationCampaignManager } from "../../src/lifecycle/implementation-campaign.js";

const base = { changeId: "change-a", projectId: "/project", taskScopes: ["4.7", "4.8"] };

test("requires an explicit process-lifetime user-selected mode and exact scope", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  expect(() => campaigns.authorizeDispatch({ campaignId: "missing", changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "implementation" }))
    .toThrow("Unknown implementation campaign");
  const campaign = campaigns.begin({ ...base, mode: "main_agent" });
  expect(campaign).toMatchObject({ campaignId: "implementation-1", mode: "main_agent", taskScopes: ["4.7", "4.8"], status: "active" });
  expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "5.3", workKind: "implementation" }))
    .toThrow("does not include task scope 5.3");
  expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-b", projectId: "/project", taskScope: "4.8", workKind: "implementation" }))
    .toThrow("belongs to change change-a");
});

test("main-Agent mode rejects delegation except separately authorized bounded review", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  const campaign = campaigns.begin({ ...base, mode: "main_agent" });
  for (const workKind of ["implementation", "research", "test", "fix"] as const) {
    expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind }))
      .toThrow("Main-Agent campaign prohibits worker dispatch");
  }
  expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "review", reviewCampaignId: "review-1" }))
    .toThrow("Reviewer is not user-authorized");
  campaigns.authorizeReviewer({ campaignId: campaign.campaignId, reviewCampaignId: "review-1", acceptanceScope: "OpenSpec 4.8", budget: 1 });
  expect(campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "review", reviewCampaignId: "review-1" }))
    .toMatchObject({ reviewerAuthorization: { consumed: 1, remaining: 0 } });
  expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "review", reviewCampaignId: "review-1" }))
    .toThrow("Reviewer authorization exhausted");
});

test("multi-Agent mode permits explicit delegation and records Captain-direct substantive reasons", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  const campaign = campaigns.begin({ ...base, mode: "multi_agent" });
  expect(campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.7", workKind: "implementation" }))
    .toMatchObject({ mode: "multi_agent" });
  expect(() => campaigns.recordCaptainDirect({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.7", reason: " " }))
    .toThrow("reason");
  expect(campaigns.recordCaptainDirect({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.7", reason: "Small integration edit avoids worker context setup" }))
    .toMatchObject({ captainDirect: [{ taskScope: "4.7", reason: "Small integration edit avoids worker context setup" }] });
});

test("switch, end, and process replacement invalidate prior authorization", () => {
  let id = 0;
  const campaigns = createImplementationCampaignManager({ makeId: () => `implementation-${++id}` });
  const first = campaigns.begin({ ...base, mode: "multi_agent" });
  const second = campaigns.begin({ ...base, mode: "main_agent" });
  expect(campaigns.status(first.campaignId, "/project")).toMatchObject({ status: "ended", outcome: "switched" });
  expect(() => campaigns.authorizeDispatch({ campaignId: first.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "implementation" })).toThrow("is not active");
  campaigns.end({ campaignId: second.campaignId, projectId: "/project" });
  expect(() => campaigns.authorizeDispatch({ campaignId: second.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "review" })).toThrow("is not active");
  const replacement = createImplementationCampaignManager({ makeId: () => "replacement" });
  expect(() => replacement.status(second.campaignId, "/project")).toThrow("Unknown implementation campaign");
});
