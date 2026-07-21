import { expect, test } from "vitest";

type Result = { code: number; stdout: string; stderr: string };

function setup(results: Record<string, Result>, piIntegration: "current" | "missing" | "stale" = "current") {
  return import("../../src/openspec/boundary.js").then(({ createOpenSpecBoundary }) =>
    createOpenSpecBoundary({
      run: async (args) => results[args.join(" ")] ?? { code: 1, stdout: "", stderr: "unexpected command" },
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
  ["empty", { code: 0, stdout: "", stderr: "" }, "OpenSpec >=1.6.0 <2.0.0 is required; found unknown"],
  ["unparseable", { code: 0, stdout: "OpenSpec 1.6.0\n", stderr: "" }, "OpenSpec >=1.6.0 <2.0.0 is required; found OpenSpec 1.6.0"],
  ["prerelease", { code: 0, stdout: "1.6.0-beta.1\n", stderr: "" }, "OpenSpec >=1.6.0 <2.0.0 is required; found 1.6.0-beta.1"],
  ["lower bound", { code: 0, stdout: "1.5.9\n", stderr: "" }, "OpenSpec >=1.6.0 <2.0.0 is required; found 1.5.9"],
  ["upper bound", { code: 0, stdout: "2.0.0\n", stderr: "" }, "OpenSpec >=1.6.0 <2.0.0 is required; found 2.0.0"],
  ["leading zero", { code: 0, stdout: "01.6.0\n", stderr: "" }, "OpenSpec >=1.6.0 <2.0.0 is required; found 01.6.0"],
  ["malformed build", { code: 0, stdout: "1.6.0+\n", stderr: "" }, "OpenSpec >=1.6.0 <2.0.0 is required; found 1.6.0+"],
  ["malformed prerelease", { code: 0, stdout: "1.6.0-alpha..1\n", stderr: "" }, "OpenSpec >=1.6.0 <2.0.0 is required; found 1.6.0-alpha..1"],
] as const)("blocks advancing work for %s OpenSpec version state", async (_name, result, message) => {
  const boundary = await setup({ "--version": result });
  await expect(boundary.authorize({ action: "single", changeId: "x", cwd: "/project" }))
    .rejects.toThrow(message);
});

test.each(["1.6.0", "1.6.0+build.7", "1.99.999", "1.99.999+build.7"])(
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
