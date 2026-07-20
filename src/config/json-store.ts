import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, rename, rm, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(path: string): Promise<JsonObject> {
  const contents = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`Malformed JSON in ${path}`);
  }
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`Expected a JSON object in ${path}`);
  }
  return value as JsonObject;
}

async function ensurePrivateDirectory(path: string, enforcePrivacy = true): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
    await chmod(path, 0o700);
    return;
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      const parent = dirname(path);
      if (parent === path) throw cause;
      await ensurePrivateDirectory(parent, false);
      await ensurePrivateDirectory(path, enforcePrivacy);
      return;
    }
    if (code !== "EEXIST") throw cause;
  }

  const existing = await lstat(path);
  if (existing.isSymbolicLink()) {
    throw new Error(`Configuration directory must not be a symbolic link: ${path}`);
  }
  if (!existing.isDirectory()) {
    throw new Error(`Configuration path is not a directory: ${path}`);
  }
  if (enforcePrivacy) await chmod(path, 0o700);
}

function rejectUndefined(value: unknown, seen = new Set<object>()): void {
  if (value === undefined) throw new Error("JSON patch values cannot be undefined");
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const nested of Object.values(value)) rejectUndefined(nested, seen);
}

export async function writeJsonObject(path: string, value: JsonObject): Promise<void> {
  const directory = dirname(path);
  const temporaryPath = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  await ensurePrivateDirectory(directory);

  let committed = false;
  try {
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(`${JSON.stringify(value, undefined, 2)}\n`, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, path);
    committed = true;
  } finally {
    if (!committed) await rm(temporaryPath, { force: true });
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeJsonObjects(current: JsonObject, patch: JsonObject): JsonObject {
  const merged = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    const previous = current[key];
    merged[key] = isJsonObject(previous) && isJsonObject(value)
      ? mergeJsonObjects(previous, value)
      : value;
  }
  return merged;
}

export async function patchJsonObject(
  path: string,
  patch: JsonObject,
): Promise<JsonObject> {
  rejectUndefined(patch);
  const next = mergeJsonObjects(await readJsonObject(path), patch);
  await writeJsonObject(path, next);
  return next;
}
