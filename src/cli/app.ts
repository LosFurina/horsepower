import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, readlink, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { readJsonObject, writeJsonObject, type JsonObject } from "../config/json-store.js";
import { resolveHorsepowerPaths } from "../config/paths.js";
import { parseWebhookSettings, redactCredentials } from "../config/webhook.js";
import { createWebhookNotifier, type WebhookAuth } from "../lifecycle/webhook-notifier.js";
import { validateOpenSpecInstallation } from "../openspec/boundary.js";
import { createSlotRegistry, type ModelCatalog, type SlotBinding, type SlotConfiguration, type ThinkingLevel } from "../slots/registry.js";

export interface CliResult { exitCode: number; stdout: string; stderr: string }
interface CommandResult { data: unknown; ok?: boolean; exitCode?: number; message?: string }
interface RunResult { code: number; stdout: string; stderr: string }
export interface CliOptions {
  homeDir: string;
  cwd: string;
  platform: NodeJS.Platform;
  models?: ModelCatalog;
  runOpenSpec(args: readonly string[], options: { cwd: string }): Promise<RunResult>;
  fetch?: typeof fetch;
  now?: () => Date;
  interactive?: boolean;
  confirm?: (message: string) => Promise<boolean | undefined>;
}

class UsageError extends Error {}
const slotId = /^[a-z][a-z0-9-]{0,31}$/u;
const releaseVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, nested]) => [key, stable(nested)]));
}
function json(value: unknown): string { return `${JSON.stringify(stable(value))}\n`; }
function absent(cause: unknown): boolean { return (cause as NodeJS.ErrnoException).code === "ENOENT"; }
async function optionalObject(path: string): Promise<JsonObject> {
  try { return await readJsonObject(path); } catch (cause) { if (absent(cause)) return {}; throw cause; }
}
function object(value: unknown): JsonObject { return value !== null && !Array.isArray(value) && typeof value === "object" ? value as JsonObject : {}; }
function flags(args: readonly string[]): { positionals: string[]; values: Map<string, string>; switches: Set<string> } {
  const positionals: string[] = []; const values = new Map<string, string>(); const switches = new Set<string>();
  const boolean = new Set(["json", "yes", "dispatch", "no-dispatch", "change", "no-change"]);
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index]!;
    if (!item.startsWith("--")) { positionals.push(item); continue; }
    const name = item.slice(2);
    if (boolean.has(name)) {
      if (switches.has(name)) throw new UsageError(`Duplicate option: --${name}`);
      switches.add(name);
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new UsageError(`Missing value for --${name}`);
    if (values.has(name)) throw new UsageError(`Duplicate option: --${name}`);
    values.set(name, value);
  }
  return { positionals, values, switches };
}
function only(parsed: ReturnType<typeof flags>, allowedValues: readonly string[], allowedSwitches: readonly string[]): void {
  for (const key of parsed.values.keys()) if (!allowedValues.includes(key)) throw new UsageError(`Unknown option: --${key}`);
  for (const key of parsed.switches) if (!allowedSwitches.includes(key) && key !== "json") throw new UsageError(`Unknown option: --${key}`);
}
function scopePath(scope: string | undefined, paths: ReturnType<typeof resolveHorsepowerPaths>): string {
  if (scope === undefined || scope === "global") return paths.global.modelSlots;
  if (scope === "project") return paths.project.modelSlots;
  throw new UsageError(`Invalid scope: ${scope}`);
}
async function configurations(paths: ReturnType<typeof resolveHorsepowerPaths>): Promise<{ global: SlotConfiguration; project: SlotConfiguration }> {
  return { global: await optionalObject(paths.global.modelSlots), project: await optionalObject(paths.project.modelSlots) };
}
async function updateSlot(path: string, id: string, binding: SlotBinding | undefined): Promise<JsonObject> {
  const current = await optionalObject(path); const slots = { ...object(current.slots) };
  if (binding) slots[id] = binding; else delete slots[id];
  const next = { ...current, slots }; await writeJsonObject(path, next); return next;
}
function redactSettings(raw: JsonObject): JsonObject {
  return redactCredentials(raw) as JsonObject;
}
function installTopology(home: string) {
  const root = join(home, ".pi", "agent", "horsepower");
  return { root, current: join(root, "current"), versions: join(root, "versions"), links: [
    { path: join(home, ".pi", "agent", "extensions", "horsepower"), target: join(root, "current", "pi", "extensions", "horsepower") },
    { path: join(home, ".pi", "agent", "skills", "horsepower"), target: join(root, "current", "pi", "skills", "horsepower") },
    { path: join(home, ".local", "bin", "horsepower"), target: join(root, "current", "bin", "horsepower") },
  ] };
}
async function verifyNoSymlinkPath(root: string, candidate: string, finalType: "directory" | "file"): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate);
  if (pathFromRoot === "" || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || isAbsolute(pathFromRoot)) {
    throw new Error(`Unsafe managed path: ${resolvedCandidate}`);
  }
  let current = resolvedRoot;
  const components = pathFromRoot.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error(`Refusing symbolic link in managed path: ${current}`);
    const final = index === components.length - 1;
    if ((!final || finalType === "directory") && !info.isDirectory()) throw new Error(`Expected managed directory: ${current}`);
    if (final && finalType === "file" && !info.isFile()) throw new Error(`Expected managed regular file: ${current}`);
  }
}

async function readManagedManifest(release: string): Promise<JsonObject> {
  const manifestPath = join(release, "release-manifest.json");
  await verifyNoSymlinkPath(dirname(release), release, "directory");
  await verifyNoSymlinkPath(release, manifestPath, "file");
  return readJsonObject(manifestPath);
}

async function managedRootState(root: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try { const info = await lstat(root); return info.isDirectory() && !info.isSymbolicLink() ? { status: "owned" } : { status: "conflict", message: `Refusing unowned Horsepower root: ${root}` }; }
  catch (cause) { if (absent(cause)) return { status: "absent" }; throw cause; }
}
async function linkState(path: string, expected: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try {
    const info = await lstat(path); if (!info.isSymbolicLink()) return { status: "conflict", message: `Refusing non-symlink: ${path}` };
    const target = await readlink(path); const actual = resolve(dirname(path), target);
    return actual === resolve(expected) ? { status: "owned" } : { status: "conflict", message: `Refusing unrelated symlink: ${path}` };
  } catch (cause) { if (absent(cause)) return { status: "absent" }; throw cause; }
}
async function currentState(root: string, current: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try {
    const info = await lstat(current);
    if (!info.isSymbolicLink()) return { status: "conflict", message: `Refusing non-symlink: ${current}` };
    const target = await readlink(current);
    const versions = join(resolve(root), "versions");
    const resolved = resolve(dirname(current), target);
    const name = resolved.startsWith(`${versions}/`) && dirname(resolved) === versions ? resolved.slice(versions.length + 1) : "";
    if (!name.startsWith("v") || !releaseVersion.test(name.slice(1))) {
      return { status: "conflict", message: `Refusing unmanaged current target: ${current}` };
    }
    const versionsInfo = await lstat(versions);
    if (!versionsInfo.isDirectory() || versionsInfo.isSymbolicLink()) {
      return { status: "conflict", message: `Refusing unmanaged current target: ${current}` };
    }
    const manifest = await readManagedManifest(resolved);
    if (manifest.version !== name.slice(1)) return { status: "conflict", message: `Refusing current target with mismatched manifest: ${current}` };
    return { status: "owned" };
  } catch (cause) {
    if (absent(cause)) {
      try { await lstat(current); } catch (currentCause) { if (absent(currentCause)) return { status: "absent" }; }
      return { status: "conflict", message: `Refusing dangling current target: ${current}` };
    }
    if (cause instanceof Error && (cause.message.startsWith("Malformed JSON") || cause.message.includes("managed") || cause.message.includes("symbolic link"))) {
      return { status: "conflict", message: `Refusing current target with invalid manifest: ${current}` };
    }
    throw cause;
  }
}
async function versionsState(versions: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try {
    const rootInfo = await lstat(versions);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return { status: "conflict", message: `Refusing unowned versions path: ${versions}` };
    for (const name of await readdir(versions)) {
      const release = join(versions, name); const info = await lstat(release);
      if (!name.startsWith("v") || !releaseVersion.test(name.slice(1)) || !info.isDirectory() || info.isSymbolicLink()) return { status: "conflict", message: `Refusing unmanaged version: ${release}` };
      try { const manifest = await readManagedManifest(release); if (`v${String(manifest.version)}` !== name) throw new Error(); }
      catch { return { status: "conflict", message: `Refusing version without matching manifest: ${release}` }; }
    }
    return { status: "owned" };
  } catch (cause) { if (absent(cause)) return { status: "absent" }; throw cause; }
}

export function createCli(options: CliOptions) {
  const paths = resolveHorsepowerPaths({ homeDir: options.homeDir, projectDir: options.cwd });
  const topology = installTopology(options.homeDir);

  async function slotsData() {
    const config = await configurations(paths); const registry = createSlotRegistry({ ...config, ...(options.models ? { models: options.models } : {}) });
    const resolved = Object.fromEntries(Object.keys(registry.effective).sort().map((id) => [id, registry.resolve(id)]));
    return { effective: registry.effective, resolved, revision: registry.revision };
  }
  async function setup(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["judgment", "judgment-thinking", "craft", "craft-thinking", "utility", "utility-thinking"], []);
    if (parsed.positionals.length) throw new UsageError("setup accepts no positional arguments");
    const slots: Record<string, SlotBinding> = {};
    for (const id of ["judgment", "craft", "utility"] as const) {
      const model = parsed.values.get(id), thinking = parsed.values.get(`${id}-thinking`);
      if (!model || !thinking) throw new UsageError(`setup requires --${id} and --${id}-thinking`);
      slots[id] = { model, thinking: thinking as ThinkingLevel };
    }
    try { createSlotRegistry({ global: { slots }, ...(options.models ? { models: options.models } : {}) }); }
    catch (cause) { throw new UsageError((cause as Error).message); }
    const current = await optionalObject(paths.global.modelSlots); await writeJsonObject(paths.global.modelSlots, { ...current, slots: { ...object(current.slots), ...slots } });
    const settings = await optionalObject(paths.global.settings); await writeJsonObject(paths.global.settings, settings);
    return { data: await slotsData(), message: "Horsepower configured" };
  }
  async function setSlot(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["model", "thinking", "fallback", "scope"], []); const id = parsed.positionals[0];
    if (!id || parsed.positionals.length !== 1) throw new UsageError("set requires one slot ID");
    let binding: SlotBinding;
    if (parsed.values.has("fallback")) { if (parsed.values.has("model") || parsed.values.has("thinking")) throw new UsageError("Choose --fallback or --model/--thinking"); binding = { fallback: parsed.values.get("fallback")! }; }
    else { const model = parsed.values.get("model"), thinking = parsed.values.get("thinking"); if (!model || !thinking) throw new UsageError("set requires --model and --thinking"); binding = { model, thinking: thinking as ThinkingLevel }; }
    if (!slotId.test(id)) throw new UsageError(`Invalid model slot ID: ${id}`);
    const path = scopePath(parsed.values.get("scope"), paths); const before = await optionalObject(path); await updateSlot(path, id, binding);
    try { return { data: await slotsData(), message: `Set ${id}` }; } catch (cause) { await writeJsonObject(path, before); throw new UsageError((cause as Error).message); }
  }
  async function unsetSlot(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["scope"], []); const id = parsed.positionals[0]; if (!id || parsed.positionals.length !== 1) throw new UsageError("unset requires one slot ID");
    if (!slotId.test(id)) throw new UsageError(`Invalid model slot ID: ${id}`);
    const path = scopePath(parsed.values.get("scope"), paths); const before = await optionalObject(path); await updateSlot(path, id, undefined);
    try { return { data: await slotsData(), message: `Unset ${id}` }; } catch (cause) { await writeJsonObject(path, before); throw new UsageError((cause as Error).message); }
  }
  async function configure(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    const values = ["judgment", "judgment-thinking", "craft", "craft-thinking", "utility", "utility-thinking"];
    only(parsed, values, []); if (parsed.positionals.length) throw new UsageError("configure accepts no positional arguments");
    if (parsed.values.size === 0) return { data: redactSettings(await optionalObject(paths.global.settings)) };
    const current = await optionalObject(paths.global.modelSlots); const slots = { ...object(current.slots) } as Record<string, unknown>;
    for (const id of ["judgment", "craft", "utility"] as const) {
      const model = parsed.values.get(id), thinking = parsed.values.get(`${id}-thinking`);
      if ((model && !thinking) || (!model && thinking)) throw new UsageError(`configure requires --${id} and --${id}-thinking together`);
      if (model && thinking) slots[id] = { model, thinking };
    }
    const before = current; await writeJsonObject(paths.global.modelSlots, { ...current, slots });
    try { return { data: await slotsData(), message: "Horsepower configuration updated" }; } catch (cause) { await writeJsonObject(paths.global.modelSlots, before); throw new UsageError((cause as Error).message); }
  }
  async function webhook(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    const action = parsed.positionals[0]; if (!action || parsed.positionals.length !== 1) throw new UsageError("webhook requires configure, skip, disable, or test");
    if (action === "disable" || action === "skip") {
      only(parsed, [], []);
      const current = await optionalObject(paths.global.settings);
      const scrubbed = redactCredentials(object(current.webhook)) as JsonObject;
      const { url: _url, auth: _auth, notifications: _notifications, scopes: _scopes, ...preserved } = scrubbed;
      const next = { ...current, webhook: { ...preserved, enabled: false } };
      await writeJsonObject(paths.global.settings, next);
      return { data: redactSettings(next), message: "Webhook disabled" };
    }
    if (action === "configure") {
      only(parsed, ["url", "auth", "secret", "token"], ["dispatch", "no-dispatch", "change", "no-change"]);
      if (parsed.switches.has("change") && parsed.switches.has("no-change")) throw new UsageError("Choose --change or --no-change");
      if (parsed.switches.has("dispatch") && parsed.switches.has("no-dispatch")) throw new UsageError("Choose --dispatch or --no-dispatch");
      const url = parsed.values.get("url"), mode = parsed.values.get("auth"); if (!url || !mode) throw new UsageError("webhook configure requires --url and --auth");
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.username || parsedUrl.password) throw new UsageError("Webhook URL must not contain credentials");
        if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") throw new Error();
      } catch (cause) {
        if (cause instanceof UsageError) throw cause;
        throw new UsageError("Webhook URL must be HTTPS (localhost is allowed for testing)");
      }
      const secret = parsed.values.get("secret"), token = parsed.values.get("token");
      let auth: WebhookAuth; if (mode === "hmac") { if (!secret) throw new UsageError("HMAC authentication requires --secret"); if (token) throw new UsageError("HMAC authentication does not accept --token"); auth = { mode, secret }; }
      else if (mode === "bearer") { if (!token) throw new UsageError("Bearer authentication requires --token"); if (secret) throw new UsageError("Bearer authentication does not accept --secret"); auth = { mode, token }; }
      else if (mode === "none") { if (secret || token) throw new UsageError("None authentication does not accept --secret or --token"); auth = { mode }; } else throw new UsageError(`Invalid webhook auth mode: ${mode}`);
      const current = await optionalObject(paths.global.settings); const previous = object(current.webhook);
      const next = { ...current, webhook: { ...previous, enabled: true, url, notifications: { change: parsed.switches.has("no-change") ? false : parsed.switches.has("change") ? true : object(previous.notifications).change ?? true, dispatch: parsed.switches.has("dispatch") ? true : parsed.switches.has("no-dispatch") ? false : object(previous.notifications).dispatch ?? false }, auth } };
      await writeJsonObject(paths.global.settings, next); return { data: redactSettings(next), message: "Webhook configured" };
    }
    if (action === "test") {
      only(parsed, [], []); const globalSettings = await optionalObject(paths.global.settings); const projectSettings = await optionalObject(paths.project.settings); const parsedSettings = parseWebhookSettings(globalSettings.webhook, projectSettings.webhook); if (!parsedSettings) throw new Error("Webhook is disabled");
      const notifier = createWebhookNotifier({ config: parsedSettings.config, ...(options.fetch ? { fetch: options.fetch } : {}), retryDelaysMs: [0] });
      const result = await notifier.notify({ eventId: randomUUID(), timestamp: (options.now ?? (() => new Date()))().toISOString(), scope: "change", runId: "cli-webhook-test", status: "completed", summary: "webhook test", evidenceRefs: [] }); notifier.abandon();
      if (!result.delivered) throw new Error(result.error ?? "Webhook delivery failed"); return { data: result, message: "Webhook delivered" };
    }
    throw new UsageError(`Unknown webhook command: ${action}`);
  }
  async function openspecCheck() {
    try {
      const result = await validateOpenSpecInstallation({ run: options.runOpenSpec, readText: (path) => readFile(path, "utf8") }, options.cwd);
      return { id: "openspec", status: "ok", message: `Official OpenSpec ${result.version} healthy` };
    } catch (cause) {
      const message = (cause as Error).message;
      const action = message.includes("init --tools pi") ? "Run openspec init --tools pi"
        : message.includes("openspec update") ? "Run openspec update"
          : message.includes("not healthy") ? "Run openspec doctor"
            : "Install official @fission-ai/openspec 1.6.0 or newer";
      return { id: "openspec", status: "error", message, action };
    }
  }
  async function installationCheck() { const current = await currentState(topology.root, topology.current); const states = await Promise.all(topology.links.map((link) => linkState(link.path, link.target))); return current.status === "owned" && states.every((state) => state.status === "owned") ? { id: "installation", status: "ok", message: "Managed symlink topology is owned" } : { id: "installation", status: "error", message: [current, ...states].filter((state) => state.status !== "owned").map((state) => state.message ?? state.status).join("; "), action: "Install or repair Horsepower from an official release" }; }
  async function doctor(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], []); const checks: Array<Record<string, unknown>> = [];
    try { const data = await slotsData(); checks.push({ id: "configuration", status: "ok", message: `Slots revision ${data.revision}` }); } catch (cause) { checks.push({ id: "configuration", status: "error", message: (cause as Error).message, action: "Run horsepower setup" }); }
    const globalSettings = await optionalObject(paths.global.settings);
    const projectSettings = await optionalObject(paths.project.settings);
    try {
      const configured = parseWebhookSettings(globalSettings.webhook, projectSettings.webhook);
      checks.push(configured ? { id: "notification", status: "ok", message: `Webhook enabled (${configured.config.auth.mode})` } : { id: "notification", status: "skipped", message: "Webhook disabled" });
    } catch (cause) {
      checks.push({ id: "notification", status: "error", message: (cause as Error).message, action: "Run horsepower webhook configure or webhook disable" });
    }
    checks.push(await openspecCheck()); checks.push(options.models ? { id: "model-registry", status: "ok", message: "Slot models validated" } : { id: "model-registry", status: "skipped", message: "Pi model registry unavailable; validation skipped" }); checks.push(await installationCheck());
    return { data: { checks }, ok: !checks.some((check) => check.status === "error"), exitCode: checks.some((check) => check.status === "error") ? 1 : 0 };
  }
  async function preflight(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["version"], []); const staged = parsed.positionals[0], expected = parsed.values.get("version"); if (!staged || parsed.positionals.length !== 1 || !expected) throw new UsageError("preflight requires STAGED_ROOT --version VERSION");
    if (options.platform !== "linux" && options.platform !== "darwin") throw new Error(`Unsupported platform: ${options.platform}`);
    if (!releaseVersion.test(expected)) throw new UsageError(`Invalid release version: ${expected}`);
    const root = resolve(staged); const stagedInfo = await lstat(root).catch(() => undefined); if (!stagedInfo?.isDirectory() || stagedInfo.isSymbolicLink()) throw new Error(`Invalid staged release root: ${root}`); let manifest: JsonObject; try { manifest = await readManagedManifest(root); } catch (cause) { throw new Error(`Invalid staged release: ${(cause as Error).message}`); }
    if (typeof manifest.version !== "string" || !releaseVersion.test(manifest.version)) throw new Error("Invalid staged manifest version");
    if (manifest.version !== expected) throw new Error(`Staged manifest version mismatch: expected ${expected}`); const entries = object(manifest.entryPoints);
    for (const [name, expectedPath] of Object.entries({ cli: "bin/horsepower", extension: "pi/extensions/horsepower/index.js", skill: "pi/skills/horsepower/SKILL.md" })) { if (entries[name] !== expectedPath) throw new Error(`Invalid staged ${name} entry point`); const candidate = normalize(String(entries[name])); if (candidate.startsWith("..") || isAbsolute(candidate)) throw new Error(`Unsafe staged ${name} entry point`); try { await verifyNoSymlinkPath(root, join(root, candidate), "file"); } catch { throw new Error(`Missing staged ${name}: ${candidate}`); } }
    const managedRoot = await managedRootState(topology.root); if (managedRoot.status === "conflict") throw new Error(managedRoot.message ?? "Installation ownership conflict");
    const current = await currentState(topology.root, topology.current); const links = await Promise.all(topology.links.map((link) => linkState(link.path, link.target))); const conflict = [current, ...links].find((state) => state.status === "conflict"); if (conflict) throw new Error(conflict.message ?? "Installation ownership conflict");
    return { data: { eligible: true, root, version: expected }, message: "Staged release eligible" };
  }
  async function uninstall(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], []); if (parsed.positionals.length) throw new UsageError("uninstall accepts no arguments"); const root = await managedRootState(topology.root); if (root.status === "conflict") throw new Error(root.message); const current = await currentState(topology.root, topology.current); const versions = await versionsState(topology.versions); const states = await Promise.all(topology.links.map(async (link) => ({ link, state: await linkState(link.path, link.target) }))); const conflicts = [current, versions, ...states.map(({ state }) => state)].filter((state) => state.status === "conflict"); if (conflicts.length) throw new Error(conflicts.map((state) => state.message).join("; "));
    for (const { link, state } of states) if (state.status === "owned") await rm(link.path); if (current.status === "owned") await rm(topology.current); if (versions.status === "owned") await rm(topology.versions, { recursive: true }); return { data: { preserved: [paths.global.modelSlots, paths.global.settings, join(topology.root, "memory"), join(topology.root, "state"), paths.project.root] }, message: "Horsepower code uninstalled; user data preserved" };
  }
  async function purge(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], ["yes"]); if (parsed.positionals.length) throw new UsageError("purge accepts no arguments"); if (!parsed.switches.has("yes")) { if (options.interactive !== true || !options.confirm) throw new UsageError("Purge requires --yes in noninteractive mode"); const confirmed = await options.confirm("Permanently remove Horsepower user data? Type yes to continue: "); if (confirmed === undefined) throw new UsageError("Purge requires --yes when no controlling terminal is available"); if (!confirmed) return { data: { purged: false }, message: "Purge canceled; no data changed" }; }
    const root = await managedRootState(topology.root); if (root.status === "conflict") throw new Error(root.message); const current = await currentState(topology.root, topology.current); if (current.status !== "absent") throw new Error("Run horsepower uninstall before purge"); await rm(topology.root, { recursive: true, force: true }); await rm(paths.project.root, { recursive: true, force: true }); return { data: { purged: true }, message: "Horsepower user data purged" };
  }

  return { async run(argv: readonly string[]): Promise<CliResult> {
    let machine = argv.includes("--json");
    try {
      const jsonCount = argv.filter((argument) => argument === "--json").length;
      if (jsonCount > 1) throw new UsageError("Duplicate option: --json");
      const normalizedArgv = argv.filter((argument) => argument !== "--json");
      const command = normalizedArgv[0]; if (!command || command.startsWith("--")) throw new UsageError("A command is required"); const parsed = flags([...normalizedArgv.slice(1), ...(machine ? ["--json"] : [])]); machine = parsed.switches.has("json"); let result: CommandResult;
      if (command === "setup") result = await setup(parsed); else if (command === "configure") result = await configure(parsed); else if (command === "slots") { only(parsed, [], []); if (parsed.positionals.length) throw new UsageError("slots accepts no arguments"); result = { data: await slotsData() }; }
      else if (command === "set") result = await setSlot(parsed); else if (command === "unset") result = await unsetSlot(parsed); else if (command === "webhook") result = await webhook(parsed); else if (command === "doctor") result = await doctor(parsed); else if (command === "preflight") result = await preflight(parsed); else if (command === "uninstall") result = await uninstall(parsed); else if (command === "purge") result = await purge(parsed); else throw new UsageError(`Unknown command: ${command}`);
      const ok = result.ok ?? true; const exitCode = result.exitCode ?? (ok ? 0 : 1); return machine ? { exitCode, stdout: json({ data: result.data, ok }), stderr: "" } : { exitCode, stdout: `${result.message ?? (ok ? "OK" : "FAILED")}\n`, stderr: "" };
    } catch (cause) { const usage = cause instanceof UsageError; const exitCode = usage ? 2 : 1; const rawMessage = cause instanceof Error ? cause.message : "Unknown error"; const message = String(redactCredentials(rawMessage)); return machine ? { exitCode, stdout: "", stderr: json({ error: { code: usage ? "USAGE" : "FAILED", message }, ok: false }) } : { exitCode, stdout: "", stderr: `horsepower: ${message}\n` }; }
  } };
}
