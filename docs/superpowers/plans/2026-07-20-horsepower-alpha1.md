# Horsepower 0.1.0-alpha.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a model-neutral Horsepower alpha with GitHub Release packaging, curl bootstrap installation, configurable capability slots, explicit one-shot and persistent RPC subagents, and process-lifetime worker persistence.

**Architecture:** A private TypeScript project builds two artifacts: a bundled Node CLI and a Pi extension bundle. Configuration and slot resolution are pure modules; the extension composes agent discovery, one-shot execution, and a process-global persistent RPC manager. A repository-owned shell bootstrap installs a verified GitHub Release and exposes it through stable symlinks without invoking Pi's package manager.

**Tech Stack:** Node.js `>=22.19.0`, TypeScript 5.9, Vitest 4, esbuild, TypeBox, Pi `0.80.10` extension/RPC APIs, POSIX shell, GitHub Releases and GitHub Actions.

## Global Constraints

- The Node project is non-publishable (`"private": true`) and is distributed only through `LosFurina/horsepower` GitHub Releases.
- Do not invoke `pi install`, `pi update`, npm publishing, or Pi Package Gallery APIs.
- Support Linux and macOS; fail explicitly on Windows.
- Install only globally; project directories contain configuration overrides, never another program payload.
- Do not copy Horsepower resources into Pi resource directories; create stable symlinks only.
- `judgment`, `craft`, and `utility` slots are required; `speed -> utility` and `context -> judgment` are built-in fallbacks.
- Every create, single task, parallel task, and chain step must explicitly provide `modelSlot`.
- Maximum persistent workers: 8. Maximum one-shot parallel tasks: 8. Maximum one-shot concurrency: 4.
- Persistent event storage is bounded to 10 MiB per worker; one-shot displayed output is bounded to 50 KiB per task.
- Worker subprocesses always use `pi --mode rpc --no-session` and exclude `horsepower`, `horsepower_subagent`, `subagent`, and configured delegation tools.
- Workers never create workers. No workflow or helper implicitly dispatches a worker.
- Persistent workers have no idle expiration. They survive Pi `new`, `resume`, and `fork`, but are destroyed on `reload`, `quit`, and host process exit.
- `abort` stops the active turn and preserves the worker; `destroy` terminates and removes the worker.
- Public defaults contain no provider IDs, concrete model IDs, API keys, private personas, machine paths, or private agent mappings.
- Spawn child processes with `shell: false`; write prompts to mode-`0600` temporary files and clean them up.
- Use test-driven development and commit after every task.

## Planned File Map

```text
horsepower/
  src/
    config/paths.ts                  # global/project path resolution
    config/json-store.ts             # atomic JSON reads/writes
    slots/schema.ts                  # slot types and validation
    slots/resolve.ts                 # precedence, fallback and revision
    agents/types.ts                  # model-neutral agent contract
    agents/discover.ts               # bundled/global/project discovery
    runtime/types.ts                 # worker/message/event public types
    runtime/pi-command.ts            # safe Pi argv construction
    runtime/rpc-transport.ts          # LF JSONL request/event transport
    runtime/event-buffer.ts           # byte-bounded cursor stream
    runtime/persistent-manager.ts     # persistent worker lifecycle
    runtime/one-shot.ts               # single/parallel/chain execution
    runtime/global-runtime.ts         # process-global singleton and cleanup
    orchestration/service.ts          # explicit dispatch façade
    extension/schema.ts               # TypeBox tool input schema
    extension/index.ts                # Pi registration/lifecycle adapter
    cli/args.ts                       # deterministic CLI parsing
    cli/commands/slots.ts             # setup/configure/set/slots
    cli/commands/doctor.ts            # install/config diagnostics
    cli/main.ts                       # CLI entry point
  resources/agents/*.md               # model-neutral bundled agents
  resources/skills/horsepower/SKILL.md
  scripts/build-release.mjs           # deterministic release tree/archive
  scripts/scan-release.mjs            # private-data release gate
  pi/extensions/horsepower/           # generated release staging target
  pi/skills/horsepower/               # generated release staging target
  test/unit/
  test/integration/
  test/e2e/
  test/fixtures/
  bin/horsepower
  install.sh
  release-manifest.json
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  README.zh-CN.md
  CHANGELOG.md
  LICENSE
  .github/workflows/ci.yml
  .github/workflows/release.yml
```

---

### Task 1: Private TypeScript Project and Deterministic Builds

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `scripts/build.mjs`
- Create: `src/cli/main.ts`
- Create: `src/extension/index.ts`
- Create: `test/unit/build-layout.test.ts`
- Create: `.gitignore`
- Create: `LICENSE`

**Interfaces:**
- Produces: `npm run build`, generating `dist/cli/horsepower.js` and `dist/extension/index.js`.
- Produces: `npm test`, `npm run typecheck`, and `npm run check` as repository-wide verification commands.

- [ ] **Step 1: Write the build-layout test**

```ts
// test/unit/build-layout.test.ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));

describe("project metadata", () => {
  it("cannot be published to npm", () => {
    expect(packageJson.private).toBe(true);
    expect(packageJson.engines.node).toBe(">=22.19.0");
    expect(packageJson.publishConfig).toBeUndefined();
  });

  it("defines complete verification scripts", () => {
    expect(packageJson.scripts.check).toBe("npm run typecheck && npm test && npm run build");
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing project fails**

Run: `npm test -- test/unit/build-layout.test.ts`

Expected: FAIL because `package.json` or the `test` script does not exist.

- [ ] **Step 3: Add private project metadata and compiler configuration**

Use this package contract:

```json
{
  "name": "horsepower",
  "version": "0.1.0-alpha.1",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.19.0" },
  "bin": { "horsepower": "dist/cli/horsepower.js" },
  "scripts": {
    "build": "node scripts/build.mjs",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "npm run typecheck && npm test && npm run build"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.80.10",
    "@earendil-works/pi-ai": "0.80.10",
    "@earendil-works/pi-coding-agent": "0.80.10",
    "typebox": "1.1.38"
  },
  "devDependencies": {
    "@types/node": "24.12.4",
    "esbuild": "0.25.12",
    "typescript": "5.9.3",
    "vitest": "4.1.9"
  }
}
```

Configure strict ESM TypeScript with `module` and `moduleResolution` set to `NodeNext`, `target` set to `ES2023`, `rootDir` set to `.`, and types `node` plus `vitest/globals`. Configure Vitest to include `test/**/*.test.ts`, use the Node environment, clear mocks, and restore mocks.

Implement `scripts/build.mjs` with two esbuild calls:

```js
import { chmod, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/cli", { recursive: true });
await mkdir("dist/extension", { recursive: true });

await build({
  entryPoints: ["src/cli/main.ts"],
  outfile: "dist/cli/horsepower.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "#!/usr/bin/env node" },
});

await build({
  entryPoints: ["src/extension/index.ts"],
  outfile: "dist/extension/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-tui"],
});

await chmod("dist/cli/horsepower.js", 0o755);
```

Use temporary entry points that print `horsepower 0.1.0-alpha.1` for the CLI and export a no-op default extension function. Add MIT license text and ignore `node_modules/`, `dist/`, `release/`, and `*.tgz`.

- [ ] **Step 4: Install dependencies and run all project checks**

Run: `npm install && npm run check`

Expected: typecheck passes, one test passes, and both build artifacts exist.

- [ ] **Step 5: Commit the project foundation**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts scripts/build.mjs src test .gitignore LICENSE
git commit -m "build: initialize private TypeScript project"
```

---

### Task 2: Paths and Transactional JSON Storage

**Files:**
- Create: `src/config/paths.ts`
- Create: `src/config/json-store.ts`
- Create: `test/unit/json-store.test.ts`
- Create: `test/unit/paths.test.ts`

**Interfaces:**
- Produces: `resolveHorsepowerPaths(options: { cwd: string; homeDir?: string; agentDir?: string }): HorsepowerPaths`.
- Produces: `readJson<T>(path: string): Promise<T | undefined>`.
- Produces: `writeJsonAtomic(path: string, value: unknown): Promise<void>`.
- Produces: `findProjectConfig(cwd: string): string | undefined`.

- [ ] **Step 1: Write failing path and atomic-write tests**

```ts
// test/unit/paths.test.ts
expect(resolveHorsepowerPaths({ cwd: "/repo/app", homeDir: "/home/test" })).toMatchObject({
  globalRoot: "/home/test/.pi/agent/horsepower",
  globalSlots: "/home/test/.pi/agent/horsepower/model-slots.json",
  projectRoot: "/repo/app/.pi/horsepower",
  projectSlots: "/repo/app/.pi/horsepower/model-slots.json",
});
```

```ts
// test/unit/json-store.test.ts
it("writes valid JSON atomically and preserves unknown fields", async () => {
  const file = join(tempDir, "nested", "settings.json");
  await writeJsonAtomic(file, { schemaVersion: 1, unknown: { keep: true } });
  expect(await readJson(file)).toEqual({ schemaVersion: 1, unknown: { keep: true } });
  expect((await readdir(dirname(file))).filter((name) => name.includes(".tmp-"))).toEqual([]);
});
```

Also test malformed JSON reports `Invalid JSON in <path>` without echoing file contents.

- [ ] **Step 2: Run focused tests and verify missing exports fail**

Run: `npm test -- test/unit/paths.test.ts test/unit/json-store.test.ts`

Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement path resolution and atomic writes**

Define:

```ts
export interface HorsepowerPaths {
  globalRoot: string;
  globalSlots: string;
  globalSettings: string;
  projectRoot: string;
  projectSlots: string;
  projectSettings: string;
}
```

`writeJsonAtomic` must create the parent directory, write `${JSON.stringify(value, null, 2)}\n` to a mode-`0600` sibling temporary file, `fsync` the file, rename it over the destination, and remove the temporary file in `finally`. `findProjectConfig` walks from `cwd` toward the filesystem root and returns the first existing `.pi/horsepower` directory; it must not follow a project override outside the normal ancestor chain.

- [ ] **Step 4: Run focused tests and repository checks**

Run: `npm test -- test/unit/paths.test.ts test/unit/json-store.test.ts && npm run typecheck`

Expected: all focused tests and typecheck pass.

- [ ] **Step 5: Commit configuration primitives**

```bash
git add src/config test/unit/paths.test.ts test/unit/json-store.test.ts
git commit -m "feat: add transactional configuration storage"
```

---

### Task 3: Capability Slot Schema, Precedence, Fallbacks, and Revision

**Files:**
- Create: `src/slots/schema.ts`
- Create: `src/slots/resolve.ts`
- Create: `test/unit/slots.test.ts`
- Create: `test/fixtures/slots/global.json`
- Create: `test/fixtures/slots/project.json`

**Interfaces:**
- Produces: `SlotConfig`, `SlotBinding`, `ThinkingLevel`, and `ResolvedSlot` types.
- Produces: `parseSlotConfig(value: unknown, source: string): SlotConfig`.
- Produces: `mergeSlotConfigs(global: SlotConfig, project?: SlotConfig): SlotConfig`.
- Produces: `resolveSlot(config: SlotConfig, requestedSlot: string): ResolvedSlot`.
- Produces: `slotRevision(config: SlotConfig): string` as lowercase SHA-256 hex.

- [ ] **Step 1: Write failing resolution tests**

Cover these exact cases:

```ts
expect(resolveSlot(config, "speed")).toMatchObject({
  requestedSlot: "speed",
  resolvedSlot: "utility",
  model: "provider/utility",
  thinking: "off",
  fallbackPath: ["speed", "utility"],
});
expect(() => resolveSlot(config, "missing")).toThrow(/Unknown capability slot/);
expect(() => resolveSlot(cyclicConfig, "speed")).toThrow(/Fallback cycle: speed -> context -> speed/);
expect(() => parseSlotConfig({ schemaVersion: 1, slots: { BAD_ID: {} } }, "fixture")).toThrow(/BAD_ID/);
```

Test project bindings override global bindings while unmentioned global slots remain. Test normalized key ordering yields the same revision hash.

- [ ] **Step 2: Run slot tests and verify failure**

Run: `npm test -- test/unit/slots.test.ts`

Expected: FAIL because slot modules do not exist.

- [ ] **Step 3: Implement strict slot validation and deterministic resolution**

Use this public shape:

```ts
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface SlotBinding { model: string; thinking: ThinkingLevel }
export interface SlotConfig {
  schemaVersion: 1;
  slots: Record<string, SlotBinding>;
  fallbacks: Record<string, string>;
}
export interface ResolvedSlot {
  requestedSlot: string;
  resolvedSlot: string;
  model: string;
  thinking: ThinkingLevel;
  fallbackPath: string[];
  revision: string;
}
```

Reject unknown top-level fields only when they conflict with schema semantics; preserve unknown fields in CLI writes by patching parsed JSON rather than reconstructing unrelated settings. Validate slot IDs against `[a-z][a-z0-9-]{0,31}`, model as a non-empty `provider/model` string, and required slots after global/project merge. Inject built-in fallbacks only when the user did not define those fallback keys.

- [ ] **Step 4: Run slots tests and typecheck**

Run: `npm test -- test/unit/slots.test.ts && npm run typecheck`

Expected: slot tests pass, including cycle and stable hash cases.

- [ ] **Step 5: Commit slot resolution**

```bash
git add src/slots test/unit/slots.test.ts test/fixtures/slots
git commit -m "feat: resolve model capability slots"
```

---

### Task 4: Model-Neutral Agent Discovery

**Files:**
- Create: `src/agents/types.ts`
- Create: `src/agents/discover.ts`
- Create: `resources/agents/reviewer.md`
- Create: `resources/agents/coder.md`
- Create: `resources/agents/tester.md`
- Create: `resources/agents/recorder.md`
- Create: `test/unit/agents.test.ts`

**Interfaces:**
- Produces: `AgentDefinition` with `name`, `description`, `tools`, `recommendedSlots`, `standards`, `systemPrompt`, `source`, and `filePath`.
- Produces: `discoverAgents(options: DiscoverAgentOptions): Promise<AgentDefinition[]>`.
- Consumes: bundled root, global Horsepower root, project Horsepower root.

- [ ] **Step 1: Write failing precedence and neutrality tests**

Create temporary bundled/global/project directories. Assert project `reviewer.md` overrides global and bundled definitions, global overrides bundled, malformed definitions are reported with their file path, and a frontmatter `model:` key is rejected:

```ts
await expect(discoverAgents(optionsWithConcreteModel)).rejects.toThrow(/Agent definitions must not bind concrete models/);
expect(agents.find((agent) => agent.name === "reviewer")?.source).toBe("project");
```

- [ ] **Step 2: Run agent tests and verify failure**

Run: `npm test -- test/unit/agents.test.ts`

Expected: FAIL because discovery modules do not exist.

- [ ] **Step 3: Implement discovery and bundled definitions**

Parse Markdown frontmatter with Pi's `parseFrontmatter`. Require `name`, `description`, comma-separated `tools`, and optional comma-separated `recommended_slots` and `standards`. Reject `model`. Read only `.md` files that are regular files or symlinks; sort directory entries and final agent names for deterministic output.

Bundled agents must stay short and functional. Example:

```md
---
name: reviewer
description: Reviews code for defects, regressions, and missing evidence
tools: read,grep,find,bash
recommended_slots: craft,judgment
standards: review,workflow
---

Review actual code and command evidence. Do not modify files. Report findings by severity with exact paths.
```

Do not migrate any private agent file or concrete model mapping from `~/.pi/agent/agents`.

- [ ] **Step 4: Run focused tests and scan bundled resources**

Run:

```bash
npm test -- test/unit/agents.test.ts
rg -n 'private-provider|private-model|gpt-|api[_-]?key|/Users/' resources && exit 1 || true
npm run typecheck
```

Expected: tests pass, scan prints no matches, typecheck passes.

- [ ] **Step 5: Commit model-neutral agents**

```bash
git add src/agents resources/agents test/unit/agents.test.ts
git commit -m "feat: discover model-neutral agent definitions"
```

---

### Task 5: Pi Command Builder and LF JSONL RPC Transport

**Files:**
- Create: `src/runtime/types.ts`
- Create: `src/runtime/pi-command.ts`
- Create: `src/runtime/rpc-transport.ts`
- Create: `test/unit/pi-command.test.ts`
- Create: `test/unit/rpc-transport.test.ts`
- Create: `test/fixtures/fake-rpc-process.ts`

**Interfaces:**
- Produces: `buildWorkerInvocation(input: WorkerLaunchInput): { command: string; args: string[] }`.
- Produces: `RpcTransport` with `request(command, timeoutMs?)`, `events`, and `close()`.
- Produces: injectable `SpawnProcess` type using `shell: false`.
- Consumes: resolved slot and `AgentDefinition`.

- [ ] **Step 1: Write failing argv and transport tests**

Assert exact safety behavior:

```ts
const invocation = buildWorkerInvocation({
  piCommand: "pi",
  model: "provider/model",
  thinking: "high",
  tools: ["read", "horsepower", "subagent", "bash"],
  promptPath: "/tmp/prompt.md",
});
expect(invocation.args).toContain("--mode");
expect(invocation.args).toContain("rpc");
expect(invocation.args).toContain("--no-session");
expect(invocation.args).toContain("read,bash");
expect(invocation.args.join(" ")).toContain("horsepower,horsepower_subagent,subagent");
```

For transport, split one UTF-8 JSON record across chunks, send CRLF and LF records, correlate two out-of-order response IDs, reject malformed response JSON as an event rather than crashing, and reject pending requests when the process closes.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- test/unit/pi-command.test.ts test/unit/rpc-transport.test.ts`

Expected: FAIL because runtime modules do not exist.

- [ ] **Step 3: Implement safe argv and request transport**

Define launch input:

```ts
export interface WorkerLaunchInput {
  piCommand: string;
  model: string;
  thinking: ThinkingLevel;
  tools?: string[];
  promptPath?: string;
  name?: string;
  excludedTools?: string[];
}
```

Always add exclusions `horsepower`, `horsepower_subagent`, and `subagent`, de-duplicate and sort exclusions, strip all excluded tools from allowlists, and use `--no-tools` when an explicit tool list becomes empty. `RpcTransport.request` writes exactly one `JSON.stringify({...command, id}) + "\n"` record. Parse output with `StringDecoder("utf8")`; expose non-response records through an `EventEmitter`; bound stderr to the final 50 KiB.

- [ ] **Step 4: Run transport tests and typecheck**

Run: `npm test -- test/unit/pi-command.test.ts test/unit/rpc-transport.test.ts && npm run typecheck`

Expected: all transport and argv tests pass.

- [ ] **Step 5: Commit RPC transport**

```bash
git add src/runtime test/unit/pi-command.test.ts test/unit/rpc-transport.test.ts test/fixtures/fake-rpc-process.ts
git commit -m "feat: add safe Pi RPC transport"
```

---

### Task 6: Cursor Event Buffer and Persistent Worker Manager

**Files:**
- Create: `src/runtime/event-buffer.ts`
- Create: `src/runtime/persistent-manager.ts`
- Create: `test/unit/event-buffer.test.ts`
- Create: `test/integration/persistent-manager.test.ts`

**Interfaces:**
- Produces: `PersistentWorkerManager.create/send/abort/status/read/list/destroy/destroyAll`.
- Produces: `PersistentStatus`, `MessageStatus`, `DeliveryMode`, `PersistentEvent`, `WorkerSummary`.
- Consumes: `RpcTransport`, `buildWorkerInvocation`, `AgentDefinition`, and `ResolvedSlot`.

- [ ] **Step 1: Write failing event-buffer tests**

Test monotonically increasing cursors, compact versus detailed reads, pagination, and byte truncation:

```ts
const result = buffer.read({ afterCursor: 0, includeDetails: false, limit: 2 });
expect(result.events.map((event) => event.cursor)).toEqual([1, 3]);
expect(result.hasMore).toBe(true);
expect(buffer.read({ afterCursor: 0 }).truncated).toBe(true);
```

- [ ] **Step 2: Implement the bounded event buffer and verify it**

`EventBuffer.append(event, detailed)` computes UTF-8 bytes from serialized event data, evicts oldest records until total bytes are at or below the configured limit, and returns the assigned cursor. `read` returns `events`, `oldestCursor`, `nextCursor`, `hasMore`, and `truncated`.

Run: `npm test -- test/unit/event-buffer.test.ts`

Expected: event-buffer tests pass.

- [ ] **Step 3: Write failing persistent-manager lifecycle tests**

Port the existing self-authored persistent runtime cases into Vitest without private model values. Use `provider/test-model` and cover:

- create/list and unique names;
- eight-worker hard limit with no eviction;
- async and waited sends with unique message IDs;
- `reject`, `followUp`, and `steer` correlation;
- `abort` sends RPC abort, waits for the worker's aborted message/settled event, marks the active message `canceled`, and leaves the worker `idle`; transport acknowledgement alone must not mark semantic cancellation complete;
- cursor reads and 10 MiB default;
- provider retry does not complete early;
- assistant error fails one message but keeps the worker usable;
- startup failure removes and kills the child;
- crash marks worker failed and rejects waiters;
- destroy rejects active and queued waiters;
- graceful destroy escalates to `SIGKILL`;
- wait timeout does not abort;
- no idle timer exists.

- [ ] **Step 4: Implement the manager with mode-0600 prompt cleanup**

Use this creation contract:

```ts
export interface CreateWorkerInput {
  agent: AgentDefinition;
  slot: ResolvedSlot;
  cwd: string;
  name?: string;
  initialMessage?: string;
}
```

Creation writes the combined role prompt to a private temporary file, spawns the child, requests `get_state`, then transitions `starting -> idle`. If `initialMessage` is present, creation immediately calls the same non-waiting `send(..., delivery: "reject")` path and returns `initialMessageId`; it does not invent a second message lifecycle. `send` assigns `msg-<random>`, records `accepted`, and correlates completion through user-message activation plus assistant/agent-end events. `abort` sends the RPC command but resolves only after an aborted assistant message or settled event proves the turn stopped; it must not call `destroy`. `destroy` removes temporary files after process termination and removes the worker from `list`.

- [ ] **Step 5: Run all manager tests**

Run: `npm test -- test/unit/event-buffer.test.ts test/integration/persistent-manager.test.ts && npm run typecheck`

Expected: all manager lifecycle cases pass with no leaked temporary directories in the fixture root.

- [ ] **Step 6: Commit persistent workers**

```bash
git add src/runtime/event-buffer.ts src/runtime/persistent-manager.ts test/unit/event-buffer.test.ts test/integration/persistent-manager.test.ts
git commit -m "feat: manage persistent RPC workers"
```

---

### Task 7: Explicit One-Shot Single, Parallel, and Chain Execution

**Files:**
- Create: `src/runtime/one-shot.ts`
- Create: `test/integration/one-shot.test.ts`

**Interfaces:**
- Produces: `runSingle(input, deps): Promise<OneShotResult>`.
- Produces: `runParallel(tasks, deps): Promise<OneShotResult[]>`.
- Produces: `runChain(steps, deps): Promise<OneShotResult[]>`.
- Each `OneShotTask` requires `agent`, `modelSlot`, `task`, and optional `cwd`.

- [ ] **Step 1: Write failing explicit-dispatch tests**

Assert missing `modelSlot` is rejected before spawn, parallel accepts at most eight tasks and starts at most four children concurrently, chain replaces all `{previous}` markers with the preceding successful output, failed chain steps stop subsequent execution, delegation tools are excluded, and displayed output is truncated at 50 KiB while full output remains in structured details.

- [ ] **Step 2: Run one-shot tests and verify failure**

Run: `npm test -- test/integration/one-shot.test.ts`

Expected: FAIL because `one-shot.ts` does not exist.

- [ ] **Step 3: Implement one-shot execution using JSON mode**

Spawn:

```text
pi --mode json -p --no-session --model <resolved-model> --thinking <level> --exclude-tools horsepower,horsepower_subagent,subagent ...
```

Use the same safe prompt-file and tool filtering helpers as persistent workers. Parse `message_end` and `tool_result_end`, aggregate usage, preserve stderr with a 50 KiB bound, and terminate on `AbortSignal` with `SIGTERM` then bounded `SIGKILL`. Implement concurrency with a shared next-index loop, not `Promise.all` over all children.

- [ ] **Step 4: Run one-shot tests and typecheck**

Run: `npm test -- test/integration/one-shot.test.ts && npm run typecheck`

Expected: all single/parallel/chain tests pass.

- [ ] **Step 5: Commit one-shot execution**

```bash
git add src/runtime/one-shot.ts test/integration/one-shot.test.ts
git commit -m "feat: add explicit one-shot dispatch modes"
```

---

### Task 8: Orchestration Service and Public Tool Contract

**Files:**
- Create: `src/orchestration/service.ts`
- Create: `src/extension/schema.ts`
- Create: `test/unit/orchestration-service.test.ts`
- Create: `test/unit/tool-schema.test.ts`

**Interfaces:**
- Produces: `HorsepowerSubagentService.execute(input, context)`.
- Produces: `HorsepowerSubagentInputSchema` for `single`, `parallel`, `chain`, `create`, `send`, `abort`, `status`, `read`, `list`, and `destroy`.
- Consumes: slot resolver, agent discovery, one-shot runner, persistent manager, and injected `validateModel(model, thinking)` capability.

- [ ] **Step 1: Write failing service policy tests**

Verify every creation path resolves an explicitly supplied slot, calls the injected model/thinking validator before spawn, unknown agents fail before spawn, `list` needs no agent or slot, `create` may send `initialMessage`, and no service branch calls `create` except action `create`. Assert unknown models and unsupported thinking levels return configuration errors. Assert `single`, every parallel task, and every chain step reject missing `modelSlot` with a path-specific message such as `tasks[1].modelSlot is required`.

- [ ] **Step 2: Run service/schema tests and verify failure**

Run: `npm test -- test/unit/orchestration-service.test.ts test/unit/tool-schema.test.ts`

Expected: FAIL because service and schema modules do not exist.

- [ ] **Step 3: Implement discriminated input schema and façade**

Use TypeBox `Type.Union` with one object per action/mode; set `additionalProperties: false`. Persistent actions use `sessionId`; `send` requires `message` and supports `wait`, `timeoutMs`, and `delivery`; `read` supports `afterCursor`, `includeDetails`, and `limit`; `destroy` supports `force`.

The service receives dependencies through its constructor so tests can prove policy without spawning Pi. The extension adapter implements `validateModel` with `ctx.modelRegistry.find(provider, model)` after splitting the configured `provider/model` at the first slash, and checks the model's exposed thinking levels before dispatch. Its only manager creation call is:

```ts
return this.manager.create({ agent, slot: resolvedSlot, cwd, name, initialMessage });
```

- [ ] **Step 4: Run service tests and full typecheck**

Run: `npm test -- test/unit/orchestration-service.test.ts test/unit/tool-schema.test.ts && npm run typecheck`

Expected: policy and schema tests pass.

- [ ] **Step 5: Commit the public subagent contract**

```bash
git add src/orchestration src/extension/schema.ts test/unit/orchestration-service.test.ts test/unit/tool-schema.test.ts
git commit -m "feat: define explicit Horsepower dispatch contract"
```

---

### Task 9: Process-Global Runtime and Pi Extension Lifecycle

**Files:**
- Create: `src/runtime/global-runtime.ts`
- Replace: `src/extension/index.ts`
- Create: `test/unit/global-runtime.test.ts`
- Create: `test/integration/extension.test.ts`

**Interfaces:**
- Produces: `acquireGlobalRuntime(factory): GlobalRuntimeLease` keyed by `Symbol.for("horsepower.runtime")`.
- Produces: `releaseForSession(reason)` semantics for `new`, `resume`, `fork`, `reload`, and `quit`.
- Registers only `horsepower_subagent`, `/horsepower-status`, and `/horsepower-config` in alpha. The workflow-oriented `horsepower` tool arrives in the AgentFlow plan.

- [ ] **Step 1: Write failing singleton lifecycle tests**

Use a fake manager and two extension instances. Assert `new`, `resume`, and `fork` reuse the exact manager object; `reload` and `quit` call `destroyAll` once and delete the global symbol; repeated signal-handler installation is idempotent; and an extension reload cannot destroy a newly acquired replacement manager.

- [ ] **Step 2: Run lifecycle tests and verify failure**

Run: `npm test -- test/unit/global-runtime.test.ts`

Expected: FAIL because `global-runtime.ts` does not exist.

- [ ] **Step 3: Implement generation-safe global ownership**

Store:

```ts
interface GlobalRuntimeRecord {
  generation: string;
  manager: PersistentWorkerManager;
  leases: number;
  cleanupInstalled: boolean;
}
```

The lease captures `generation`; cleanup deletes the process-global value only when the generation still matches. Process `exit`, `SIGINT`, and `SIGTERM` handlers are installed once and call forced cleanup without recursive signal registration.

- [ ] **Step 4: Write and implement extension registration tests**

Mock `ExtensionAPI` and tool execution context. Verify exactly one `horsepower_subagent` tool is registered, generic `subagent`, `/team`, and `team_*` are absent, commands use Horsepower names, model validation reads `ctx.modelRegistry` without reading or printing API keys, and tool execution delegates to `HorsepowerSubagentService`. Bind Pi `session_shutdown.reason` to the global lease rules and re-acquire during `session_start`.

- [ ] **Step 5: Run lifecycle and extension tests**

Run: `npm test -- test/unit/global-runtime.test.ts test/integration/extension.test.ts && npm run typecheck`

Expected: all lifecycle and registration tests pass.

- [ ] **Step 6: Commit the Pi extension**

```bash
git add src/runtime/global-runtime.ts src/extension test/unit/global-runtime.test.ts test/integration/extension.test.ts
git commit -m "feat: register process-persistent Pi workers"
```

---

### Task 10: CLI Setup, Slot Commands, and Doctor

**Files:**
- Create: `src/cli/args.ts`
- Create: `src/cli/commands/slots.ts`
- Create: `src/cli/commands/doctor.ts`
- Replace: `src/cli/main.ts`
- Create: `test/unit/cli-args.test.ts`
- Create: `test/integration/cli-slots.test.ts`
- Create: `test/integration/doctor.test.ts`
- Create: `bin/horsepower`

**Interfaces:**
- Produces CLI commands: `setup`, `configure`, `slots`, `set`, `unset`, `doctor`, and `uninstall`.
- Produces deterministic `--json`, `--global-root`, `--agent-dir`, `--cwd`, `--release-root`, and `--pre-activation` flags for tests and CI.
- `doctor` returns exit `0` for healthy, `1` for errors, and prints no secret values.

- [ ] **Step 1: Write failing argument-parser tests**

Test exact parse results for:

```text
horsepower set judgment provider/model --thinking high
horsepower unset speed
horsepower slots --json
horsepower doctor --json --global-root /tmp/hp --agent-dir /tmp/pi
horsepower doctor --json --release-root /tmp/staged/horsepower --pre-activation
horsepower uninstall --purge --yes
```

Reject unknown options and missing values with exit-code-2 usage errors.

- [ ] **Step 2: Implement parser and verify focused tests**

Build a dependency-free parser that returns a discriminated `CliCommand`; do not execute commands while parsing.

Run: `npm test -- test/unit/cli-args.test.ts`

Expected: parser tests pass.

- [ ] **Step 3: Write failing setup and slot mutation tests**

Use a temporary HOME and assert:

- `set` creates schema version 1 and preserves unrelated top-level JSON fields;
- Chinese aliases map to stable IDs;
- required slots cannot be unset;
- `setup` in non-interactive mode fails with exact flags needed for three required slots;
- `slots --json` reports requested/resolved slot, fallback path, thinking, and revision;
- output never includes contents of mocked API key fields.

- [ ] **Step 4: Implement setup and slot commands transactionally**

Use `readJson` plus `writeJsonAtomic`. `setup` accepts repeated flags:

```text
--slot judgment=provider/model:high
--slot craft=provider/model:medium
--slot utility=provider/model:off
```

Interactive setup asks only through injected input/output adapters, making it testable without a real TTY.

- [ ] **Step 5: Write failing doctor tests**

In normal mode doctor must inspect the active release manifest, `current`, extension link, skill link, CLI link, writable config root, slot validity, Pi executable, and Node version. It may query Pi's model catalog when available; otherwise it emits a warning that model-registry and thinking-capability validation was skipped, never a successful validation claim. In `--pre-activation --release-root <path>` mode it validates the staged manifest, internal digests, entry points, executable CLI, Node/Pi compatibility, and private-data scan without requiring `current` or installed links. Test both healthy modes, skipped-registry warning, unrelated-link conflict, missing required slot, fallback cycle, missing Pi, corrupt staged digest, and redaction of values under keys matching `/key|token|secret|authorization/i`.

- [ ] **Step 6: Implement doctor and CLI entry point**

Return structured diagnostics:

```ts
interface Diagnostic {
  id: string;
  severity: "info" | "warning" | "error";
  message: string;
  path?: string;
}
```

`bin/horsepower` is a POSIX launcher that resolves its own symlinked directory and executes `node "$release_root/dist/cli/horsepower.js" "$@"`; it must not assume the current working directory.

- [ ] **Step 7: Write and implement safe uninstall tests**

Add `src/cli/commands/uninstall.ts` and `test/integration/uninstall.test.ts`. Verify normal uninstall uses `lstat`, removes only verified Horsepower-owned extension/skill/CLI/current links and managed version directories, never follows a link target, and preserves slots/settings/overrides/memory/state. Verify an unexpected regular file or unrelated symlink is reported and left untouched. Verify `--purge` requires confirmation and non-interactive purge requires `--yes` before removing preserved data.

- [ ] **Step 8: Run CLI tests and build smoke test**

Run:

```bash
npm test -- test/unit/cli-args.test.ts test/integration/cli-slots.test.ts test/integration/doctor.test.ts test/integration/uninstall.test.ts
npm run build
node dist/cli/horsepower.js --help
```

Expected: tests pass and help lists setup/configure/slots/set/unset/doctor/uninstall without update/rollback commands yet.

- [ ] **Step 9: Commit CLI configuration**

```bash
git add src/cli test/unit/cli-args.test.ts test/integration/cli-slots.test.ts test/integration/doctor.test.ts test/integration/uninstall.test.ts bin/horsepower
git commit -m "feat: configure diagnose and uninstall Horsepower"
```

---

### Task 11: GitHub Release Builder and Private-Data Gate

**Files:**
- Create: `release-manifest.json`
- Create: `scripts/build-release.mjs`
- Create: `scripts/scan-release.mjs`
- Create: `test/integration/release-build.test.ts`
- Create: `pi/skills/horsepower/SKILL.md`

**Interfaces:**
- Produces: `npm run release:build`, generating `release/horsepower-v<version>.tar.gz` and `.sha256`.
- Produces archive root `horsepower/` with CLI, dist, Pi extension directory, Pi skill directory, resources, private package metadata, and manifest.

- [ ] **Step 1: Write a failing release-layout test**

Run the builder into a temporary output directory and inspect the tar listing. Assert one `horsepower/` root, no source maps, no `node_modules`, executable `horsepower/bin/horsepower`, extension at `horsepower/pi/extensions/horsepower/index.js`, skill at `horsepower/pi/skills/horsepower/SKILL.md`, matching version metadata, and a valid checksum file.

- [ ] **Step 2: Run the release test and verify failure**

Run: `npm test -- test/integration/release-build.test.ts`

Expected: FAIL because the release builder and manifest do not exist.

- [ ] **Step 3: Implement deterministic release staging**

Add scripts:

```json
"release:build": "npm run build && node scripts/build-release.mjs",
"release:scan": "node scripts/scan-release.mjs release/stage/horsepower"
```

The builder copies only an allowlist into `release/stage/horsepower`, computes SHA-256 for `bin/horsepower`, `dist/cli/horsepower.js`, `dist/extension/index.js`, and the skill file, writes those internal digests into the staged manifest, creates a gzip tarball with normalized ordering and timestamps where platform tools permit, then writes `<digest>  <archive-name>\n` to `.sha256`.

- [ ] **Step 4: Implement the private-data scanner**

Fail on case-insensitive secret assignments, PEM headers, `/Users/`, `/home/<name>/`, `private-provider`, private provider/model IDs, and `.pi/agent/models.json`. Permit documentation phrases such as “API keys are not persisted” by matching secret-value patterns rather than the bare words `key` or `token`.

The bundled skill tells Pi when to use `horsepower_subagent`, requires an explicit `modelSlot`, prohibits nested delegation, and contains no model binding.

- [ ] **Step 5: Run release build, scan, and archive inspection**

Run:

```bash
npm run release:build
npm run release:scan
tar -tzf release/horsepower-v0.1.0-alpha.1.tar.gz
(cd release && (sha256sum -c horsepower-v0.1.0-alpha.1.tar.gz.sha256 2>/dev/null || shasum -a 256 -c horsepower-v0.1.0-alpha.1.tar.gz.sha256))
npm test -- test/integration/release-build.test.ts
```

Expected: scan passes, archive has only the allowlisted root, checksum verifies, test passes.

- [ ] **Step 6: Commit release construction**

```bash
git add release-manifest.json scripts package.json pi resources/skills test/integration/release-build.test.ts
git commit -m "build: create verified GitHub release artifacts"
```

---

### Task 12: Curl Bootstrap Installer with Stable Symlinks

**Files:**
- Create: `install.sh`
- Create: `test/e2e/install.sh`
- Create: `test/e2e/fixtures/mock-release-server.mjs`

**Interfaces:**
- Produces installer flags: `--version`, `--no-setup`, `--yes`, `--install-root`.
- Consumes GitHub Releases API/assets in production and injectable `HORSEPOWER_RELEASE_BASE_URL` only in tests.
- Produces stable `current`, extension, skill, and CLI symlinks.

- [ ] **Step 1: Write failing installer acceptance cases**

The shell test must use temporary HOME, agent dir, bin dir, and a local HTTP fixture. Cover:

1. clean installation;
2. exact version installation;
3. idempotent repeat installation;
4. no setup in a no-controlling-terminal environment;
5. checksum mismatch;
6. archive traversal and unsafe symlink rejection;
7. manifest/tag mismatch;
8. regular-file and unrelated-link conflicts;
9. failed post-install doctor restores prior `current`;
10. Linux/macOS success and explicit Windows rejection through injectable test platform.

Assert no command log contains `pi install`, `pi update`, `sudo`, or shell-rc writes.

- [ ] **Step 2: Run installer acceptance and verify failure**

Run: `bash test/e2e/install.sh`

Expected: FAIL because `install.sh` does not exist.

- [ ] **Step 3: Implement strict bootstrap parsing and prerequisites**

Start with:

```sh
#!/bin/sh
set -eu
umask 077
REPO="LosFurina/horsepower"
INSTALL_ROOT="${HORSEPOWER_INSTALL_ROOT:-$HOME/.pi/agent/horsepower}"
AGENT_DIR="${HORSEPOWER_AGENT_DIR:-$HOME/.pi/agent}"
BIN_DIR="${HORSEPOWER_BIN_DIR:-$HOME/.local/bin}"
```

Use `mktemp -d` plus a trap. Reject unsupported arguments and non-absolute `--install-root`. Detect `uname -s` as Darwin or Linux only. Require `node`, `pi`, `curl`, `tar`, and either `sha256sum` or `shasum -a 256`.

- [ ] **Step 4: Implement verified download and safe extraction**

Resolve latest stable release from GitHub unless `--version` is present. Download exactly the expected archive and `.sha256`. Verify before extraction. List archive entries before extraction and reject absolute paths, `..` path components, roots other than `horsepower/`, and archived symbolic/hard links. Extract into a staging directory, run `node <stage>/dist/cli/horsepower.js doctor --pre-activation --release-root <stage> --json`, and rename the verified directory to `versions/<version>` only after it exits zero.

- [ ] **Step 5: Implement atomic activation and conflict-safe links**

Create `current.next` as a relative symlink to `versions/<version>`, then rename it over `current`. Create links only when absent or already Horsepower-owned:

```text
$AGENT_DIR/extensions/horsepower -> $INSTALL_ROOT/current/pi/extensions/horsepower
$AGENT_DIR/skills/horsepower     -> $INSTALL_ROOT/current/pi/skills/horsepower
$BIN_DIR/horsepower              -> $INSTALL_ROOT/current/bin/horsepower
```

Record the previous `current` target and every newly created link. If doctor fails, restore prior activation and remove only links created by this run. Never follow a link during cleanup.

- [ ] **Step 6: Implement `/dev/tty` setup and PATH notice**

When `/dev/tty` is readable and writable and `--no-setup` is absent, run `horsepower setup </dev/tty >/dev/tty 2>/dev/tty`. Otherwise print the exact `horsepower setup --slot ...` follow-up. Detect whether `BIN_DIR` is a PATH component; print an export suggestion without editing any file.

- [ ] **Step 7: Run installer acceptance and shell syntax checks**

Run:

```bash
sh -n install.sh
bash test/e2e/install.sh
rg -n 'pi (install|update)|sudo|\.bashrc|\.zshrc' install.sh && exit 1 || true
```

Expected: syntax passes, all installer cases pass, forbidden-command scan prints no matches.

- [ ] **Step 8: Commit the bootstrap installer**

```bash
git add install.sh test/e2e
git commit -m "feat: install verified releases with stable symlinks"
```

---

### Task 13: Real Pi Smoke Tests and Alpha Documentation

**Files:**
- Create: `test/e2e/pi-extension-smoke.sh`
- Create: `README.md`
- Create: `README.zh-CN.md`
- Create: `CHANGELOG.md`
- Create: `docs/reference/model-slots.md`
- Create: `docs/reference/subagent-tool.md`

**Interfaces:**
- Verifies the built extension through direct Pi resource symlinks.
- Documents the GitHub-only distribution and alpha limitations.

- [ ] **Step 1: Write the real Pi smoke script**

The script creates a temporary HOME, installs the locally built release with test URL overrides, supplies a model-slot fixture only when `HORSEPOWER_SMOKE_MODEL` is set, launches Pi RPC to enumerate tools, and asserts `horsepower_subagent` exists while `team_*` and generic Horsepower-owned `subagent` do not. Without a smoke model, it stops after extension loading; with one, it creates a worker, sends two turns, verifies context retention, aborts a held turn, and destroys the worker.

- [ ] **Step 2: Run the extension-loading smoke test**

Run: `bash test/e2e/pi-extension-smoke.sh`

Expected: PASS for extension loading without requiring an external model call.

- [ ] **Step 3: Write English and Chinese alpha documentation**

README must include:

- primary `curl -fsSL ... | bash` command;
- inspect-before-execution alternative;
- GitHub-only and no-npm/no-`pi install` statement;
- stable symlink layout;
- required slot setup examples with fictional `provider/model-*` IDs;
- explicit dispatch examples for single, parallel, chain, create/send/abort/read/destroy;
- eight-worker and four-concurrent-one-shot limits;
- process-lifetime persistence and reload cleanup;
- security statement that subprocesses are not sandboxes;
- Linux/macOS support and explicit Windows non-support;
- safe uninstall and purge behavior; update and rollback remain scheduled for the update/migration milestone.

Reference docs must reproduce exact JSON/tool fields from the implemented TypeScript interfaces rather than paraphrasing them.

- [ ] **Step 4: Run documentation and private-data scans**

Run:

```bash
rg -n 'npm install|npx |pi install|pi update|@losfurina' README.md README.zh-CN.md docs/reference && exit 1 || true
rg -n 'private-provider|private-model|gpt-|api[_-]?key\s*[:=]|/Users/' README.md README.zh-CN.md docs/reference resources && exit 1 || true
npm run check
bash test/e2e/pi-extension-smoke.sh
```

Expected: forbidden scans print no matches; project checks and smoke test pass.

- [ ] **Step 5: Commit docs and smoke coverage**

```bash
git add README.md README.zh-CN.md CHANGELOG.md docs/reference test/e2e/pi-extension-smoke.sh
git commit -m "docs: document Horsepower alpha usage"
```

---

### Task 14: CI, Release Workflow, and Alpha Verification Gate

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `scripts/verify-alpha.mjs`
- Create: `test/unit/verify-alpha.test.ts`

**Interfaces:**
- Produces: `npm run verify:alpha` as the local release gate.
- Produces GitHub Release assets only from tags matching `v*` and only after all checks pass.

- [ ] **Step 1: Write a failing alpha-gate test**

Test that `verify-alpha.mjs` fails when the release archive lacks the skill, when `package.json` is not private, when manifest and package versions differ, or when a forbidden private path appears; it passes for the generated fixture.

- [ ] **Step 2: Run the gate test and verify failure**

Run: `npm test -- test/unit/verify-alpha.test.ts`

Expected: FAIL because the verifier does not exist.

- [ ] **Step 3: Implement the alpha verifier**

Add:

```json
"verify:alpha": "npm run check && npm run release:build && npm run release:scan && node scripts/verify-alpha.mjs"
```

The verifier checks archive/checksum names, SHA-256, manifest/package/tag-compatible version format, required entry points, executable bits, private package metadata, bundled-resource neutrality, and absence of forbidden files.

- [ ] **Step 4: Add CI and tag release workflows**

`ci.yml` runs on pushes and pull requests using Node 22 on Ubuntu and macOS: `npm ci`, `npm run verify:alpha`, and `bash test/e2e/install.sh`.

`release.yml` runs only on tags `v*`, repeats `npm ci` and `npm run verify:alpha`, checks that the tag without `v` equals `package.json.version`, and uploads exactly the `.tar.gz` and `.sha256` assets using GitHub's release action. It must not invoke npm publish.

- [ ] **Step 5: Run the complete local gate**

Run:

```bash
npm run verify:alpha
bash test/e2e/install.sh
bash test/e2e/pi-extension-smoke.sh
git diff --check
```

Expected: all unit/integration/e2e tests pass, build and release scans pass, installer and Pi loading pass, and no whitespace errors remain.

- [ ] **Step 6: Commit CI and release gates**

```bash
git add .github scripts/verify-alpha.mjs package.json test/unit/verify-alpha.test.ts
git commit -m "ci: gate GitHub alpha releases"
```

- [ ] **Step 7: Record final verification evidence without publishing**

Run:

```bash
git status --short --branch
git log --oneline --decorate -15
ls -l release/horsepower-v0.1.0-alpha.1.tar.gz release/horsepower-v0.1.0-alpha.1.tar.gz.sha256
```

Expected: clean working tree, fourteen implementation commits after the design commits, and both local release assets present. Do not create the public GitHub repository, tag, push, or publish without a separate explicit user request.
