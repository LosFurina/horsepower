import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { readJsonObject, writeJsonObjects, type JsonObject, type JsonWrite } from "../config/json-store.js";
import { resolveHorsepowerPaths } from "../config/paths.js";
import { isCredentialKey, parseWebhookSettings, redactCredentials, validateWebhookSettingsShape, validateWebhookUrl } from "../config/webhook.js";
import { createWebhookNotifier, type WebhookAuth } from "../lifecycle/webhook-notifier.js";
import { validateOpenSpecInstallation } from "../openspec/boundary.js";
import { validateReleaseCompatibility } from "../release-manifest.js";
import { createHandoffStore } from "../handoffs/store.js";
import { message as localizedMessage, resolveOutputLocale, validateOutputLocale, type MessageId, type OutputLocale } from "../localization/index.js";
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
  writeConfigs?: (entries: readonly JsonWrite[]) => Promise<void>;
  linkOperations?: {
    create(target: string, path: string): Promise<void>;
    remove(path: string): Promise<void>;
  };
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
function mergeObjects(current: JsonObject, patch: JsonObject): JsonObject {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = Object.keys(object(current[key])).length > 0 && Object.keys(object(value)).length > 0
      ? mergeObjects(object(current[key]), object(value))
      : value;
  }
  return merged;
}
function withoutCredentialValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCredentialValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as JsonObject).flatMap(([key, nested]) =>
    isCredentialKey(key) ? [] : [[key, withoutCredentialValue(nested)]],
  ));
}
function withoutCredentials(value: JsonObject): JsonObject {
  return withoutCredentialValue(value) as JsonObject;
}
function flags(args: readonly string[]): { positionals: string[]; values: Map<string, string>; switches: Set<string> } {
  const positionals: string[] = []; const values = new Map<string, string>(); const switches = new Set<string>();
  const boolean = new Set(["json", "yes", "dispatch", "no-dispatch", "change", "no-change", "installation-only"]);
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
async function verifyConfigurationPath(trustedRoot: string, candidate: string): Promise<void> {
  const root = resolve(trustedRoot);
  const target = resolve(candidate);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) throw new Error(`Unsafe configuration path: ${target}`);
  let rootInfo;
  try { rootInfo = await lstat(root); } catch (cause) { if (absent(cause)) return; throw cause; }
  if (rootInfo.isSymbolicLink()) throw new Error(`Configuration trust root must not be a symbolic link: ${root}`);
  if (!rootInfo.isDirectory()) throw new Error(`Configuration trust root is not a directory: ${root}`);
  let current = root;
  const components = pathFromRoot.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    let info;
    try { info = await lstat(current); } catch (cause) { if (absent(cause)) return; throw cause; }
    if (info.isSymbolicLink()) throw new Error(`Configuration path must not contain a symbolic link: ${current}`);
    const final = index === components.length - 1;
    if (!final && !info.isDirectory()) throw new Error(`Configuration path component is not a directory: ${current}`);
    if (final && !info.isFile()) throw new Error(`Configuration path is not a regular file: ${current}`);
  }
}
async function trustedOptionalObject(trustedRoot: string, path: string): Promise<JsonObject> {
  await verifyConfigurationPath(trustedRoot, path);
  return optionalObject(path);
}
async function configurations(paths: ReturnType<typeof resolveHorsepowerPaths>, homeDir: string, cwd: string): Promise<{ global: SlotConfiguration; project: SlotConfiguration }> {
  return { global: await trustedOptionalObject(homeDir, paths.global.modelSlots), project: await trustedOptionalObject(cwd, paths.project.modelSlots) };
}
async function existingConfiguration(trustedRoot: string, path: string): Promise<JsonObject> {
  await verifyConfigurationPath(trustedRoot, path);
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error(`Configuration file must not be a symbolic link: ${path}`);
    if (!info.isFile()) throw new Error(`Configuration path is not a regular file: ${path}`);
    return await readJsonObject(path);
  } catch (cause) {
    if (absent(cause)) return {};
    throw cause;
  }
}
function withSlot(current: JsonObject, id: string, binding: SlotBinding | undefined): JsonObject {
  const slots = { ...object(current.slots) };
  if (binding) slots[id] = binding; else delete slots[id];
  return { ...current, slots };
}
function redactSettings(raw: JsonObject): JsonObject {
  return redactCredentials(raw) as JsonObject;
}
const releaseEntryPoints = {
  cli: "bin/horsepower",
  extension: "pi/extensions/horsepower/index.js",
  skill: "pi/skills/horsepower/SKILL.md",
} as const;

function installTopology(home: string) {
  const root = join(home, ".pi", "agent", "horsepower");
  const extension = { path: join(home, ".pi", "agent", "extensions", "horsepower"), target: join(root, "current", "pi", "extensions", "horsepower") };
  const skill = { path: join(home, ".pi", "agent", "skills", "horsepower"), target: join(root, "current", "pi", "skills", "horsepower") };
  const cli = { path: join(home, ".local", "bin", "horsepower"), target: join(root, "current", "bin", "horsepower") };
  return { root, current: join(root, "current"), versions: join(root, "versions"), extension, skill, cli, links: [extension, skill, cli] };
}
class ManagedTopologyError extends Error {}

async function verifyNoSymlinkPath(root: string, candidate: string, finalType: "directory" | "file"): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate);
  if (pathFromRoot === "" || pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === ".." || isAbsolute(pathFromRoot)) {
    throw new ManagedTopologyError(`Unsafe managed path: ${resolvedCandidate}`);
  }
  let current = resolvedRoot;
  const components = pathFromRoot.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new ManagedTopologyError(`Refusing symbolic link in managed path: ${current}`);
    const final = index === components.length - 1;
    if ((!final || finalType === "directory") && !info.isDirectory()) throw new ManagedTopologyError(`Expected managed directory: ${current}`);
    if (final && finalType === "file" && !info.isFile()) throw new ManagedTopologyError(`Expected managed regular file: ${current}`);
  }
}

async function verifyTrustedPath(trustedRoot: string, candidate: string, allowFinalSymlink = false): Promise<void> {
  const root = resolve(trustedRoot);
  const target = resolve(candidate);
  const pathFromRoot = relative(root, target);
  if (pathFromRoot === "" || pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    throw new Error(`Unsafe destructive path: ${target}`);
  }
  try {
    const rootInfo = await lstat(root);
    if (rootInfo.isSymbolicLink()) throw new Error(`Refusing symbolic link trust root: ${root}`);
    if (!rootInfo.isDirectory()) throw new Error(`Refusing non-directory trust root: ${root}`);
  } catch (cause) {
    if (absent(cause)) return;
    throw cause;
  }
  let current = root;
  const components = pathFromRoot.split(sep);
  for (let index = 0; index < components.length; index += 1) {
    current = join(current, components[index]!);
    let info;
    try { info = await lstat(current); } catch (cause) { if (absent(cause)) return; throw cause; }
    if (info.isSymbolicLink() && !(allowFinalSymlink && index === components.length - 1)) throw new Error(`Refusing symbolic link in destructive path: ${current}`);
  }
}

async function readManagedManifest(release: string): Promise<JsonObject> {
  try {
    const manifestPath = join(release, "release-manifest.json");
    await verifyNoSymlinkPath(dirname(release), release, "directory");
    await verifyNoSymlinkPath(release, manifestPath, "file");
    const manifest = await readJsonObject(manifestPath);
    if (Object.keys(manifest).sort().join(",") !== "compatibility,digests,entryPoints,version") throw new ManagedTopologyError("Invalid release manifest fields");
    if (typeof manifest.version !== "string" || !releaseVersion.test(manifest.version)) throw new ManagedTopologyError("Invalid release manifest version");
    try { validateReleaseCompatibility(manifest.compatibility); }
    catch (cause) { throw new ManagedTopologyError((cause as Error).message); }
    const entries = object(manifest.entryPoints);
    const digests = object(manifest.digests);
    if (Object.keys(entries).sort().join(",") !== "cli,extension,skill") throw new ManagedTopologyError("Invalid release manifest entry point fields");
    if (Object.keys(digests).sort().join(",") !== Object.values(releaseEntryPoints).sort().join(",")) throw new ManagedTopologyError("Invalid release manifest digest fields");
    for (const [name, expectedPath] of Object.entries(releaseEntryPoints)) {
      if (entries[name] !== expectedPath) throw new ManagedTopologyError(`Invalid release manifest ${name} entry point`);
      const digest = digests[expectedPath];
      if (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)) throw new ManagedTopologyError(`Invalid release manifest digest: ${expectedPath}`);
      await verifyNoSymlinkPath(release, join(release, expectedPath), "file");
      const actual = createHash("sha256").update(await readFile(join(release, expectedPath))).digest("hex");
      if (actual !== digest) throw new ManagedTopologyError(`Release manifest digest mismatch: ${expectedPath}`);
    }
    return manifest;
  } catch (cause) {
    if (cause instanceof ManagedTopologyError) throw cause;
    if (absent(cause) || (cause instanceof Error && cause.message.startsWith("Malformed JSON"))) {
      throw new ManagedTopologyError((cause as Error).message);
    }
    throw cause;
  }
}

async function requireAbsent(path: string, message: string): Promise<void> {
  try { await lstat(path); throw new ManagedTopologyError(message); }
  catch (cause) { if (!absent(cause)) throw cause; }
}

async function verifyInstallDestination(home: string, root: string, versions: string, destination: string): Promise<void> {
  await verifyTrustedPath(home, root);
  let rootInfo;
  try { rootInfo = await lstat(root); } catch (cause) { if (absent(cause)) return; throw cause; }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new ManagedTopologyError(`Refusing unowned Horsepower root: ${root}`);
  const versionsOwnership = await versionsState(versions);
  if (versionsOwnership.status === "conflict") throw new ManagedTopologyError(versionsOwnership.message ?? `Refusing unowned versions path: ${versions}`);
  await requireAbsent(destination, `Release destination already exists: ${destination}`);
}

async function managedRootState(root: string): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  try { const info = await lstat(root); return info.isDirectory() && !info.isSymbolicLink() ? { status: "owned" } : { status: "conflict", message: `Refusing unowned Horsepower root: ${root}` }; }
  catch (cause) { if (absent(cause)) return { status: "absent" }; throw cause; }
}
async function purgeRootState(root: string, topology: Readonly<Record<string, "file" | "directory">>): Promise<{ status: "absent" | "owned" | "conflict"; message?: string }> {
  const state = await managedRootState(root);
  if (state.status !== "owned") return state;
  for (const name of await readdir(root)) {
    const expected = topology[name];
    const path = join(root, name);
    if (!expected) return { status: "conflict", message: `Refusing unexpected object in Horsepower user-data root: ${path}` };
    const info = await lstat(path);
    if (info.isSymbolicLink() || (expected === "file" ? !info.isFile() : !info.isDirectory())) return { status: "conflict", message: `Refusing unexpected Horsepower user-data object: ${path}` };
  }
  return { status: "owned" };
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
    if (cause instanceof ManagedTopologyError) {
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
  const writeConfigs = options.writeConfigs ?? writeJsonObjects;
  const linkOperations = options.linkOperations ?? { create: (target: string, path: string) => symlink(target, path), remove: (path: string) => rm(path) };
  const handoffs = createHandoffStore({ stateRoot: join(paths.global.root, "state") });

  function registryData(config: { global: SlotConfiguration; project: SlotConfiguration }) {
    const registry = createSlotRegistry({ ...config, ...(options.models ? { models: options.models } : {}) });
    const resolved = Object.fromEntries(Object.keys(registry.effective).sort().map((id) => [id, registry.resolve(id)]));
    return { effective: registry.effective, resolved, revision: registry.revision };
  }
  async function slotsData() {
    return registryData(await configurations(paths, options.homeDir, options.cwd));
  }
  function requireSupportedPlatform(): void {
    if (options.platform !== "linux" && options.platform !== "darwin") throw new Error(`Unsupported platform: ${options.platform}`);
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
    try {
      const [globalSlots, projectSlots, settings, projectSettings] = await Promise.all([
        existingConfiguration(options.homeDir, paths.global.modelSlots),
        existingConfiguration(options.cwd, paths.project.modelSlots),
        existingConfiguration(options.homeDir, paths.global.settings),
        existingConfiguration(options.cwd, paths.project.settings),
      ]);
      const nextGlobal = { ...globalSlots, slots: { ...object(globalSlots.slots), ...slots } };
      const data = registryData({ global: nextGlobal as SlotConfiguration, project: projectSlots });
      parseWebhookSettings(settings.webhook, projectSettings.webhook);
      await writeConfigs([
        { path: paths.global.modelSlots, value: nextGlobal },
        { path: paths.global.settings, value: settings },
      ]);
      return { data, message: "Horsepower configured" };
    } catch (cause) { throw new UsageError((cause as Error).message); }
  }
  async function setSlot(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["model", "thinking", "fallback", "scope"], []); const id = parsed.positionals[0];
    if (!id || parsed.positionals.length !== 1) throw new UsageError("set requires one slot ID");
    let binding: SlotBinding;
    if (parsed.values.has("fallback")) { if (parsed.values.has("model") || parsed.values.has("thinking")) throw new UsageError("Choose --fallback or --model/--thinking"); binding = { fallback: parsed.values.get("fallback")! }; }
    else { const model = parsed.values.get("model"), thinking = parsed.values.get("thinking"); if (!model || !thinking) throw new UsageError("set requires --model and --thinking"); binding = { model, thinking: thinking as ThinkingLevel }; }
    if (!slotId.test(id)) throw new UsageError(`Invalid model slot ID: ${id}`);
    const scope = parsed.values.get("scope");
    const path = scopePath(scope, paths);
    try {
      const config = await configurations(paths, options.homeDir, options.cwd);
      const next = withSlot(scope === "project" ? config.project as JsonObject : config.global as JsonObject, id, binding);
      const prospective = scope === "project" ? { global: config.global, project: next } : { global: next, project: config.project };
      const data = registryData(prospective);
      await writeConfigs([{ path, value: next }]);
      return { data, message: `Set ${id}` };
    } catch (cause) { throw new UsageError((cause as Error).message); }
  }
  async function unsetSlot(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["scope"], []); const id = parsed.positionals[0]; if (!id || parsed.positionals.length !== 1) throw new UsageError("unset requires one slot ID");
    if (!slotId.test(id)) throw new UsageError(`Invalid model slot ID: ${id}`);
    const scope = parsed.values.get("scope");
    const path = scopePath(scope, paths);
    try {
      const config = await configurations(paths, options.homeDir, options.cwd);
      const next = withSlot(scope === "project" ? config.project as JsonObject : config.global as JsonObject, id, undefined);
      const prospective = scope === "project" ? { global: config.global, project: next } : { global: next, project: config.project };
      const data = registryData(prospective);
      await writeConfigs([{ path, value: next }]);
      return { data, message: `Unset ${id}` };
    } catch (cause) { throw new UsageError((cause as Error).message); }
  }
  async function configure(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    const values = ["judgment", "judgment-thinking", "craft", "craft-thinking", "utility", "utility-thinking", "locale", "scope"];
    only(parsed, values, []); if (parsed.positionals.length) throw new UsageError("configure accepts no positional arguments");
    if (parsed.values.has("locale")) {
      let locale: OutputLocale;
      try { locale = validateOutputLocale(parsed.values.get("locale")); } catch { throw new UsageError(`OUTPUT_LOCALE_INVALID: ${parsed.values.get("locale")}`); }
      const scope = parsed.values.get("scope") ?? "global";
      if (scope !== "global" && scope !== "project") throw new UsageError(`Invalid scope: ${scope}`);
      if (parsed.values.size !== (parsed.values.has("scope") ? 2 : 1)) throw new UsageError("--locale cannot be combined with slot configuration");
      const trustedRoot = scope === "project" ? options.cwd : options.homeDir;
      const path = scope === "project" ? paths.project.settings : paths.global.settings;
      const current = await trustedOptionalObject(trustedRoot, path);
      const next = { ...current, outputLocale: locale };
      await writeConfigs([{ path, value: next }]);
      return { data: redactSettings(next), message: localizedMessage(locale, "cli.localeConfigured", { locale }) };
    }
    if (parsed.values.has("scope")) throw new UsageError("--scope requires --locale");
    if (parsed.values.size === 0) return { data: redactSettings(await trustedOptionalObject(options.homeDir, paths.global.settings)) };
    const current = await trustedOptionalObject(options.homeDir, paths.global.modelSlots); const slots = { ...object(current.slots) } as Record<string, unknown>;
    for (const id of ["judgment", "craft", "utility"] as const) {
      const model = parsed.values.get(id), thinking = parsed.values.get(`${id}-thinking`);
      if ((model && !thinking) || (!model && thinking)) throw new UsageError(`configure requires --${id} and --${id}-thinking together`);
      if (model && thinking) slots[id] = { model, thinking };
    }
    try {
      const project = await trustedOptionalObject(options.cwd, paths.project.modelSlots);
      const next = { ...current, slots };
      const data = registryData({ global: next as SlotConfiguration, project });
      await writeConfigs([{ path: paths.global.modelSlots, value: next }]);
      return { data, message: "Horsepower configuration updated" };
    } catch (cause) { throw new UsageError((cause as Error).message); }
  }
  async function webhook(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    const action = parsed.positionals[0]; if (!action || parsed.positionals.length !== 1) throw new UsageError("webhook requires configure, skip, disable, or test");
    if (action === "disable" || action === "skip") {
      only(parsed, [], []);
      const globalSettings = await trustedOptionalObject(options.homeDir, paths.global.settings);
      const projectSettings = await trustedOptionalObject(options.cwd, paths.project.settings);
      const scope = Object.hasOwn(projectSettings, "webhook") ? "project" : "global";
      const current = scope === "project" ? projectSettings : globalSettings;
      const preserved = withoutCredentials(object(current.webhook));
      delete preserved.url;
      delete preserved.auth;
      delete preserved.notifications;
      const next = { ...current, webhook: { ...preserved, enabled: false } };
      const prospectiveGlobal = scope === "global" ? next : globalSettings;
      const prospectiveProject = scope === "project" ? next : projectSettings;
      try {
        if (parseWebhookSettings(prospectiveGlobal.webhook, prospectiveProject.webhook) !== undefined) {
          throw new Error("disabled webhook remains enabled in the effective settings");
        }
      } catch (cause) { throw new UsageError((cause as Error).message); }
      await writeConfigs([{ path: scope === "project" ? paths.project.settings : paths.global.settings, value: next }]);
      return { data: redactSettings(next), message: `Webhook disabled (${scope})` };
    }
    if (action === "configure") {
      only(parsed, ["url", "auth", "secret", "token"], ["dispatch", "no-dispatch", "change", "no-change"]);
      if (parsed.switches.has("change") && parsed.switches.has("no-change")) throw new UsageError("Choose --change or --no-change");
      if (parsed.switches.has("dispatch") && parsed.switches.has("no-dispatch")) throw new UsageError("Choose --dispatch or --no-dispatch");
      const url = parsed.values.get("url"), mode = parsed.values.get("auth"); if (!url || !mode) throw new UsageError("webhook configure requires --url and --auth");
      try { validateWebhookUrl(url); }
      catch (cause) { throw new UsageError((cause as Error).message); }
      const secret = parsed.values.get("secret"), token = parsed.values.get("token");
      let auth: WebhookAuth; if (mode === "hmac") { if (!secret) throw new UsageError("HMAC authentication requires --secret"); if (token) throw new UsageError("HMAC authentication does not accept --token"); auth = { mode, secret }; }
      else if (mode === "bearer") { if (!token) throw new UsageError("Bearer authentication requires --token"); if (secret) throw new UsageError("Bearer authentication does not accept --secret"); auth = { mode, token }; }
      else if (mode === "none") { if (secret || token) throw new UsageError("None authentication does not accept --secret or --token"); auth = { mode }; } else throw new UsageError("Invalid webhook auth mode");
      const globalSettings = await trustedOptionalObject(options.homeDir, paths.global.settings); const projectSettings = await trustedOptionalObject(options.cwd, paths.project.settings);
      try {
        validateWebhookSettingsShape(globalSettings.webhook);
        validateWebhookSettingsShape(projectSettings.webhook, "project ");
      } catch (cause) { throw new UsageError((cause as Error).message); }
      const scope = Object.keys(object(projectSettings.webhook)).length > 0 ? "project" : "global";
      const current = scope === "project" ? projectSettings : globalSettings;
      const previous = object(current.webhook);
      const preserved = withoutCredentials(previous);
      const previousAuth = withoutCredentials(object(previous.auth));
      const effectiveBefore = (() => {
        try { return parseWebhookSettings(globalSettings.webhook, projectSettings.webhook); }
        catch { return undefined; }
      })();
      const previousNotifications = object(previous.notifications);
      const requestedNotifications = {
        change: parsed.switches.has("no-change") ? false : parsed.switches.has("change") ? true : previousNotifications.change ?? effectiveBefore?.notifications.change ?? true,
        dispatch: parsed.switches.has("dispatch") ? true : parsed.switches.has("no-dispatch") ? false : previousNotifications.dispatch ?? effectiveBefore?.notifications.dispatch ?? false,
      };
      const nextWebhook = mergeObjects(preserved, {
        enabled: true,
        url,
        notifications: requestedNotifications,
      });
      nextWebhook.auth = { ...previousAuth, ...auth };
      const next = { ...current, webhook: nextWebhook };
      const prospectiveGlobal = scope === "global" ? next : globalSettings;
      const prospectiveProject = scope === "project" ? next : projectSettings;
      try {
        const effective = parseWebhookSettings(prospectiveGlobal.webhook, prospectiveProject.webhook);
        if (!effective || effective.config.url !== url || JSON.stringify(effective.config.auth) !== JSON.stringify(auth)
          || effective.notifications.change !== requestedNotifications.change
          || effective.notifications.dispatch !== requestedNotifications.dispatch) {
          throw new Error("configured webhook does not match the effective settings");
        }
      } catch (cause) { throw new UsageError((cause as Error).message); }
      await writeConfigs([{ path: scope === "project" ? paths.project.settings : paths.global.settings, value: next }]);
      return { data: redactSettings(next), message: `Webhook configured (${scope})` };
    }
    if (action === "test") {
      only(parsed, [], []); const globalSettings = await trustedOptionalObject(options.homeDir, paths.global.settings); const projectSettings = await trustedOptionalObject(options.cwd, paths.project.settings); const parsedSettings = parseWebhookSettings(globalSettings.webhook, projectSettings.webhook); if (!parsedSettings) throw new Error("Webhook is disabled");
      const notifier = createWebhookNotifier({ config: parsedSettings.config, ...(options.fetch ? { fetch: options.fetch } : {}), retryDelaysMs: [0] });
      const result = await notifier.notify({ eventId: randomUUID(), timestamp: (options.now ?? (() => new Date()))().toISOString(), scope: "change", runId: "cli-webhook-test", status: "completed", summary: "webhook test", evidenceRefs: [] }); notifier.abandon();
      if (!result.delivered) throw new Error(result.error ?? "Webhook delivery failed"); return { data: result, message: "Webhook delivered" };
    }
    throw new UsageError(`Unknown webhook command: ${action}`);
  }
  async function openspecCheck(outputLocale: OutputLocale) {
    try {
      const result = await validateOpenSpecInstallation({ run: options.runOpenSpec, readText: (path) => readFile(path, "utf8") }, options.cwd);
      return { id: "openspec", status: "ok", message: localizedMessage(outputLocale, "doctor.openspecHealthy"), rawEvidence: `Official OpenSpec ${result.version} healthy` };
    } catch (cause) {
      const rawEvidence = (cause as Error).message;
      const actionId: MessageId = rawEvidence.includes("init --tools pi") ? "doctor.openspecInitAction"
        : rawEvidence.includes("openspec update") ? "doctor.openspecUpdateAction"
          : rawEvidence.includes("not healthy") ? "doctor.openspecDoctorAction"
            : "doctor.openspecInstallAction";
      return { id: "openspec", status: "error", message: localizedMessage(outputLocale, "doctor.openspecInvalid"), action: localizedMessage(outputLocale, actionId), rawEvidence };
    }
  }
  async function installationCheck(outputLocale: OutputLocale) {
    try {
      await verifyTrustedPath(options.homeDir, topology.root);
      for (const link of topology.links) await verifyTrustedPath(options.homeDir, link.path, true);
      const current = await currentState(topology.root, topology.current);
      const versions = await versionsState(topology.versions);
      const [extension, skill, cli] = await Promise.all([
        linkState(topology.extension.path, topology.extension.target),
        linkState(topology.skill.path, topology.skill.target),
        linkState(topology.cli.path, topology.cli.target),
      ]);
      const coreFailure = [current, versions, cli].find((state) => state.status !== "owned");
      if (coreFailure) return { id: "installation", status: "error", integrationStatus: "conflict", message: localizedMessage(outputLocale, "doctor.installationInvalid"), action: localizedMessage(outputLocale, "doctor.installationRepairAction"), rawEvidence: coreFailure.message ?? coreFailure.status };
      const integrationStatus = extension.status === "owned" && skill.status === "owned" ? "enabled"
        : extension.status === "absent" && skill.status === "absent" ? "disabled"
          : extension.status === "conflict" || skill.status === "conflict" ? "conflict" : "partially_enabled";
      if (integrationStatus === "enabled") return { id: "installation", status: "ok", integrationStatus, message: localizedMessage(outputLocale, "doctor.integrationEnabled") };
      if (integrationStatus === "disabled") return { id: "installation", status: "ok", integrationStatus, message: localizedMessage(outputLocale, "doctor.integrationDisabled"), action: localizedMessage(outputLocale, "doctor.enableAction") };
      const evidence = (role: "extension" | "skill", state: typeof extension) => `${role}=${state.status}${state.message ? ` (${state.message})` : ""}`;
      const rawEvidence = [evidence("extension", extension), evidence("skill", skill)].join("; ");
      return { id: "installation", status: "error", integrationStatus, message: localizedMessage(outputLocale, integrationStatus === "conflict" ? "doctor.integrationConflict" : "doctor.integrationPartial"), action: localizedMessage(outputLocale, integrationStatus === "conflict" ? "doctor.integrationRepairAction" : "doctor.integrationPartialAction"), rawEvidence };
    } catch (cause) {
      const rawEvidence = cause instanceof Error ? cause.message : "Unable to inspect the managed installation topology";
      return { id: "installation", status: "error", message: localizedMessage(outputLocale, "doctor.installationInvalid"), action: localizedMessage(outputLocale, "doctor.installationRepairAction"), rawEvidence };
    }
  }
  async function doctorSettings(trustedRoot: string, path: string): Promise<{ value?: JsonObject; error?: string }> {
    try { return { value: await trustedOptionalObject(trustedRoot, path) }; }
    catch (cause) {
      const message = cause instanceof Error && (cause.message.startsWith("Malformed JSON in ") || cause.message.startsWith("Expected a JSON object in "))
        ? cause.message
        : `Unable to read settings at ${path}`;
      return { error: message };
    }
  }
  async function doctor(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], ["installation-only"]);
    let outputLocale: OutputLocale = "en";
    try { outputLocale = await resolveOutputLocale(paths.global.settings, paths.project.settings); } catch { /* invalid settings are reported below */ }
    if (parsed.switches.has("installation-only")) {
      const check = await installationCheck(outputLocale);
      return { data: { checks: [check] }, ok: check.status !== "error", exitCode: check.status === "error" ? 1 : 0 };
    }
    const checks: Array<Record<string, unknown>> = [];
    let configurationValid = false;
    try {
      const data = await slotsData(); configurationValid = true;
      checks.push({ id: "configuration", status: "ok", message: localizedMessage(outputLocale, "doctor.configurationValid"), rawEvidence: `Slots revision ${data.revision}` });
    } catch (cause) {
      checks.push({ id: "configuration", status: "error", message: localizedMessage(outputLocale, "doctor.configurationInvalid"), action: localizedMessage(outputLocale, "doctor.setupAction"), rawEvidence: (cause as Error).message });
    }
    const globalSettings = await doctorSettings(options.homeDir, paths.global.settings);
    const projectSettings = await doctorSettings(options.cwd, paths.project.settings);
    const settingsErrors = [globalSettings.error, projectSettings.error].filter((message): message is string => message !== undefined);
    if (settingsErrors.length > 0) {
      const invalidPaths = [globalSettings.error ? paths.global.settings : undefined, projectSettings.error ? paths.project.settings : undefined].filter((path): path is string => path !== undefined);
      checks.push({ id: "notification", status: "error", message: localizedMessage(outputLocale, "doctor.settingsInvalid"), action: localizedMessage(outputLocale, "doctor.settingsRepairAction"), rawEvidence: `${settingsErrors.join("; ")}; ${invalidPaths.join(", ")}` });
    } else {
      try {
        const configured = parseWebhookSettings(globalSettings.value!.webhook, projectSettings.value!.webhook);
        checks.push(configured
          ? { id: "notification", status: "ok", message: localizedMessage(outputLocale, "doctor.webhookEnabled", { mode: configured.config.auth.mode }) }
          : { id: "notification", status: "skipped", message: localizedMessage(outputLocale, "doctor.webhookDisabled") });
      } catch (cause) {
        checks.push({ id: "notification", status: "error", message: localizedMessage(outputLocale, "doctor.webhookInvalid"), action: localizedMessage(outputLocale, "doctor.webhookRepairAction"), rawEvidence: (cause as Error).message });
      }
    }
    checks.push(await openspecCheck(outputLocale));
    checks.push(!configurationValid
      ? { id: "model-registry", status: "skipped", message: localizedMessage(outputLocale, "doctor.modelNeedsConfiguration"), action: localizedMessage(outputLocale, "doctor.setupAction") }
      : options.models
        ? { id: "model-registry", status: "ok", message: localizedMessage(outputLocale, "doctor.modelValidated") }
        : { id: "model-registry", status: "skipped", message: localizedMessage(outputLocale, "doctor.modelUnavailable") });
    checks.push(await installationCheck(outputLocale));
    return { data: { checks }, ok: !checks.some((check) => check.status === "error"), exitCode: checks.some((check) => check.status === "error") ? 1 : 0 };
  }
  async function preflight(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, ["version"], []); const staged = parsed.positionals[0], expected = parsed.values.get("version"); if (!staged || parsed.positionals.length !== 1 || !expected) throw new UsageError("preflight requires STAGED_ROOT --version VERSION");
    requireSupportedPlatform();
    if (!releaseVersion.test(expected)) throw new UsageError(`Invalid release version: ${expected}`);
    const root = resolve(staged); const stagedInfo = await lstat(root).catch(() => undefined); if (!stagedInfo?.isDirectory() || stagedInfo.isSymbolicLink()) throw new Error(`Invalid staged release root: ${root}`); let manifest: JsonObject; try { manifest = await readManagedManifest(root); } catch (cause) { throw new Error(`Invalid staged release: ${(cause as Error).message}`); }
    if (typeof manifest.version !== "string" || !releaseVersion.test(manifest.version)) throw new Error("Invalid staged manifest version");
    if (manifest.version !== expected) throw new Error(`Staged manifest version mismatch: expected ${expected}`); const entries = object(manifest.entryPoints);
    for (const [name, expectedPath] of Object.entries(releaseEntryPoints)) { if (entries[name] !== expectedPath) throw new Error(`Invalid staged ${name} entry point`); const candidate = normalize(String(entries[name])); if (candidate.startsWith("..") || isAbsolute(candidate)) throw new Error(`Unsafe staged ${name} entry point`); try { await verifyNoSymlinkPath(root, join(root, candidate), "file"); } catch { throw new Error(`Missing staged ${name}: ${candidate}`); } }
    await verifyInstallDestination(options.homeDir, topology.root, topology.versions, join(topology.versions, `v${expected}`));
    for (const link of topology.links) await verifyTrustedPath(options.homeDir, link.path, true);
    const managedRoot = await managedRootState(topology.root); if (managedRoot.status === "conflict") throw new Error(managedRoot.message ?? "Installation ownership conflict");
    const current = await currentState(topology.root, topology.current); const links = await Promise.all(topology.links.map((link) => linkState(link.path, link.target))); const conflict = [current, ...links].find((state) => state.status === "conflict"); if (conflict) throw new Error(conflict.message ?? "Installation ownership conflict");
    return { data: { eligible: true, root, version: expected }, message: "Staged release eligible" };
  }
  type IntegrationLink = { link: (typeof topology.links)[number]; state: Awaited<ReturnType<typeof linkState>> };
  async function preflightIntegrationLinks(): Promise<IntegrationLink[]> {
    await verifyTrustedPath(options.homeDir, topology.root);
    const root = await managedRootState(topology.root);
    if (root.status === "conflict") throw new Error(root.message);
    const current = await currentState(topology.root, topology.current);
    if (current.status !== "owned") throw new Error(current.message ?? "No valid active Horsepower release");
    await verifyTrustedPath(options.homeDir, topology.cli.path, true);
    const cliState = await linkState(topology.cli.path, topology.cli.target);
    if (cliState.status !== "owned") throw new Error(cliState.message ?? `Horsepower CLI link is not owned: ${topology.cli.path}`);
    const integration = [topology.extension, topology.skill];
    for (const link of integration) await verifyTrustedPath(options.homeDir, link.path, true);
    const states = await Promise.all(integration.map(async (link) => ({ link, state: await linkState(link.path, link.target) })));
    const conflict = states.find(({ state }) => state.status === "conflict");
    if (conflict) throw new Error(conflict.state.message ?? `Horsepower integration link conflicts: ${conflict.link.path}`);
    return states;
  }
  async function reconcileIntegrationLinks(before: readonly IntegrationLink[], operationFailure: unknown): Promise<never> {
    const failures: Error[] = [operationFailure instanceof Error ? operationFailure : new Error(String(operationFailure))];
    for (const item of before) {
      try {
        const actual = await linkState(item.link.path, item.link.target);
        if (item.state.status === "absent" && actual.status === "owned") await linkOperations.remove(item.link.path);
        if (item.state.status === "owned" && actual.status === "absent") await linkOperations.create(item.link.target, item.link.path);
      } catch (cause) {
        failures.push(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
    let restored = true;
    for (const item of before) {
      try {
        const actual = await linkState(item.link.path, item.link.target);
        if (actual.status !== item.state.status) {
          restored = false;
          failures.push(new Error(`Rollback did not restore ${item.link.path}: expected ${item.state.status}, got ${actual.status}`));
        }
      } catch (cause) {
        restored = false;
        failures.push(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
    if (failures.length === 1) throw failures[0]!;
    const outcome = restored ? "rollback restored the original state" : "rollback was incomplete";
    throw new AggregateError(failures, `Integration operation failed; ${outcome}: ${failures.map(({ message }) => message).join("; ")}`);
  }
  async function enable(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], []); if (parsed.positionals.length) throw new UsageError("enable accepts no arguments");
    const states = await preflightIntegrationLinks();
    try {
      for (const item of states) if (item.state.status === "absent") {
        await mkdir(dirname(item.link.path), { recursive: true });
        await linkOperations.create(item.link.target, item.link.path);
      }
    } catch (cause) {
      return reconcileIntegrationLinks(states, cause);
    }
    return { data: { integrationStatus: "enabled", reloadRequired: true }, message: "Horsepower enabled; run /reload or restart Pi" };
  }
  async function disable(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], []); if (parsed.positionals.length) throw new UsageError("disable accepts no arguments");
    const states = await preflightIntegrationLinks();
    try {
      for (const item of states) if (item.state.status === "owned") await linkOperations.remove(item.link.path);
    } catch (cause) {
      return reconcileIntegrationLinks(states, cause);
    }
    return { data: { integrationStatus: "disabled", reloadRequired: true }, message: "Horsepower disabled; run /reload or restart Pi" };
  }
  async function uninstall(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], []); if (parsed.positionals.length) throw new UsageError("uninstall accepts no arguments"); await verifyTrustedPath(options.homeDir, topology.root); for (const link of topology.links) await verifyTrustedPath(options.homeDir, link.path, true); const root = await managedRootState(topology.root); if (root.status === "conflict") throw new Error(root.message); const current = await currentState(topology.root, topology.current); const versions = await versionsState(topology.versions); const states = await Promise.all(topology.links.map(async (link) => ({ link, state: await linkState(link.path, link.target) }))); const conflicts = [current, versions, ...states.map(({ state }) => state)].filter((state) => state.status === "conflict"); if (conflicts.length) throw new Error(conflicts.map((state) => state.message).join("; "));
    for (const { link, state } of states) if (state.status === "owned") await rm(link.path); if (current.status === "owned") await rm(topology.current); if (versions.status === "owned") await rm(topology.versions, { recursive: true }); return { data: { preserved: [paths.global.modelSlots, paths.global.settings, join(topology.root, "memory"), join(topology.root, "state"), paths.project.root] }, message: "Horsepower code uninstalled; user data preserved" };
  }
  async function handoff(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], []);
    const action = parsed.positionals[0];
    if (action === "list" && parsed.positionals.length === 1) return { data: await handoffs.list({ projectPath: options.cwd }), message: "Handoffs listed" };
    if (action === "inspect" && parsed.positionals.length === 2) return { data: await handoffs.inspect({ projectPath: options.cwd, runId: parsed.positionals[1]! }), message: "Handoff inspected" };
    if (action === "clean" && parsed.positionals.length === 2) return { data: await handoffs.clean({ projectPath: options.cwd, runId: parsed.positionals[1]! }), message: "Handoff cleaned" };
    if (action === "clean-terminal" && parsed.positionals.length === 1) return { data: await handoffs.cleanTerminal({ projectPath: options.cwd }), message: "Terminal handoffs cleaned" };
    throw new UsageError("handoff requires list, inspect RUN_ID, clean RUN_ID, or clean-terminal");
  }
  async function purge(parsed: ReturnType<typeof flags>): Promise<CommandResult> {
    only(parsed, [], ["yes"]); if (parsed.positionals.length) throw new UsageError("purge accepts no arguments"); if (!parsed.switches.has("yes")) { if (options.interactive !== true || !options.confirm) throw new UsageError("Purge requires --yes in noninteractive mode"); const confirmed = await options.confirm("Permanently remove Horsepower user data? Type yes to continue: "); if (confirmed === undefined) throw new UsageError("Purge requires --yes when no controlling terminal is available"); if (!confirmed) return { data: { purged: false }, message: "Purge canceled; no data changed" }; }
    await verifyTrustedPath(options.homeDir, topology.root); await verifyTrustedPath(options.cwd, paths.project.root); for (const link of topology.links) await verifyTrustedPath(options.homeDir, link.path, true); const codePaths = [topology.current, topology.versions, ...topology.links.map((link) => link.path)]; for (const path of codePaths) await requireAbsent(path, `Run horsepower uninstall before purge; installed code or link remains: ${path}`); const root = await purgeRootState(topology.root, { "model-slots.json": "file", "settings.json": "file", agents: "directory", standards: "directory", workflows: "directory", personas: "directory", memory: "directory", state: "directory" }); const projectRoot = await purgeRootState(paths.project.root, { "model-slots.json": "file", "settings.json": "file", agents: "directory" }); for (const state of [root, projectRoot]) if (state.status === "conflict") throw new Error(state.message); await rm(topology.root, { recursive: true, force: true }); await rm(paths.project.root, { recursive: true, force: true }); return { data: { purged: true }, message: "Horsepower user data purged" };
  }

  type ParsedFlags = ReturnType<typeof flags>;
  type CommandDefinition = {
    run(parsed: ParsedFlags): Promise<CommandResult>;
    requiresPlatform?: boolean | ((parsed: ParsedFlags) => boolean);
    summaryId: MessageId | ((parsed: ParsedFlags) => MessageId);
    summaryVariables?: (parsed: ParsedFlags) => Readonly<Record<string, string | number>>;
  };
  const completed = "cli.commandCompleted" as const;
  const commands = {
    setup: { run: setup, requiresPlatform: true, summaryId: completed },
    configure: {
      run: configure,
      requiresPlatform: (parsed) => parsed.values.size > 0,
      summaryId: (parsed) => parsed.values.has("locale") ? "cli.localeConfigured" : "cli.configured",
      summaryVariables: (parsed) => ({ locale: parsed.values.get("locale") ?? "" }),
    },
    slots: { run: async (parsed) => { only(parsed, [], []); if (parsed.positionals.length) throw new UsageError("slots accepts no arguments"); return { data: await slotsData() }; }, summaryId: completed },
    set: { run: setSlot, requiresPlatform: true, summaryId: completed },
    unset: { run: unsetSlot, requiresPlatform: true, summaryId: completed },
    webhook: { run: webhook, requiresPlatform: true, summaryId: completed },
    handoff: { run: handoff, summaryId: completed },
    doctor: { run: doctor, summaryId: "doctor.healthy" },
    preflight: { run: preflight, requiresPlatform: true, summaryId: completed },
    enable: { run: enable, requiresPlatform: true, summaryId: "cli.enabled" },
    disable: { run: disable, requiresPlatform: true, summaryId: "cli.disabled" },
    uninstall: { run: uninstall, requiresPlatform: true, summaryId: completed },
    purge: { run: purge, requiresPlatform: true, summaryId: completed },
  } satisfies Record<string, CommandDefinition>;

  return { async run(argv: readonly string[]): Promise<CliResult> {
    let machine = argv.includes("--json");
    const commandName = argv.find((argument) => !argument.startsWith("--")) ?? "horsepower";
    let locale: OutputLocale = "en";
    try { locale = await resolveOutputLocale(paths.global.settings, paths.project.settings); } catch { /* invalid settings remain observable by commands */ }
    try {
      const jsonCount = argv.filter((argument) => argument === "--json").length;
      if (jsonCount > 1) throw new UsageError("Duplicate option: --json");
      const normalizedArgv = argv.filter((argument) => argument !== "--json");
      const command = normalizedArgv[0]; if (!command || command.startsWith("--")) throw new UsageError("A command is required"); const parsed = flags([...normalizedArgv.slice(1), ...(machine ? ["--json"] : [])]); machine = parsed.switches.has("json");
      const definition = commands[command as keyof typeof commands] as CommandDefinition | undefined;
      if (!definition) throw new UsageError(`Unknown command: ${command}`);
      const requiresPlatform = typeof definition.requiresPlatform === "function" ? definition.requiresPlatform(parsed) : definition.requiresPlatform === true;
      if (requiresPlatform) requireSupportedPlatform();
      const result = await definition.run(parsed);
      try { locale = await resolveOutputLocale(paths.global.settings, paths.project.settings); } catch { /* doctor and diagnostics retain their structured evidence */ }
      const ok = result.ok ?? true; const exitCode = result.exitCode ?? (ok ? 0 : 1);
      const summaryId = typeof definition.summaryId === "function" ? definition.summaryId(parsed) : definition.summaryId;
      const summary = localizedMessage(locale, summaryId, { command: commandName, ...definition.summaryVariables?.(parsed) });
      return machine ? { exitCode, stdout: json({ data: result.data, ok, outputLocale: locale, summary }), stderr: "" } : { exitCode, stdout: `${summary}\n`, stderr: "" };
    } catch (cause) { const usage = cause instanceof UsageError; const exitCode = usage ? 2 : 1; const rawMessage = cause instanceof Error ? cause.message : "Unknown error"; const human = rawMessage.startsWith("OUTPUT_LOCALE_INVALID") ? localizedMessage(locale, "error.localeInvalid", { locale: rawMessage.split(": ")[1] ?? "unknown" }) : locale === "zh-CN" ? localizedMessage(locale, "cli.commandFailed", { command: commandName }) : rawMessage; const message = String(redactCredentials(human)); const rawEvidence = String(redactCredentials(rawMessage)); const code = rawMessage.startsWith("OUTPUT_LOCALE_INVALID") ? "OUTPUT_LOCALE_INVALID" : usage ? "USAGE" : "FAILED"; return machine ? { exitCode, stdout: "", stderr: json({ error: { code, message, ...(locale === "zh-CN" ? { rawEvidence } : {}) }, ok: false, outputLocale: locale, summary: message }) } : { exitCode, stdout: "", stderr: `horsepower: ${message}${locale === "zh-CN" ? ` (${rawEvidence})` : ""}\n` }; }
  } };
}
