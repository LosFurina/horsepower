import { expect, test } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { createOpenSpecBoundary, type OpenSpecCommandResult } from "../../src/openspec/boundary.js";

const root = "/private/current-project";
const base: Record<string, OpenSpecCommandResult> = {
  "--version": { code: 0, stdout: "1.6.0\n", stderr: "" },
  "doctor --json": { code: 0, stdout: JSON.stringify({ root: { path: root, healthy: true } }), stderr: "" },
};
function candidate(name: string, completedTasks = 0, totalTasks = 1, status = "in-progress") { return { name, completedTasks, totalTasks, status }; }
function fixture(changes: unknown[], overrides: Record<string, OpenSpecCommandResult> = {}, tasks: Record<string, string> = {}) {
  const results: Record<string, OpenSpecCommandResult> = { ...base, "list --json": { code: 0, stdout: JSON.stringify({ changes, root: { path: root, source: "nearest" } }), stderr: "" }, ...overrides };
  return createOpenSpecBoundary({
    run: async (args) => results[args.join(" ")] ?? { code: 1, stdout: "", stderr: "unexpected" },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100, nlink: 1 }),
    readText: async (path) => {
      if (path.endsWith("SKILL.md")) return "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0";
      if (path.endsWith("opsx-apply.md")) return "Implement tasks from an OpenSpec change.";
      return tasks[path] ?? "";
    },
  });
}
function eligible(name: string, source = "## 1. Work\n- [ ] 1.1 Do work\n") {
  const path = `${root}/internal/${name}/tasks.md`;
  return {
    results: {
      [`status --change ${name} --json`]: { code: 0, stdout: JSON.stringify({ changeName: name, isComplete: true, artifactPaths: { tasks: { resolvedOutputPath: path } } }), stderr: "" },
      [`validate ${name} --strict --json`]: { code: 0, stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }), stderr: "" },
    }, tasks: { [path]: source },
  };
}

test("discovers zero, one, and multiple eligible changes in deterministic official order with bounded progress only", async () => {
  await expect(fixture([]).discoverUnfinishedChanges({ cwd: `${root}/src` })).resolves.toEqual([]);
  const z = eligible("z-change"), a = eligible("a-change", "## 1. Work\n- [x] 1.1 Done\n- [ ] 1.2 Todo\n");
  const boundary = fixture([candidate("z-change"), candidate("a-change", 1, 2)], { ...z.results, ...a.results }, { ...z.tasks, ...a.tasks });
  const found = await boundary.discoverUnfinishedChanges({ cwd: `${root}/src` });
  expect(found).toEqual([
    { changeId: "z-change", completedTasks: 0, totalTasks: 1 },
    { changeId: "a-change", completedTasks: 1, totalTasks: 2 },
  ]);
  expect(JSON.stringify(found)).not.toContain(root);
});

test("excludes completed, archived, unready, and taskless changes", async () => {
  const good = eligible("good"), unready = eligible("unready");
  unready.results["status --change unready --json"] = { code: 0, stdout: JSON.stringify({ changeName: "unready", isComplete: false }), stderr: "" };
  const boundary = fixture([
    candidate("good"), candidate("complete", 1, 1, "complete"), candidate("archived", 0, 1, "archived"), candidate("taskless", 0, 0), candidate("unready"),
  ], { ...good.results, ...unready.results }, { ...good.tasks, ...unready.tasks });
  await expect(boundary.discoverUnfinishedChanges({ cwd: root })).resolves.toEqual([{ changeId: "good", completedTasks: 0, totalTasks: 1 }]);
});

test.each([
  ["malformed JSON", { code: 0, stdout: "{", stderr: "" }, /malformed or truncated JSON/],
  ["truncated output", { code: 0, stdout: "{}", stderr: "", truncated: true }, /exceeded/],
  ["CLI failure", { code: 1, stdout: "", stderr: "/secret diagnostic" }, /failed; run openspec doctor/],
  ["CLI timeout", { code: 124, stdout: "", stderr: "", timedOut: true }, /timed out/],
] as const)("fails closed for %s without exposing diagnostics", async (_name, result, message) => {
  const error = await fixture([], { "list --json": result }).discoverUnfinishedChanges({ cwd: root }).catch((cause: Error) => cause);
  expect(error).toBeInstanceOf(Error); expect((error as Error).message).toMatch(message); expect((error as Error).message).not.toContain("secret");
});

test("rejects unsupported schemas, duplicate/invalid IDs, candidate limits, and project ambiguity", async () => {
  const discover = (output: unknown) => fixture([], { "list --json": { code: 0, stdout: JSON.stringify(output), stderr: "" } }).discoverUnfinishedChanges({ cwd: root });
  await expect(discover([])).rejects.toThrow("unsupported schema");
  await expect(discover({ changes: [candidate("same"), candidate("same")], root: { path: root, source: "nearest" } })).rejects.toThrow("duplicate change ID");
  await expect(discover({ changes: [candidate("../bad")], root: { path: root, source: "nearest" } })).rejects.toThrow("invalid change ID");
  await expect(discover({ changes: Array.from({ length: 101 }, (_, i) => candidate(`c-${i}`)), root: { path: root, source: "nearest" } })).rejects.toThrow("at most 100");
  await expect(discover({ changes: [], root: { path: "/another/project", source: "nearest" } })).rejects.toThrow("different project root");
  await expect(discover({ changes: [], root: { path: root, source: "registered" } })).rejects.toThrow("unsupported schema");
  await expect(discover({ changes: [candidate("huge", 0, 1_001)], root: { path: root, source: "nearest" } })).rejects.toThrow("invalid progress");
  await expect(discover({ changes: [candidate("mystery", 0, 1, "future-state")], root: { path: root, source: "nearest" } })).rejects.toThrow("unsupported status");
});

test("fails closed on strict validation failure, malformed tasks, and contradictory progress", async () => {
  const invalid = eligible("invalid"); invalid.results["validate invalid --strict --json"] = { code: 1, stdout: "{}", stderr: "private" };
  await expect(fixture([candidate("invalid")], invalid.results, invalid.tasks).discoverUnfinishedChanges({ cwd: root })).rejects.toThrow("could not validate change: invalid");
  const malformed = eligible("malformed", "not tasks");
  await expect(fixture([candidate("malformed")], malformed.results, malformed.tasks).discoverUnfinishedChanges({ cwd: root })).rejects.toThrow("could not validate change: malformed");
  const mismatch = eligible("mismatch");
  await expect(fixture([candidate("mismatch", 0, 2)], mismatch.results, mismatch.tasks).discoverUnfinishedChanges({ cwd: root })).rejects.toThrow("progress is ambiguous");
});

test.each([
  ["status timeout", "status --change stalled --json", { code: 124, stdout: "", stderr: "", timedOut: true }],
  ["status truncation", "status --change stalled --json", { code: 0, stdout: "{}", stderr: "", truncated: true }],
  ["status runner failure", "status --change stalled --json", { code: 2, stdout: "", stderr: "private" }],
  ["validation timeout", "validate stalled --strict --json", { code: 124, stdout: "", stderr: "", timedOut: true }],
  ["validation truncation", "validate stalled --strict --json", { code: 0, stdout: "{}", stderr: "", truncated: true }],
] as const)("fails closed instead of excluding a candidate on %s", async (_name, command, result) => {
  const item = eligible("stalled");
  await expect(fixture([candidate("stalled")], { ...item.results, [command]: result }, item.tasks)
    .discoverUnfinishedChanges({ cwd: root })).rejects.toThrow("could not validate change: stalled");
});

test.each([
  ["doctor timeout", { code: 124, stdout: "", stderr: "", timedOut: true }, /doctor timed out/],
  ["doctor truncation", { code: 0, stdout: "{}", stderr: "", truncated: true }, /doctor output exceeded/],
] as const)("fails closed on bounded installation %s", async (_name, result, message) => {
  await expect(fixture([], { "doctor --json": result }).discoverUnfinishedChanges({ cwd: root })).rejects.toThrow(message);
});

test("validates installation and project exactly once per discovery while confirmation stays fresh", async () => {
  const names = ["one", "two", "three"];
  const items = names.map((name) => eligible(name));
  const calls: string[] = [];
  const results: Record<string, OpenSpecCommandResult> = {
    ...base,
    "list --json": { code: 0, stdout: JSON.stringify({ changes: names.map((name) => candidate(name)), root: { path: root, source: "nearest" } }), stderr: "" },
    ...Object.assign({}, ...items.map((item) => item.results)),
  };
  const tasks = Object.assign({}, ...items.map((item) => item.tasks));
  const boundary = createOpenSpecBoundary({
    run: async (args) => { calls.push(args.join(" ")); return results[args.join(" ")] ?? { code: 1, stdout: "", stderr: "unexpected" }; },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100, nlink: 1 }),
    readText: async (path) => path.endsWith("SKILL.md") ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0" : path.endsWith("opsx-apply.md") ? "Implement tasks from an OpenSpec change." : tasks[path] ?? "",
  });
  await boundary.discoverUnfinishedChanges({ cwd: root });
  expect(calls.filter((call) => call === "--version")).toHaveLength(1);
  expect(calls.filter((call) => call === "doctor --json")).toHaveLength(1);
  expect(calls.filter((call) => call === "list --json")).toHaveLength(1);
  expect(calls.filter((call) => call.startsWith("status --change"))).toHaveLength(3);
  expect(calls.filter((call) => call.startsWith("validate "))).toHaveLength(3);

  await boundary.discoverUnfinishedChanges({ cwd: root });
  const inventory = await boundary.loadTaskInventory({ cwd: root, changeId: "one" });
  tasks[`${root}/internal/one/tasks.md`] = "## 1. Work\n- [x] 1.1 Do work\n";
  await expect(boundary.revalidateUnfinishedChange({ cwd: root, changeId: "one", inventoryDigest: inventory.digest }))
    .rejects.toThrow("changed before campaign confirmation");
  expect(calls.filter((call) => call === "--version")).toHaveLength(4);
  expect(calls.filter((call) => call === "doctor --json")).toHaveLength(4);
});

test("uses four candidate slots and preserves official order after out-of-order settlement", async () => {
  const names = ["first", "second", "third", "fourth", "fifth", "sixth"];
  const items = names.map((name) => eligible(name));
  const results: Record<string, OpenSpecCommandResult> = {
    ...base,
    "list --json": { code: 0, stdout: JSON.stringify({ changes: names.map((name) => candidate(name)), root: { path: root, source: "nearest" } }), stderr: "" },
    ...Object.assign({}, ...items.map((item) => item.results)),
  };
  const tasks = Object.assign({}, ...items.map((item) => item.tasks));
  let inFlight = 0, maximum = 0;
  const settled: string[] = [];
  const boundary = createOpenSpecBoundary({
    run: async (args) => {
      const command = args.join(" ");
      if (command.startsWith("status --change")) {
        const name = args[2]!;
        inFlight += 1; maximum = Math.max(maximum, inFlight);
        await delay((names.length - names.indexOf(name)) * 5);
        inFlight -= 1; settled.push(name);
      }
      return results[command] ?? { code: 1, stdout: "", stderr: "unexpected" };
    },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100, nlink: 1 }),
    readText: async (path) => path.endsWith("SKILL.md") ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0" : path.endsWith("opsx-apply.md") ? "Implement tasks from an OpenSpec change." : tasks[path] ?? "",
  });
  const found = await boundary.discoverUnfinishedChanges({ cwd: root });
  expect(maximum).toBe(4);
  expect(settled.slice(0, 4)).not.toEqual(names.slice(0, 4));
  expect(found.map((item) => item.changeId)).toEqual(names);
});

test("chooses concurrent fatal diagnostics deterministically in official order", async () => {
  const names = ["official-first", "official-second", "valid-last"];
  const items = names.map((name) => eligible(name));
  items[0]!.results["validate official-first --strict --json"] = { code: 1, stdout: "{}", stderr: "private-first" };
  items[1]!.results["validate official-second --strict --json"] = { code: 1, stdout: "{}", stderr: "private-second" };
  const results: Record<string, OpenSpecCommandResult> = {
    ...base,
    "list --json": { code: 0, stdout: JSON.stringify({ changes: names.map((name) => candidate(name)), root: { path: root, source: "nearest" } }), stderr: "" },
    ...Object.assign({}, ...items.map((item) => item.results)),
  };
  const tasks = Object.assign({}, ...items.map((item) => item.tasks));
  const boundary = createOpenSpecBoundary({
    run: async (args) => {
      const command = args.join(" ");
      if (command === "validate official-first --strict --json") await delay(30);
      return results[command] ?? { code: 1, stdout: "", stderr: "unexpected" };
    },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false, size: 100, nlink: 1 }),
    readText: async (path) => path.endsWith("SKILL.md") ? "name: openspec-apply-change\nauthor: openspec\nallowed-tools: Bash(openspec:*)\ngeneratedBy: 1.6.0" : path.endsWith("opsx-apply.md") ? "Implement tasks from an OpenSpec change." : tasks[path] ?? "",
  });
  const error = await boundary.discoverUnfinishedChanges({ cwd: root }).catch((cause: Error) => cause);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("official-first");
  expect((error as Error).message).not.toContain("official-second");
  expect((error as Error).message).not.toContain("private");
});
