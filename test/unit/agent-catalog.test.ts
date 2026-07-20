import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "horsepower-agents-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeAgent(directory: string, name: string, body: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${name}.md`), body);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

test("discovers a model-neutral agent definition", async () => {
  const root = await temporaryDirectory();
  const bundledDir = join(root, "bundled");
  await writeAgent(bundledDir, "reviewer", `---
name: reviewer
role: Inspect changes for correctness
recommendedSlots: [judgment, craft]
tools: [read, bash]
standards: [correctness, security]
---
Review only the requested change and report evidence.
`);
  const module = await import("../../src/agents/catalog.js").catch(() => undefined);

  expect(await module?.discoverAgents({ bundledDir })).toEqual([{
    name: "reviewer",
    role: "Inspect changes for correctness",
    recommendedSlots: ["judgment", "craft"],
    tools: ["read", "bash"],
    standards: ["correctness", "security"],
    prompt: "Review only the requested change and report evidence.",
    source: join(bundledDir, "reviewer.md"),
    scope: "bundled",
  }]);
});

test("applies project-over-global-over-bundled precedence with deterministic names", async () => {
  const root = await temporaryDirectory();
  const bundledDir = join(root, "bundled");
  const globalDir = join(root, "global");
  const projectDir = join(root, "project");
  const definition = (name: string, role: string) => `---\nname: ${name}\nrole: ${role}\nrecommendedSlots: []\ntools: []\nstandards: []\n---\n${role}.\n`;
  await writeAgent(bundledDir, "worker", definition("worker", "bundled"));
  await writeAgent(bundledDir, "alpha", definition("alpha", "alpha"));
  await writeAgent(globalDir, "worker", definition("worker", "global"));
  await writeAgent(projectDir, "worker", definition("worker", "project"));
  const { discoverAgents } = await import("../../src/agents/catalog.js");

  const agents = await discoverAgents({ bundledDir, globalDir, projectDir });

  expect(agents.map(({ name, role, scope }) => ({ name, role, scope }))).toEqual([
    { name: "alpha", role: "alpha", scope: "bundled" },
    { name: "worker", role: "project", scope: "project" },
  ]);
});

test("removes every delegation tool and preserves an explicitly empty allowlist", async () => {
  const root = await temporaryDirectory();
  const bundledDir = join(root, "bundled");
  await writeAgent(bundledDir, "safe", `---
name: safe
role: Cannot delegate
recommendedSlots: []
tools: [horsepower, horsepower_subagent, subagent]
standards: []
---
Work directly.
`);
  const { discoverAgents } = await import("../../src/agents/catalog.js");

  expect((await discoverAgents({ bundledDir }))[0]?.tools).toEqual([]);
});

test("rejects concrete model and provider bindings with the definition source path", async () => {
  const root = await temporaryDirectory();
  const bundledDir = join(root, "bundled");
  const source = join(bundledDir, "private.md");
  await writeAgent(bundledDir, "private", `---
name: private
role: Invalid model-bound role
recommendedSlots: []
tools: []
standards: []
model: provider/private-model
---
Do work.
`);
  const { discoverAgents } = await import("../../src/agents/catalog.js");

  await expect(discoverAgents({ bundledDir })).rejects.toThrow(
    `Agent definition must not bind a concrete model: ${source}`,
  );

  await rm(source);
  const providerSource = join(bundledDir, "provider-bound.md");
  await writeAgent(bundledDir, "provider-bound", `---
name: provider-bound
role: Invalid provider-bound role
recommendedSlots: [judgment]
tools: [read]
standards: [correctness]
provider: private-provider
---
Do work.
`);
  await expect(discoverAgents({ bundledDir })).rejects.toThrow(
    `Agent definition must not bind a concrete provider: ${providerSource}`,
  );
});

test("requires list metadata and a non-empty prompt", async () => {
  const root = await temporaryDirectory();
  const bundledDir = join(root, "bundled");
  const missingSource = join(bundledDir, "missing.md");
  await writeAgent(bundledDir, "missing", `---
name: missing
role: Missing metadata
---
Do work.
`);
  const { discoverAgents } = await import("../../src/agents/catalog.js");

  await expect(discoverAgents({ bundledDir })).rejects.toThrow(
    `Agent definition field recommendedSlots must be an array of strings: ${missingSource}`,
  );

  await rm(missingSource);
  const emptySource = join(bundledDir, "empty.md");
  await writeAgent(bundledDir, "empty", `---
name: empty
role: Empty prompt
recommendedSlots: []
tools: []
standards: []
---
`);
  await expect(discoverAgents({ bundledDir })).rejects.toThrow(
    `Agent definition requires a non-empty prompt: ${emptySource}`,
  );
});

test("rejects malformed list metadata instead of silently changing its meaning", async () => {
  const root = await temporaryDirectory();
  const bundledDir = join(root, "bundled");
  const source = join(bundledDir, "broken.md");
  await writeAgent(bundledDir, "broken", `---
name: broken
role: Broken metadata
recommendedSlots: []
tools: bash
standards: []
---
Do work.
`);
  const { discoverAgents } = await import("../../src/agents/catalog.js");

  await expect(discoverAgents({ bundledDir })).rejects.toThrow(
    `Agent definition field tools must be an array of strings: ${source}`,
  );
});

test("ships a short model-neutral bundled catalog", async () => {
  const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const bundledDir = join(repositoryRoot, "resources", "agents");
  const { discoverAgents } = await import("../../src/agents/catalog.js");

  const agents = await discoverAgents({ bundledDir });
  const contents = await Promise.all(agents.map((agent) =>
    import("node:fs/promises").then(({ readFile }) => readFile(agent.source, "utf8"))
  ));

  expect(agents.map((agent) => agent.name)).toEqual([
    "architect",
    "coder",
    "researcher",
    "reviewer",
    "tester",
  ]);
  expect(contents.join("\n")).not.toMatch(
    /\b(?:model|provider|api[_-]?key|token|secret)\s*:|(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\)/imu,
  );
  expect(agents.every((agent) => agent.prompt.length <= 400)).toBe(true);
});
