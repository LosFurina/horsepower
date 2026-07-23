import { expect, test } from "vitest";
import { createImplementationCampaignManager, type CampaignPlanSnapshot } from "../../src/lifecycle/implementation-campaign.js";

const digest = "a".repeat(64);
const planDigest = "b".repeat(64);
const tasks = [
  { id: "4.7", description: "First", status: "pending" as const, sectionId: "4" },
  { id: "4.8", description: "Second", status: "pending" as const, sectionId: "4" },
];
function planFor(taskIds: readonly string[]): CampaignPlanSnapshot {
  return {
    digest: planDigest,
    testIntensity: "standard",
    gateStrictness: "required",
    caseRefs: ["TC-1"],
    gateRefs: ["G-1"],
    selectedTaskMappings: taskIds.map((taskId) => ({ taskId, caseRefs: ["TC-1"], gateRefs: ["G-1"], nonApplicabilityRefs: [] })),
  };
}
const base = {
  changeId: "change-a",
  projectId: "/project",
  selectedTaskIds: ["4.7", "4.8"],
  selectedTasks: tasks,
  inventoryDigest: digest,
  plan: planFor(["4.7", "4.8"]),
};

test("requires explicit mode and confirmed canonical task snapshot", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  expect(() => campaigns.authorizeDispatch({ campaignId: "missing", changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "implementation" })).toThrow("Unknown implementation campaign");
  const campaign = campaigns.begin({ ...base, selectedTaskIds: ["4.8", "4.7", "4.8"], mode: "main_agent" });
  expect(campaign).toMatchObject({ campaignId: "implementation-1", mode: "main_agent", selectedTaskIds: ["4.8", "4.7"], inventoryDigest: digest, status: "active" });
  expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "5.3", workKind: "implementation" })).toThrow("does not include task IDs: 5.3");
  expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-b", projectId: "/project", taskScope: "4.8", workKind: "implementation" })).toThrow("belongs to change change-a");
});

test.each([
  [{ ...base, selectedTaskIds: ["4.7-4.8"], plan: planFor(["4.7-4.8"]) }, "exact OpenSpec task IDs"],
  [{ ...base, selectedTaskIds: ["work"], plan: planFor(["work"]) }, "exact OpenSpec task IDs"],
  [{ ...base, selectedTaskIds: ["4.7"], selectedTasks: [tasks[1]!], plan: planFor(["4.7"]) }, "missing selected task: 4.7"],
  [{ ...base, selectedTaskIds: ["4.7"], selectedTasks: [...tasks], plan: planFor(["4.7"]) }, "unselected tasks"],
  [{ ...base, selectedTaskIds: ["4.7"], selectedTasks: [{ ...tasks[0]!, status: "complete" as const }], plan: planFor(["4.7"]) }, "already complete: 4.7"],
  [{ ...base, inventoryDigest: "bad" }, "digest is invalid"],
  [{ ...base, plan: { ...planFor(["4.7", "4.8"]), digest: "bad" } }, "plan digest is invalid"],
  [{ ...base, plan: { ...planFor(["4.7", "4.8"]), selectedTaskMappings: [{ taskId: "4.7", caseRefs: ["TC-1"], gateRefs: ["G-1"], nonApplicabilityRefs: [] }] } }, "task mappings do not match selected tasks"],
])("rejects invalid canonical campaign input", (input, message) => {
  const campaigns = createImplementationCampaignManager();
  expect(() => campaigns.begin({ ...input, mode: "multi_agent" })).toThrow(message);
});

test("rejects a campaign larger than the claim-matched manifest can represent", () => {
  const selectedTasks = Array.from({ length: 101 }, (_, index) => ({ id: `1.${index + 1}`, description: `Task ${index + 1}`, status: "pending" as const, sectionId: "1" }));
  const campaigns = createImplementationCampaignManager();
  expect(() => campaigns.begin({
    changeId: "change-a", projectId: "/project", selectedTaskIds: selectedTasks.map(({ id }) => id), selectedTasks, inventoryDigest: digest, plan: planFor(selectedTasks.map(({ id }) => id)), mode: "multi_agent",
  })).toThrow("permits at most 100 task IDs");
});

test("campaign begin snapshots official plan digest and selected-task mappings", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-plan" });
  const campaign = campaigns.begin({ ...base, mode: "multi_agent" });
  expect(campaign.plan).toEqual(planFor(["4.7", "4.8"]));
  expect(campaigns.currentContinuation("/project")).toMatchObject({ planDigest, inventoryDigest: digest });
});

test("campaign creation failure is atomic and preserves active authority", () => {
  let allocation = 0;
  const campaigns = createImplementationCampaignManager({
    makeId: () => {
      allocation += 1;
      if (allocation === 2) throw new Error("ID allocation failed");
      return `implementation-${allocation}`;
    },
  });
  const active = campaigns.begin({ ...base, mode: "multi_agent" });

  expect(() => campaigns.begin({ ...base, mode: "main_agent" })).toThrow("ID allocation failed");
  expect(campaigns.status(active.campaignId, "/project")).toMatchObject({ status: "active" });
  expect(campaigns.status(active.campaignId, "/project")).not.toHaveProperty("outcome");
  expect(campaigns.currentContinuation("/project")).toMatchObject({ campaignId: active.campaignId, disposition: "active" });
});

test("main-Agent mode rejects delegation except separately authorized bounded review", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  const campaign = campaigns.begin({ ...base, mode: "main_agent" });
  for (const workKind of ["implementation", "research", "test", "fix"] as const) expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind })).toThrow("Main-Agent campaign prohibits worker dispatch");
  expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "review", reviewCampaignId: "review-1" })).toThrow("Reviewer is not user-authorized");
  campaigns.authorizeReviewer({ campaignId: campaign.campaignId, reviewCampaignId: "review-1", acceptanceScope: "OpenSpec 4.8", budget: 1 });
  expect(campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "review", reviewCampaignId: "review-1" })).toMatchObject({ reviewerAuthorization: { consumed: 1, remaining: 0 } });
});

test("multi-Agent exact-ID delegation supports selected subsets and rejects ranges, duplicates, and expansion", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  const campaign = campaigns.begin({ ...base, mode: "multi_agent" });
  expect(campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.7,4.8", workKind: "implementation" })).toMatchObject({ dispatches: [{ taskIds: ["4.7", "4.8"], workKind: "implementation" }] });
  for (const taskScope of ["4.7-4.8", "work", "4.7,4.7", "4.7,5.1"]) expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope, workKind: "implementation" })).toThrow();
  expect(() => campaigns.recordCaptainDirect({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.7", reason: " " })).toThrow("reason");
  expect(campaigns.recordCaptainDirect({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.7", reason: "Small integration" })).toMatchObject({ captainDirect: [{ taskIds: ["4.7"], reason: "Small integration" }] });
});

test("continuation lease preserves exact identity, bounds generations, and invalidates", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "campaign-lease" });
  const campaign = campaigns.begin({ ...base, mode: "multi_agent" });
  expect(campaigns.currentContinuation("/project")).toMatchObject({
    campaignId: campaign.campaignId, changeId: "change-a", selectedTaskIds: ["4.7", "4.8"],
    inventoryDigest: digest, planDigest, mode: "multi_agent", generation: 0, disposition: "active",
  });
  const first = campaigns.beginContinuationGeneration(campaign.campaignId, "/project", 7);
  expect(first).toMatchObject({ generation: 7, queuedGeneration: 7 });
  expect(campaigns.beginContinuationGeneration(campaign.campaignId, "/project", 7)).toBeUndefined();
  campaigns.setContinuationDisposition(campaign.campaignId, "paused");
  expect(campaigns.beginContinuationGeneration(campaign.campaignId, "/project", 8)).toBeUndefined();
  campaigns.setContinuationDisposition(campaign.campaignId, "active");
  expect(campaigns.beginContinuationGeneration(campaign.campaignId, "/project", 8)).toMatchObject({ generation: 8 });
  campaigns.setContinuationDisposition(campaign.campaignId, "terminal");
  expect(campaigns.beginContinuationGeneration(campaign.campaignId, "/project", 9)).toBeUndefined();
  expect(campaigns.currentContinuation("/other")).toBeUndefined();
  const selected = campaigns.currentContinuation("/project")!;
  selected.selectedTaskIds.push("9.9");
  expect(campaigns.currentContinuation("/project")!.selectedTaskIds).toEqual(["4.7", "4.8"]);
});

test("switch, end, project ownership, and process replacement invalidate prior authorization", () => {
  let id = 0;
  const campaigns = createImplementationCampaignManager({ makeId: () => `implementation-${++id}` });
  const first = campaigns.begin({ ...base, mode: "multi_agent" });
  const second = campaigns.begin({ ...base, mode: "main_agent" });
  expect(campaigns.status(first.campaignId, "/project")).toMatchObject({ status: "ended", outcome: "switched" });
  expect(() => campaigns.status(second.campaignId, "/other")).toThrow("another project");
  campaigns.end({ campaignId: second.campaignId, projectId: "/project" });
  expect(() => campaigns.authorizeDispatch({ campaignId: second.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.8", workKind: "review" })).toThrow("is not active");
  expect(() => createImplementationCampaignManager().status(second.campaignId, "/project")).toThrow("Unknown implementation campaign");
});

test("corrective dispatch requires explicit review campaign and root-cause correlation before recording", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  const campaign = campaigns.begin({ ...base, mode: "multi_agent" });
  const common = { campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.7", workKind: "fix" as const };
  expect(() => campaigns.authorizeDispatch(common)).toThrow(/requires a review campaign/);
  expect(() => campaigns.authorizeDispatch({ ...common, reviewCampaignId: "review-1" })).toThrow(/root cause ID/);
  expect(campaigns.status(campaign.campaignId, "/project").dispatches).toEqual([]);
  expect(campaigns.authorizeDispatch({ ...common, reviewCampaignId: "review-1", reviewFindingRootCauseId: "root-1" })).toMatchObject({ dispatches: [{ workKind: "fix", reviewCampaignId: "review-1", reviewFindingRootCauseId: "root-1" }] });
});

test("reviewer dispatch cannot smuggle corrective root-cause authority", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  const campaign = campaigns.begin({ ...base, mode: "multi_agent" });
  expect(() => campaigns.authorizeDispatch({ campaignId: campaign.campaignId, changeId: "change-a", projectId: "/project", taskScope: "4.7", workKind: "review", reviewCampaignId: "review-1", reviewFindingRootCauseId: "root-1" })).toThrow(/Only corrective dispatch/);
  expect(campaigns.status(campaign.campaignId, "/project").dispatches).toEqual([]);
});

test("main-Agent reviewer authorization retains its fixed acceptance scope for runtime correlation", () => {
  const campaigns = createImplementationCampaignManager({ makeId: () => "implementation-1" });
  const campaign = campaigns.begin({ ...base, mode: "main_agent" });
  campaigns.authorizeReviewer({ campaignId: campaign.campaignId, reviewCampaignId: "review-1", acceptanceScope: "exact OpenSpec tasks 4.7,4.8", budget: 1 });
  expect(campaigns.status(campaign.campaignId, "/project").reviewerAuthorizations).toEqual([{ reviewCampaignId: "review-1", acceptanceScope: "exact OpenSpec tasks 4.7,4.8", budget: 1, consumed: 0, remaining: 1 }]);
});
