import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, readlink, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { readJsonObject, writeJsonObject, type JsonObject } from "../config/json-store.js";
import { resolveHorsepowerPaths } from "../config/paths.js";
import { createWebhookNotifier, type WebhookAuth, type WebhookConfig } from "../lifecycle/webhook-notifier.js";
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
  confirm?: (message: string) => Promise<boolean>;
}

class UsageError extends Error {}
const SECRET = "[REDACTED]";
const slotId = /^[a-z][a-z0-9-]{0,31}$/u;

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
    if (boolean.has(name)) { switches.add(name); continue; }
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
  const webhook = object(raw.webhook); const auth = object(webhook.auth);
  const redactedAuth = auth.mode === "hmac" ? { mode: "hmac", secret: SECRET } : auth.mode === "bearer" ? { mode: "bearer", token: SECRET } : auth.mode === "none" ? { mode: "none" } : undefined;
  return { ...raw, ...(raw.webhook === undefined ? {} : { webhook: { ...webhook, ...(redactedAuth ? { auth: redactedAuth } : {}) } }) };
}
function installTopology(home: string) {
  const root = join(home, ".pi", "agent", "horsepower");
  return { root, current: join(root, "current"), versions: join(root, "versions"), links: [
    { path: join(home, ".pi", "agent", "extensions", "horsepower"), target: join(root, "current", "pi", "extensions", "horsepower") },
    { path: join(home, ".pi", "agent", "skills", "horsepower"), target: join(root, "current", "pi", "skills", "horsepower") },
    { path: join(home, ".local", "bin", "horsepower"), target: join(root, "current", "bin", "horsepower") },
  ] };
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
function safeManagedCurrent(root: string, target: string): boolean {
  const resolved = resolve(root, target); const versions = join(resolve(root), "versions");
  return relative(versions, resolved) !== "" && !relative(versions, resolved).startsWith("..") && !isAbsolute(relative(versions, resolved));
}
async function currentState(root: string, current: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try { const info = await lstat(current); if (!info.isSymbolicLink()) return { status: "conflict", message: `Refusing non-symlink: ${current}` }; const target = await readlink(current); return safeManagedCurrent(root, target) ? { status: "owned" } : { status: "conflict", message: `Refusing unmanaged current target: ${current}` }; }
  catch (cause) { if (absent(cause)) return { status: "absent" }; throw cause; }
}
async function versionsState(versions: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try {
    const rootInfo = await lstat(versions);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return { status: "conflict", message: `Refusing unowned versions path: ${versions}` };
    for (const name of await readdir(versions)) {
      const release = join(versions, name); const info = await lstat(release);
      if (!/^v[0-9][0-9A-Za-z.-]*$/u.test(name) || !info.isDirectory() || info.isSymbolicLink()) return { status: "conflict", message: `Refusing unmanaged version: ${release}` };
      try { const manifest = await readJsonObject(join(release, "release-manifest.json")); if (`v${String(manifest.version)}` !== name) throw new Error(); }
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
    createSlotRegistry({ global: { slots }, ...(options.models ? { models: options.models } : {}) });
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
    if (!slotId.test(id)) throw new Error(`Invalid model slot ID: ${id}`);
    const path = scopePath(parsed.values.get("scope"), paths); const before = await optionalObject(path); await updateSlot(path, id, binding);
    try { return { data: await slotsData(), message: `Set ${id}` }; } catch (cause) { await writeJsonObject(path, before); throw cause; }
  }
  async function unsetSlot(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["scope"], []); const id = parsed.positionals[0]; if (!id || parsed.positionals.length !== 1) throw new UsageError("unset requires one slot ID");
    const path = scopePath(parsed.values.get("scope"), paths); const before = await optionalObject(path); await updateSlot(path, id, undefined);
    try { return { data: await slotsData(), message: `Unset ${id}` }; } catch (cause) { await writeJsonObject(path, before); throw cause; }
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
    try { return { data: await slotsData(), message: "Horsepower configuration updated" }; } catch (cause) { await writeJsonObject(paths.global.modelSlots, before); throw cause; }
  }
  async function webhook(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    const action = parsed.positionals[0]; if (!action || parsed.positionals.length !== 1) throw new UsageError("webhook requires configure, skip, disable, or test");
    if (action === "disable" || action === "skip") { only(parsed, [], []); const current = await optionalObject(paths.global.settings); await writeJsonObject(paths.global.settings, { ...current, webhook: { ...object(current.webhook), enabled: false } }); return { data: { webhook: { enabled: false } }, message: "Webhook disabled" }; }
    if (action === "configure") {
      only(parsed, ["url", "auth", "secret", "token"], ["dispatch", "no-dispatch", "change", "no-change"]);
      const url = parsed.values.get("url"), mode = parsed.values.get("auth"); if (!url || !mode) throw new UsageError("webhook configure requires --url and --auth");
      try { const parsedUrl = new URL(url); if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") throw new Error(); } catch { throw new UsageError("Webhook URL must be HTTPS (localhost is allowed for testing)"); }
      let auth: WebhookAuth; if (mode === "hmac") { const secret = parsed.values.get("secret"); if (!secret) throw new UsageError("HMAC authentication requires --secret"); auth = { mode, secret }; }
      else if (mode === "bearer") { const token = parsed.values.get("token"); if (!token) throw new UsageError("Bearer authentication requires --token"); auth = { mode, token }; }
      else if (mode === "none") auth = { mode }; else throw new UsageError(`Invalid webhook auth mode: ${mode}`);
      const current = await optionalObject(paths.global.settings); const previous = object(current.webhook);
      const next = { ...current, webhook: { ...previous, enabled: true, url, scopes: { change: parsed.switches.has("no-change") ? false : parsed.switches.has("change") ? true : object(previous.scopes).change ?? true, dispatch: parsed.switches.has("dispatch") ? true : parsed.switches.has("no-dispatch") ? false : object(previous.scopes).dispatch ?? false }, auth } };
      await writeJsonObject(paths.global.settings, next); return { data: redactSettings(next), message: "Webhook configured" };
    }
    if (action === "test") {
      only(parsed, [], []); const settings = await optionalObject(paths.global.settings); const configured = object(settings.webhook); if (configured.enabled !== true) throw new Error("Webhook is disabled");
      const auth = configured.auth as WebhookAuth; const config: WebhookConfig = { url: String(configured.url), auth };
      const notifier = createWebhookNotifier({ config, ...(options.fetch ? { fetch: options.fetch } : {}), retryDelaysMs: [0] });
      const result = await notifier.notify({ eventId: randomUUID(), timestamp: (options.now ?? (() => new Date()))().toISOString(), scope: "change", runId: "cli-webhook-test", status: "completed", summary: "webhook test", evidenceRefs: [] }); notifier.abandon();
      if (!result.delivered) throw new Error(result.error ?? "Webhook delivery failed"); return { data: result, message: "Webhook delivered" };
    }
    throw new UsageError(`Unknown webhook command: ${action}`);
  }
  async function openspecCheck() {
    const versionResult = await options.runOpenSpec(["--version"], { cwd: options.cwd });
    if (versionResult.code !== 0) return { id: "openspec", status: "error", message: "Official OpenSpec CLI missing", action: "Install official @fission-ai/openspec 1.6.0 or newer" };
    const version = versionResult.stdout.trim(); if (!/^1\.(?:[6-9]|[1-9]\d)\.|^[2-9]\d*\./u.test(version)) return { id: "openspec", status: "error", message: `Unsupported OpenSpec ${version}`, action: "Install official OpenSpec 1.6.0 or newer" };
    const doctor = await options.runOpenSpec(["doctor", "--json"], { cwd: options.cwd }); if (doctor.code !== 0) return { id: "openspec", status: "error", message: "OpenSpec project unhealthy", action: "Run openspec doctor" };
    let root = options.cwd; try { const parsed = JSON.parse(doctor.stdout) as { root?: { path?: string; healthy?: boolean } }; if (parsed.root?.healthy !== true || !parsed.root.path) throw new Error(); root = parsed.root.path; } catch { return { id: "openspec", status: "error", message: "Invalid OpenSpec doctor response", action: "Run openspec doctor" }; }
    try { const skill = await readFile(join(root, ".pi/skills/openspec-apply-change/SKILL.md"), "utf8"); await readFile(join(root, ".pi/prompts/opsx-apply.md"), "utf8"); const generated = /generatedBy:\s*["']?([^\s"']+)/u.exec(skill)?.[1]; if (generated !== version) return { id: "openspec", status: "error", message: "OpenSpec Pi integration stale", action: "Run openspec update" }; } catch (cause) { if (absent(cause)) return { id: "openspec", status: "error", message: "OpenSpec Pi integration missing", action: "Run openspec init --tools pi" }; throw cause; }
    return { id: "openspec", status: "ok", message: `Official OpenSpec ${version} healthy` };
  }
  async function installationCheck() { const current = await currentState(topology.root, topology.current); const states = await Promise.all(topology.links.map((link) => linkState(link.path, link.target))); return current.status === "owned" && states.every((state) => state.status === "owned") ? { id: "installation", status: "ok", message: "Managed symlink topology is owned" } : { id: "installation", status: "error", message: [current, ...states].filter((state) => state.status !== "owned").map((state) => state.message ?? state.status).join("; "), action: "Install or repair Horsepower from an official release" }; }
  async function doctor(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], []); const checks: Array<Record<string, unknown>> = [];
    try { const data = await slotsData(); checks.push({ id: "configuration", status: "ok", message: `Slots revision ${data.revision}` }); } catch (cause) { checks.push({ id: "configuration", status: "error", message: (cause as Error).message, action: "Run horsepower setup" }); }
    const settings = await optionalObject(paths.global.settings); const webhookConfig = object(settings.webhook); checks.push(webhookConfig.enabled === true ? { id: "notification", status: "ok", message: `Webhook enabled (${String(object(webhookConfig.auth).mode)})` } : { id: "notification", status: "skipped", message: "Webhook disabled" });
    checks.push(await openspecCheck()); checks.push(options.models ? { id: "model-registry", status: "ok", message: "Slot models validated" } : { id: "model-registry", status: "skipped", message: "Pi model registry unavailable; validation skipped" }); checks.push(await installationCheck());
    return { data: { checks }, ok: !checks.some((check) => check.status === "error"), exitCode: checks.some((check) => check.status === "error") ? 1 : 0 };
  }
  async function preflight(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["version"], []); const staged = parsed.positionals[0], expected = parsed.values.get("version"); if (!staged || parsed.positionals.length !== 1 || !expected) throw new UsageError("preflight requires STAGED_ROOT --version VERSION");
    if (options.platform !== "linux" && options.platform !== "darwin") throw new Error(`Unsupported platform: ${options.platform}`);
    const root = resolve(staged); let manifest: JsonObject; try { manifest = await readJsonObject(join(root, "release-manifest.json")); } catch (cause) { throw new Error(`Invalid staged release: ${(cause as Error).message}`); }
    if (manifest.version !== expected) throw new Error(`Staged manifest version mismatch: expected ${expected}`); const entries = object(manifest.entryPoints);
    for (const [name, expectedPath] of Object.entries({ cli: "bin/horsepower", extension: "pi/extensions/horsepower/index.js", skill: "pi/skills/horsepower/SKILL.md" })) { if (entries[name] !== expectedPath) throw new Error(`Invalid staged ${name} entry point`); const candidate = normalize(String(entries[name])); if (candidate.startsWith("..") || isAbsolute(candidate)) throw new Error(`Unsafe staged ${name} entry point`); const info = await lstat(join(root, candidate)).catch(() => undefined); if (!info?.isFile() || info.isSymbolicLink()) throw new Error(`Missing staged ${name}: ${candidate}`); }
    const current = await currentState(topology.root, topology.current); const links = await Promise.all(topology.links.map((link) => linkState(link.path, link.target))); const conflict = [current, ...links].find((state) => state.status === "conflict"); if (conflict) throw new Error(conflict.message ?? "Installation ownership conflict");
    return { data: { eligible: true, root, version: expected }, message: "Staged release eligible" };
  }
  async function uninstall(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], []); if (parsed.positionals.length) throw new UsageError("uninstall accepts no arguments"); const root = await managedRootState(topology.root); if (root.status === "conflict") throw new Error(root.message); const current = await currentState(topology.root, topology.current); const versions = await versionsState(topology.versions); const states = await Promise.all(topology.links.map(async (link) => ({ link, state: await linkState(link.path, link.target) }))); const conflicts = [current, versions, ...states.map(({ state }) => state)].filter((state) => state.status === "conflict"); if (conflicts.length) throw new Error(conflicts.map((state) => state.message).join("; "));
    for (const { link, state } of states) if (state.status === "owned") await rm(link.path); if (current.status === "owned") await rm(topology.current); if (versions.status === "owned") await rm(topology.versions, { recursive: true }); return { data: { preserved: [paths.global.modelSlots, paths.global.settings, join(topology.root, "memory"), join(topology.root, "state"), paths.project.root] }, message: "Horsepower code uninstalled; user data preserved" };
  }
  async function purge(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], ["yes"]); if (parsed.positionals.length) throw new UsageError("purge accepts no arguments"); if (!parsed.switches.has("yes")) { if (options.interactive !== true || !options.confirm) throw new UsageError("Purge requires --yes in noninteractive mode"); if (!await options.confirm("Permanently remove Horsepower user data?")) throw new UsageError("Purge canceled"); }
    const root = await managedRootState(topology.root); if (root.status === "conflict") throw new Error(root.message); const current = await currentState(topology.root, topology.current); if (current.status !== "absent") throw new Error("Run horsepower uninstall before purge"); await rm(topology.root, { recursive: true, force: true }); await rm(paths.project.root, { recursive: true, force: true }); return { data: { purged: true }, message: "Horsepower user data purged" };
  }

  return { async run(argv: readonly string[]): Promise<CliResult> {
    let machine = argv.includes("--json");
    try {
      const command = argv[0]; if (!command || command.startsWith("--")) throw new UsageError("A command is required"); const parsed = flags(argv.slice(1)); machine = parsed.switches.has("json"); let result: CommandResult;
      if (command === "setup") result = await setup(parsed); else if (command === "configure") result = await configure(parsed); else if (command === "slots") { only(parsed, [], []); if (parsed.positionals.length) throw new UsageError("slots accepts no arguments"); result = { data: await slotsData() }; }
      else if (command === "set") result = await setSlot(parsed); else if (command === "unset") result = await unsetSlot(parsed); else if (command === "webhook") result = await webhook(parsed); else if (command === "doctor") result = await doctor(parsed); else if (command === "preflight") result = await preflight(parsed); else if (command === "uninstall") result = await uninstall(parsed); else if (command === "purge") result = await purge(parsed); else throw new UsageError(`Unknown command: ${command}`);
      const ok = result.ok ?? true; const exitCode = result.exitCode ?? (ok ? 0 : 1); return machine ? { exitCode, stdout: json({ data: result.data, ok }), stderr: "" } : { exitCode, stdout: `${result.message ?? (ok ? "OK" : "FAILED")}\n`, stderr: "" };
    } catch (cause) { const usage = cause instanceof UsageError; const exitCode = usage ? 2 : 1; const message = cause instanceof Error ? cause.message : "Unknown error"; return machine ? { exitCode, stdout: "", stderr: json({ error: { code: usage ? "USAGE" : "FAILED", message }, ok: false }) } : { exitCode, stdout: "", stderr: `horsepower: ${message}\n` }; }
  } };
}
