import { expect, test } from "vitest";

type Result = { code: number; stdout: string; stderr: string };

function setup(results: Record<string, Result>, piIntegration: "current" | "missing" | "stale" = "current") {
  return import("../../src/openspec/boundary.js").then(({ createOpenSpecBoundary }) =>
    createOpenSpecBoundary({
      run: async (args) => results[args.join(" ")] ?? { code: 1, stdout: "", stderr: "unexpected command" },
      inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
      readText: async (path) => {
        if (piIntegration === "missing") throw Object.assign(new Error("missing"), { code: "ENOENT" });
        if (path.endsWith("SKILL.md")) {
          const generatedBy = piIntegration === "stale" ? "1.5.0" : results["--version"]?.stdout.trim() || "1.6.0";
          return `name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: "${generatedBy}"`;
        }
        return "Implement tasks from an OpenSpec change.";
      },
    })
  );
}

const healthy = {
  "--version": { code: 0, stdout: "1.6.0\n", stderr: "" },
  "doctor --json": {
    code: 0,
    stdout: JSON.stringify({ root: { path: "/project", healthy: true }, status: [] }),
    stderr: "",
  },
  "status --change horsepower-alpha1 --json": {
    code: 0,
    stdout: JSON.stringify({ changeName: "horsepower-alpha1", isComplete: true }),
    stderr: "",
  },
  "validate horsepower-alpha1 --strict --json": {
    code: 0,
    stdout: JSON.stringify({ summary: { totals: { failed: 0 } } }),
    stderr: "",
  },
};

test("allows advancing actions only in healthy official OpenSpec context", async () => {
  const boundary = await setup(healthy);

  await expect(boundary.authorize({
    action: "create",
    changeId: "horsepower-alpha1",
    cwd: "/project",
  })).resolves.toMatchObject({ allowed: true, version: "1.6.0", changeId: "horsepower-alpha1" });
});

test("blocks advancing work when official Pi integration is absent", async () => {
  const boundary = await setup(healthy, "missing");

  await expect(boundary.authorize({ action: "create", changeId: "horsepower-alpha1", cwd: "/project" }))
    .rejects.toThrow("OpenSpec Pi integration is missing; run: openspec init --tools pi");

  const stale = await setup(healthy, "stale");
  await expect(stale.authorize({ action: "create", changeId: "horsepower-alpha1", cwd: "/project/src" }))
    .rejects.toThrow("OpenSpec Pi integration is stale; run: openspec update");
});

test.each([
  ["missing", { code: 127, stdout: "", stderr: "not found" }, "Official OpenSpec CLI was not found"],
  ["command failure", { code: 1, stdout: "1.6.0\n", stderr: "failed" }, "Official OpenSpec CLI was not found"],
  ["empty", { code: 0, stdout: "", stderr: "" }, "OpenSpec >=1.6.0 is required; found unknown"],
  ["unparseable", { code: 0, stdout: "OpenSpec 1.6.0\n", stderr: "" }, "OpenSpec >=1.6.0 is required; found OpenSpec 1.6.0"],
  ["prerelease", { code: 0, stdout: "1.6.0-beta.1\n", stderr: "" }, "OpenSpec >=1.6.0 is required; found 1.6.0-beta.1"],
  ["lower bound", { code: 0, stdout: "1.5.9\n", stderr: "" }, "OpenSpec >=1.6.0 is required; found 1.5.9"],
  ["leading zero", { code: 0, stdout: "01.6.0\n", stderr: "" }, "OpenSpec >=1.6.0 is required; found 01.6.0"],
  ["malformed build", { code: 0, stdout: "1.6.0+\n", stderr: "" }, "OpenSpec >=1.6.0 is required; found 1.6.0+"],
  ["malformed prerelease", { code: 0, stdout: "1.6.0-alpha..1\n", stderr: "" }, "OpenSpec >=1.6.0 is required; found 1.6.0-alpha..1"],
] as const)("blocks advancing work for %s OpenSpec version state", async (_name, result, message) => {
  const boundary = await setup({ "--version": result });
  await expect(boundary.authorize({ action: "single", changeId: "x", cwd: "/project" }))
    .rejects.toThrow(message);
});

test.each(["1.6.0", "1.6.0+build.7", "1.99.999", "1.99.999+build.7", "2.0.0", "3.1.4"])(
  "accepts stable compatible OpenSpec version %s",
  async (version) => {
    const boundary = await setup({ ...healthy, "--version": { code: 0, stdout: `${version}\n`, stderr: "" } });
    await expect(boundary.authorize({ action: "create", changeId: "horsepower-alpha1", cwd: "/project" }))
      .resolves.toMatchObject({ version });
  },
);

test("rejects deceptive text that only contains official OpenSpec marker substrings", async () => {
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => healthy[args.join(" ") as keyof typeof healthy] ?? { code: 1, stdout: "", stderr: "" },
    readText: async (path) => path.endsWith("SKILL.md")
      ? 'notname: openspec-apply-change\nnotauthor: openspec\ncomment: Bash(openspec:*)\ngeneratedBy: "1.6.0"'
      : "This does not Implement tasks from an OpenSpec change safely",
  });
  await expect(boundary.authorize({ action: "create", changeId: "horsepower-alpha1", cwd: "/project" }))
    .rejects.toThrow("OpenSpec Pi integration is stale");
});

test("checks Pi integration from the OpenSpec root rather than invocation cwd", async () => {
  const paths: string[] = [];
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => healthy[args.join(" ") as keyof typeof healthy] ?? { code: 1, stdout: "", stderr: "" },
    readText: async (path) => {
      paths.push(path);
      return path.endsWith("SKILL.md")
        ? 'name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: "1.6.0"'
        : "Implement tasks from an OpenSpec change.";
    },
  });

  await boundary.authorize({ action: "create", changeId: "horsepower-alpha1", cwd: "/project/src" });
  expect(paths.every((path) => path.startsWith("/project/.pi/"))).toBe(true);
});

test("blocks incomplete change status", async () => {
  const boundary = await setup({
    ...healthy,
    "status --change horsepower-alpha1 --json": {
      code: 0,
      stdout: JSON.stringify({ changeName: "horsepower-alpha1", isComplete: false }),
      stderr: "",
    },
  });

  await expect(boundary.authorize({ action: "create", changeId: "horsepower-alpha1", cwd: "/project" }))
    .rejects.toThrow("OpenSpec change is not ready to apply: horsepower-alpha1");
});

test("blocks unhealthy OpenSpec project doctor results", async () => {
  const boundary = await setup({
    ...healthy,
    "doctor --json": { code: 0, stdout: JSON.stringify({ root: { healthy: false } }), stderr: "" },
  });

  await expect(boundary.authorize({ action: "send", changeId: "horsepower-alpha1", cwd: "/project" }))
    .rejects.toThrow("OpenSpec project is not healthy");
});

test("blocks invalid change context without modifying OpenSpec facts", async () => {
  const boundary = await setup({
    ...healthy,
    "validate horsepower-alpha1 --strict --json": {
      code: 1,
      stdout: JSON.stringify({ summary: { totals: { failed: 1 } } }),
      stderr: "invalid",
    },
  });

  await expect(boundary.authorize({ action: "chain", changeId: "horsepower-alpha1", cwd: "/project" }))
    .rejects.toThrow("OpenSpec change is not valid: horsepower-alpha1");
});

test("loads bounded tasks only from the resolved official status artifact after strict checks", async () => {
  const calls: string[] = [];
  const reads: string[] = [];
  const tasksPath = "/project/openspec/changes/horsepower-alpha1/tasks.md";
  const boundary = await import("../../src/openspec/boundary.js").then(({ createOpenSpecBoundary }) => createOpenSpecBoundary({
    run: async (args) => {
      calls.push(args.join(" "));
      if (args[0] === "status") return { ...healthy["status --change horsepower-alpha1 --json"], stdout: JSON.stringify({
        changeName: "horsepower-alpha1", isComplete: true,
        artifactPaths: { tasks: { resolvedOutputPath: tasksPath } },
      }) };
      return healthy[args.join(" ") as keyof typeof healthy] ?? { code: 1, stdout: "", stderr: "unexpected" };
    },
    inspectPath: async (path) => { expect(path).toBe(tasksPath); return { isFile: () => true, isSymbolicLink: () => false }; },
    readText: async (path) => {
      reads.push(path);
      if (path === tasksPath) return "## 1. Work\n- [ ] 1.1 Implement inventory\n- [x] 1.2 Plan inventory\n";
      return path.endsWith("SKILL.md")
        ? 'name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: "1.6.0"'
        : "Implement tasks from an OpenSpec change.";
    },
  }));

  await expect(boundary.loadTaskInventory({ cwd: "/project/src", changeId: "horsepower-alpha1" })).resolves.toMatchObject({
    changeId: "horsepower-alpha1", projectRoot: "/project", sections: [{ id: "1", tasks: [{ id: "1.1", status: "pending" }, { id: "1.2", status: "complete" }] }],
  });
  expect(calls).toEqual(["--version", "doctor --json", "status --change horsepower-alpha1 --json", "validate horsepower-alpha1 --strict --json"]);
  expect(reads.at(-1)).toBe(tasksPath);
});

test("snapshots only exact selected tasks and rejects selected-task identity drift", async () => {
  const tasksPath = "/project/openspec/changes/horsepower-alpha1/tasks.md";
  const status = {
    ...healthy,
    "status --change horsepower-alpha1 --json": {
      code: 0, stderr: "", stdout: JSON.stringify({
        changeName: "horsepower-alpha1", isComplete: true,
        artifactPaths: { tasks: { resolvedOutputPath: tasksPath } },
      }),
    },
  };
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => status[args.join(" ") as keyof typeof status] ?? { code: 1, stdout: "", stderr: "" },
    inspectPath: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
    readText: async (path) => path === tasksPath
      ? "## 1. Work\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n"
      : path.endsWith("SKILL.md")
        ? 'name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: "1.6.0"'
        : "Implement tasks from an OpenSpec change.",
  });

  await expect(boundary.snapshotAcceptance({
    cwd: "/project", changeId: "horsepower-alpha1", selectedTaskIds: ["1.2"],
    selectedTasks: [{ id: "1.2", description: "Second task", sectionId: "1" }],
  })).resolves.toMatchObject({ refs: ["task:1.2"], digest: expect.stringMatching(/^[a-f0-9]{64}$/) });
  await expect(boundary.snapshotAcceptance({
    cwd: "/project", changeId: "horsepower-alpha1", selectedTaskIds: ["1.2"],
    selectedTasks: [{ id: "1.2", description: "Changed task", sectionId: "1" }],
  })).rejects.toThrow("VERIFICATION_SCOPE_DRIFT");
  await expect(boundary.snapshotAcceptance({
    cwd: "/project", changeId: "horsepower-alpha1", selectedTaskIds: ["1.2"],
    selectedTasks: [{ id: "1.2", description: "Second task", sectionId: "1" }], requireComplete: true,
  })).rejects.toThrow("VERIFICATION_ACCEPTANCE_UNCHECKED");
});

test.each([
  ["missing path", undefined, { isFile: (): boolean => true, isSymbolicLink: (): boolean => false }, "no resolved tasks artifact"],
  ["glob path", "/project/openspec/changes/c/tasks/**/*.md", { isFile: (): boolean => true, isSymbolicLink: (): boolean => false }, "no resolved tasks artifact"],
  ["escape", "/outside/tasks.md", { isFile: (): boolean => true, isSymbolicLink: (): boolean => false }, "escapes project root"],
  ["symlink", "/project/tasks.md", { isFile: (): boolean => true, isSymbolicLink: (): boolean => true }, "regular non-symbolic-link"],
  ["directory", "/project/tasks.md", { isFile: (): boolean => false, isSymbolicLink: (): boolean => false }, "regular non-symbolic-link"],
] as const)("rejects unsafe task artifact %s", async (_name, resolvedOutputPath, info, message) => {
  const status = {
    ...healthy,
    "status --change horsepower-alpha1 --json": {
      code: 0, stderr: "", stdout: JSON.stringify({
        changeName: "horsepower-alpha1", isComplete: true,
        artifactPaths: { tasks: { ...(resolvedOutputPath === undefined ? {} : { resolvedOutputPath }) } },
      }),
    },
  };
  const { createOpenSpecBoundary } = await import("../../src/openspec/boundary.js");
  const boundary = createOpenSpecBoundary({
    run: async (args) => status[args.join(" ") as keyof typeof status] ?? { code: 1, stdout: "", stderr: "" },
    inspectPath: async () => info,
    readText: async (path) => path.endsWith("SKILL.md")
      ? 'name: openspec-apply-change\nallowed-tools: Bash(openspec:*)\nauthor: openspec\ngeneratedBy: "1.6.0"'
      : path.endsWith("opsx-apply.md") ? "Implement tasks from an OpenSpec change." : "## 1. A\n- [ ] 1.1 T\n",
  });
  await expect(boundary.loadTaskInventory({ cwd: "/project", changeId: "horsepower-alpha1" })).rejects.toThrow(message);
});

test("permits safe observation and cleanup actions without OpenSpec", async () => {
  const boundary = await setup({ "--version": { code: 127, stdout: "", stderr: "not found" } });

  for (const action of ["status", "list", "read", "abort", "destroy", "doctor"] as const) {
    await expect(boundary.authorize({ action, cwd: "/project" })).resolves.toEqual({
      allowed: true,
      action,
      openspecRequired: false,
    });
  }
});
