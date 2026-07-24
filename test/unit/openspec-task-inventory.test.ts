import { expect, test } from "vitest";

const valid = `# Tasks

## 1. Parser

- [ ] 1.1 Parse pending tasks
  - Check: Run the focused parser test
  - Check: Observe the stable digest
- [x] 1.2 Preserve completed tasks

## 2. Boundary

- [ ] 2.1 Load the official artifact
`;

test("parses ordered numbered sections and canonical pending/completed tasks with a stable digest", async () => {
  const { parseOpenSpecTaskInventory } = await import("../../src/openspec/task-inventory.js");
  const first = parseOpenSpecTaskInventory(valid, { changeId: "change-a", projectRoot: "/project", tasksPath: "/project/openspec/changes/change-a/tasks.md" });
  const second = parseOpenSpecTaskInventory(valid, { changeId: "change-a", projectRoot: "/project", tasksPath: "/project/openspec/changes/change-a/tasks.md" });

  expect(first).toMatchObject({
    changeId: "change-a", projectRoot: "/project",
    sections: [
      { id: "1", title: "Parser", tasks: [
        { id: "1.1", description: "Parse pending tasks", status: "pending", sectionId: "1", checks: ["Run the focused parser test", "Observe the stable digest"] },
        { id: "1.2", description: "Preserve completed tasks", status: "complete", sectionId: "1", checks: [] },
      ] },
      { id: "2", title: "Boundary", tasks: [
        { id: "2.1", description: "Load the official artifact", status: "pending", sectionId: "2", checks: [] },
      ] },
    ],
  });
  expect(first.digest).toMatch(/^[a-f0-9]{64}$/u);
  expect(second.digest).toBe(first.digest);
  expect(JSON.stringify(first)).not.toContain("tasks.md");
});

test.each([
  ["unsupported heading resets section context", "## 1. Work\n- [ ] 1.1 First\n## Notes\n- [ ] 1.2 Hidden", /Unsupported OpenSpec task heading/u],
  ["task ID must belong to its section", "## 1. Work\n- [ ] 9.1 Wrong section", /does not belong to section/u],
  ["duplicate IDs", `## 1. A\n- [ ] 1.1 One\n## 2. B\n- [ ] 1.1 Two\n`, "Duplicate OpenSpec task ID: 1.1"],
  ["malformed checkbox", `## 1. A\n- [maybe] 1.1 One\n`, "Malformed OpenSpec task line"],
  ["outside section", `- [ ] 1.1 One\n## 1. A\n`, "outside a numbered section"],
  ["empty", `# Tasks\n\n## 1. Empty\n`, "no recognizable tasks"],
  ["unsupported heading", `## Parser\n- [ ] 1.1 One\n`, "Unsupported OpenSpec task heading"],
] as const)("rejects %s without guessing", async (_name, source, message) => {
  const { parseOpenSpecTaskInventory } = await import("../../src/openspec/task-inventory.js");
  expect(() => parseOpenSpecTaskInventory(source, { changeId: "c", projectRoot: "/p", tasksPath: "/p/tasks.md" })).toThrow(message);
});

test("checks participate in ordered ownership and digest identity", async () => {
  const { parseOpenSpecTaskInventory } = await import("../../src/openspec/task-inventory.js");
  const context = { changeId: "c", projectRoot: "/p", tasksPath: "/p/tasks.md" };
  const first = parseOpenSpecTaskInventory("## 1. A\n- [ ] 1.1 One\n  - Check: Alpha\n  - Check: Beta\n", context);
  const reordered = parseOpenSpecTaskInventory("## 1. A\n- [ ] 1.1 One\n  - Check: Beta\n  - Check: Alpha\n", context);
  expect(first.sections[0]!.tasks[0]!.checks).toEqual(["Alpha", "Beta"]);
  expect(reordered.digest).not.toBe(first.digest);
  expect(() => parseOpenSpecTaskInventory("  - Check: Orphan\n## 1. A\n- [ ] 1.1 One\n", context)).toThrow("outside a task");
});

test("enforces file, section, task, check, and UTF-8 bounds", async () => {
  const { parseOpenSpecTaskInventory } = await import("../../src/openspec/task-inventory.js");
  const context = { changeId: "c", projectRoot: "/p", tasksPath: "/p/tasks.md" };
  expect(() => parseOpenSpecTaskInventory("x".repeat(1_048_577), context)).toThrow("exceeds 1 MiB");
  expect(() => parseOpenSpecTaskInventory(`## 1. A\n- [ ] 1.1 ${"🙂".repeat(126)}\n`, context)).toThrow("description exceeds 500 bytes");
  expect(() => parseOpenSpecTaskInventory(`${Array.from({ length: 101 }, (_, index) => `## ${index + 1}. S\n- [ ] ${index + 1}.1 T`).join("\n")}\n`, context)).toThrow("at most 100 sections");
  expect(() => parseOpenSpecTaskInventory(`## 1. A\n${Array.from({ length: 1001 }, (_, index) => `- [ ] 1.${index + 1} T`).join("\n")}\n`, context)).toThrow("at most 1000 tasks");
  expect(() => parseOpenSpecTaskInventory(`## 1. A\n- [ ] 1.1 T\n  - Check: ${"🙂".repeat(126)}\n`, context)).toThrow("check exceeds 500 bytes");
  expect(() => parseOpenSpecTaskInventory(`## 1. A\n- [ ] 1.1 T\n${Array.from({ length: 21 }, (_, index) => `  - Check: C${index}`).join("\n")}\n`, context)).toThrow("at most 20 checks");
  expect(() => parseOpenSpecTaskInventory("## 1. A\n- [ ] 1.1 T\n- Check: not indented\n", context)).toThrow("Malformed OpenSpec task check");
  expect(() => parseOpenSpecTaskInventory("## 1. A\n- [ ] 1.1 T\n  - Check: ../private\n", context)).toThrow("unsafe content");
});
