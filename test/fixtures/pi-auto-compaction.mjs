import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const extensionPath = process.env.HORSEPOWER_EXTENSION_PATH;
const scenario = process.env.HORSEPOWER_COMPACTION_SCENARIO;
const logPath = process.env.HORSEPOWER_COMPACTION_LOG;
const authorityMode = process.env.HORSEPOWER_COMPACTION_AUTHORITY ?? "synthetic";
const helperPath = process.env.HORSEPOWER_COMPACTION_RUNTIME_HELPER;
const { registerHorsepowerExtension } = await import(pathToFileURL(extensionPath).href);

const identity = {
  campaignId: "campaign-e2e",
  projectId: process.cwd(),
  changeId: "change-e2e",
  selectedTaskIds: ["3.1", "3.2"],
  mode: "multi_agent",
  generation: 0,
};
let preparationCount = 0;

function record(event) {
  appendFileSync(logPath, `${JSON.stringify(event)}\n`);
}

function syntheticRuntime() {
  return {
    value: {
      execute: async () => ({}),
      currentCampaignContinuation: (projectId) => {
        record({ type: "current", projectId, authority: "synthetic" });
        return projectId === identity.projectId ? identity : undefined;
      },
      prepareCampaignContinuation: async (input) => {
        preparationCount += 1;
        record({ type: "prepare", input, preparationCount, authority: "synthetic" });
        if (scenario === "scope-drift") return undefined;
        // Keep the next synthetic provider turn observably newer than Pi's
        // saved compaction entry (both use millisecond timestamps).
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        return { ...identity, generation: input.generation };
      },
    },
    cleanup: async () => {},
    abandon: () => {},
  };
}

function inventoryFixture(projectRoot, options = {}) {
  const firstStatus = options.completeFirst ? "complete" : "pending";
  const sections = [{
    id: "3",
    title: "Integration and Acceptance",
    tasks: [
      { id: "3.1", description: "Update documentation", status: firstStatus, sectionId: "3" },
      { id: "3.2", description: "Add real Pi E2E fixtures", status: "pending", sectionId: "3" },
    ],
  }];
  const digest = createHash("sha256").update(JSON.stringify(sections.map((section) => ({
    id: section.id,
    title: section.title,
    tasks: section.tasks.map((task) => ({
      id: task.id,
      description: task.description,
      status: task.status,
      sectionId: task.sectionId,
    })),
  })))).digest("hex");
  return {
    changeId: "change-e2e",
    projectRoot,
    sections,
    digest,
  };
}

function planFixture(ids, digest = "c".repeat(64)) {
  return {
    changeId: "change-e2e",
    testIntensity: "standard",
    gateStrictness: "required",
    cases: ids.map((id, index) => ({
      id: `TC-${index + 1}`,
      title: `Case for ${id}`,
      maps: [`task:${id}`],
      level: "unit",
      purpose: `Prove task ${id}`,
      preconditions: "fixture",
      action: "exercise",
      expected: "pass",
      failure: "fail",
      disposition: "required",
    })),
    gates: [{
      id: "G-1",
      title: "OpenSpec",
      maps: ids.map((id) => `task:${id}`),
      intent: "openspec validate --strict",
      scope: "selected change",
      pass: "exit 0",
      disposition: "required",
      phase: "campaign",
      waiver: "none",
      floor: "openspec",
    }],
    nonApplicability: [],
    coverageRefs: ids.map((id) => `task:${id}`),
    digest,
  };
}

async function productionRuntime() {
  if (!helperPath) throw new Error("production authority fixture requires HORSEPOWER_COMPACTION_RUNTIME_HELPER");
  const { createHorsepowerRuntime } = await import(pathToFileURL(helperPath).href);

  const projectRoot = resolve(process.cwd());
  const changeId = "change-e2e";
  const homeDir = join(projectRoot, "home");
  const agentsDir = join(projectRoot, "agents");
  await mkdir(join(homeDir, ".pi", "agent", "horsepower"), { recursive: true });
  await mkdir(agentsDir, { recursive: true });

  // Official on-disk OpenSpec artifacts are parsed by the production boundary.
  const changeDir = join(projectRoot, "openspec", "changes", changeId);
  const specsDir = join(changeDir, "specs", "continuation");
  await mkdir(specsDir, { recursive: true });
  const tasksPath = join(changeDir, "tasks.md");
  const designPath = join(changeDir, "design.md");
  const specPath = join(specsDir, "spec.md");
  const writeTasks = async (completeFirst = false) => writeFile(tasksPath, [
    "## 3. Integration and Acceptance",
    "",
    `- [${completeFirst ? "x" : " "}] 3.1 Update documentation`,
    "- [ ] 3.2 Add real Pi E2E fixtures",
    "",
  ].join("\n"));
  await writeTasks(false);
  await writeFile(specPath, [
    "## ADDED Requirements", "", "### Requirement: Production continuation authority",
    "Production authority SHALL remain current.", "", "#### Scenario: Active campaign remains current",
    "- **WHEN** automatic compaction settles", "- **THEN** the exact campaign continues", "",
  ].join("\n"));
  const acceptanceMaps = "scenario:Production continuation authority/Active campaign remains current, task:3.1, task:3.2";
  const caseBlock = (id, taskId) => [
    `#### ${id}: production task ${taskId}`, `- maps: ${acceptanceMaps}`, "- level: unit",
    `- purpose: prove production task ${taskId} authority`, "- preconditions: official on-disk OpenSpec fixture",
    "- action: force official Pi automatic compaction", "- expected: exact campaign continuation remains authorized",
    "- failure: stale or broadened campaign authority continued", "- disposition: required", "",
  ].join("\n");
  const gate = (id, floor) => [
    `#### ${id}: ${floor} floor`, `- maps: ${acceptanceMaps}`, `- intent: verify ${floor} continuation behavior`,
    "- scope: production runtime and official fixture", "- pass: mapped authority remains exact and successful",
    "- disposition: required", "- phase: completion", "- waiver: no fixture waiver is permitted", `- floor: ${floor}`, "",
  ].join("\n");
  await writeFile(designPath, [
    "## Test and Gate Plan", "", "### Profiles", "- testIntensity: targeted", "- gateStrictness: required", "",
    "### Test Cases", "", caseBlock("TC-1", "3.1"), caseBlock("TC-2", "3.2"),
    "### Gates", "", ...["openspec", "privacy", "security", "compatibility", "terminal-truth", "e2e"].map((floor, index) => gate(`G-${index + 1}`, floor)),
  ].join("\n"));
  let version = "1.6.0";
  let doctorHealthy = true;
  let doctorPath = projectRoot;
  let isComplete = true;
  let validateFailed = 0;

  const runOpenSpec = async (args) => {
    record({ type: "openspec-cli", args: [...args] });
    if (args[0] === "--version") return { code: 0, stdout: `${version}\n`, stderr: "", truncated: false };
    if (args[0] === "doctor") {
      return {
        code: 0,
        stdout: JSON.stringify({ root: { healthy: doctorHealthy, path: doctorPath } }),
        stderr: "",
        truncated: false,
      };
    }
    if (args[0] === "status") {
      return {
        code: isComplete ? 0 : 1,
        stdout: isComplete
          ? JSON.stringify({
            changeName: changeId,
            isComplete: true,
            artifactPaths: {
              tasks: { resolvedOutputPath: tasksPath },
              design: { resolvedOutputPath: designPath },
              specs: { existingOutputPaths: [specPath] },
            },
          })
          : "",
        stderr: isComplete ? "" : "not ready",
        truncated: false,
      };
    }
    if (args[0] === "validate") {
      return {
        code: validateFailed === 0 ? 0 : 1,
        stdout: JSON.stringify({ summary: { totals: { failed: validateFailed } } }),
        stderr: "",
        truncated: false,
      };
    }
    return { code: 1, stdout: "", stderr: `unexpected openspec args: ${args.join(" ")}`, truncated: false };
  };

  const runtime = createHorsepowerRuntime({
    homeDir,
    bundledAgentsDir: agentsDir,
    runOpenSpec,
    readText: async (path) => {
      if (path.endsWith("SKILL.md")) {
        return `name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: ${version}\n`;
      }
      if (path.endsWith("opsx-apply.md")) return "Implement tasks from an OpenSpec change";
      const { readFile } = await import("node:fs/promises");
      return readFile(path, "utf8");
    },
    manager: {
      list: () => [],
      status: () => undefined,
      read: () => undefined,
      abort: async () => undefined,
      destroy: async () => undefined,
      create: async () => { throw new Error("production compaction fixture must not create workers"); },
      send: async () => { throw new Error("production compaction fixture must not send worker messages"); },
      waitForMessage: async () => { throw new Error("production compaction fixture must not wait for workers"); },
      messageStatus: () => undefined,
      destroyAll: async () => undefined,
      abandonAll: () => {},
    },
    oneShot: {
      single: async () => { throw new Error("production compaction fixture must not launch one-shot work"); },
      parallel: async () => { throw new Error("production compaction fixture must not launch parallel work"); },
      chain: async () => { throw new Error("production compaction fixture must not launch chain work"); },
    },
  });

  const inventory = await runtime.loadImplementationTaskInventory({ changeId, projectId: projectRoot });
  const plan = await runtime.loadImplementationTestAndGatePlan({ changeId, projectId: projectRoot });
  record({ type: "openspec-inventory", changeId, digest: inventory.digest, pending: inventory.sections.flatMap((section) => section.tasks).filter((task) => task.status === "pending").map((task) => task.id) });
  record({ type: "openspec-plan", changeId, digest: plan.digest });
  const selectedTaskIds = ["3.1", "3.2"];
  const selectedTasks = inventory.sections.flatMap((section) => section.tasks)
    .filter((task) => selectedTaskIds.includes(task.id))
    .map((task) => ({
      id: task.id,
      description: task.description,
      status: "pending",
      sectionId: task.sectionId,
      sectionTitle: inventory.sections.find((section) => section.id === task.sectionId)?.title,
    }));

  const campaign = await runtime.beginImplementationCampaign({
    changeId,
    projectId: projectRoot,
    selectedTaskIds,
    selectedTasks,
    inventoryDigest: inventory.digest,
    planDigest: plan.digest,
    mode: "multi_agent",
  });
  record({
    type: "campaign-created",
    campaignId: campaign.campaignId,
    changeId,
    selectedTaskIds,
    mode: "multi_agent",
    inventoryDigest: inventory.digest,
    planDigest: plan.digest,
    authority: "production",
  });

  if (scenario === "scope-drift") {
    await writeTasks(true);
    record({ type: "openspec-drift", field: "task-3.1-status", value: "complete" });
  }

  return {
    value: {
      execute: (...args) => runtime.execute(...args),
      currentCampaignContinuation: (projectId) => {
        const lease = runtime.currentCampaignContinuation(projectId);
        record({
          type: "current",
          projectId,
          authority: "production",
          lease: lease ? {
            campaignId: lease.campaignId,
            changeId: lease.changeId,
            selectedTaskIds: lease.selectedTaskIds,
            mode: lease.mode,
            generation: lease.generation,
            disposition: lease.disposition,
          } : null,
        });
        return lease;
      },
      prepareCampaignContinuation: async (input) => {
        preparationCount += 1;
        record({ type: "prepare", input, preparationCount, authority: "production" });
        const result = await runtime.prepareCampaignContinuation(input);
        record({
          type: "prepare-result",
          preparationCount,
          authority: "production",
          result: result ? {
            campaignId: result.campaignId,
            changeId: result.changeId,
            selectedTaskIds: result.selectedTaskIds,
            mode: result.mode,
            generation: result.generation,
            disposition: result.disposition,
          } : null,
        });
        // Keep the next provider turn observably newer than Pi's saved
        // compaction entry timestamps under rapid fixture turnaround.
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        return result;
      },
    },
    cleanup: async () => { await runtime.shutdown(); },
    abandon: () => { runtime.abandon(); },
  };
}

export default async function fixture(pi) {
  const lease = authorityMode === "production"
    ? await productionRuntime()
    : syntheticRuntime();

  // Keep the fixture deterministic while Pi still owns preparation, saving,
  // event ordering, native retry, and the next turn.
  // Register pending arbitration before Horsepower so a real follow-up enters
  // Pi's pending queue before Horsepower observes the same agent_settled event.
  let pendingInjected = false;
  pi.on("session_compact", (event) => {
    if (scenario !== "pending" || pendingInjected || !event.compactionEntry || event.willRetry !== false) return;
    pendingInjected = true;
    try {
      // Queue while compaction is still settling, before Horsepower arms its
      // generation. At agent_settled this user work is either pending or active;
      // both states must take precedence over automatic continuation.
      void pi.sendUserMessage("User steering remains pending during settlement.", { deliverAs: "followUp" });
      record({ type: "pending-injected", authority: authorityMode, reason: event.reason });
    } catch (cause) {
      record({ type: "pending-inject-error", message: cause instanceof Error ? cause.message : String(cause) });
    }
  });

  registerHorsepowerExtension(pi, {
    acquireRuntime: () => lease,
  });

  pi.on("session_before_compact", (event) => {
    record({ type: "before", reason: event.reason, willRetry: event.willRetry });
    return {
      compaction: {
        summary: `official Pi E2E summary ${event.reason}`,
        firstKeptEntryId: event.preparation.firstKeptEntryId,
        tokensBefore: event.preparation.tokensBefore,
        details: { fixture: "auto-compaction" },
      },
    };
  });
  pi.on("session_compact", (event) => {
    record({
      type: "compact",
      reason: event.reason,
      willRetry: event.willRetry,
      saved: Boolean(event.compactionEntry),
      authority: authorityMode,
    });
  });
  pi.on("agent_settled", (_event, ctx) => {
    record({
      type: "settled",
      authority: authorityMode,
      idle: typeof ctx?.isIdle === "function" ? ctx.isIdle() : null,
      hasPendingMessages: typeof ctx?.hasPendingMessages === "function" ? ctx.hasPendingMessages() : null,
    });
  });
}
