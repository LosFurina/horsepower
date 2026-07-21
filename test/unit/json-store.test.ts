import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "horsepower-json-store-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

test("reads a JSON object without discarding unknown fields", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "settings.json");
  await writeFile(path, '{"known":true,"future":{"enabled":1}}\n');
  const { readJsonObject } = await import("../../src/config/json-store.js");

  expect(await readJsonObject(path)).toEqual({
    known: true,
    future: { enabled: 1 },
  });
});

test("reports malformed JSON with its path but not its contents", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "settings.json");
  await writeFile(path, '{"apiKey":"do-not-print",}');
  const { readJsonObject } = await import("../../src/config/json-store.js");

  const error = await readJsonObject(path).catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toBe(`Malformed JSON in ${path}`);
  expect((error as Error).message).not.toContain("do-not-print");
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
});

test("transactionally replaces private JSON without leaving temporary files", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "nested", "settings.json");
  await mkdir(join(directory, "nested"));
  await writeFile(path, '{"enabled":false}\n');
  const original = await stat(path);
  const { writeJsonObject } = await import("../../src/config/json-store.js");

  await writeJsonObject(path, { enabled: true });
  const written = await stat(path);

  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ enabled: true });
  expect(written.mode & 0o777).toBe(0o600);
  expect(await readdir(join(directory, "nested"))).toEqual(["settings.json"]);
  expect(written.ino).not.toBe(original.ino);
});

test("backup cleanup failure after commit never rolls back installed files", async () => {
  const directory = await temporaryDirectory();
  const first = join(directory, "first.json");
  const second = join(directory, "second.json");
  await writeFile(first, '{"old":1}\n');
  await writeFile(second, '{"old":2}\n');
  vi.resetModules();
  vi.doMock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
      ...actual,
      rm: async (path: Parameters<typeof actual.rm>[0], options?: Parameters<typeof actual.rm>[1]) => {
        if (String(path).endsWith(".bak")) throw Object.assign(new Error("injected backup cleanup failure"), { code: "EIO" });
        return actual.rm(path, options as never);
      },
    };
  });

  try {
    const { writeJsonObjects } = await import("../../src/config/json-store.js");
    await expect(writeJsonObjects([
      { path: first, value: { next: 1 } },
      { path: second, value: { next: 2 } },
    ])).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(first, "utf8"))).toEqual({ next: 1 });
    expect(JSON.parse(await readFile(second, "utf8"))).toEqual({ next: 2 });
  } finally {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  }
});

test("updates known fields while preserving unknown fields", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "settings.json");
  await writeFile(path, '{"enabled":false,"future":{"mode":"new"}}\n');
  const { patchJsonObject } = await import("../../src/config/json-store.js");

  const updated = await patchJsonObject(path, { enabled: true });

  expect(updated).toEqual({ enabled: true, future: { mode: "new" } });
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(updated);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("enforces mode 0600 in a fresh directory even when the process umask is restrictive", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "fresh", "nested", "settings.json");
  const { writeJsonObject } = await import("../../src/config/json-store.js");
  const previousUmask = process.umask(0o777);

  try {
    await writeJsonObject(path, { private: true });
  } finally {
    process.umask(previousUmask);
  }

  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

test("preserves unknown fields nested inside patched objects", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "settings.json");
  await writeFile(path, '{"feature":{"enabled":false,"future":"keep"}}\n');
  const { patchJsonObject } = await import("../../src/config/json-store.js");

  const updated = await patchJsonObject(path, { feature: { enabled: true } });

  expect(updated).toEqual({ feature: { enabled: true, future: "keep" } });
});

test("rejects undefined patches instead of silently deleting fields", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "settings.json");
  await writeFile(path, '{"future":{"mode":"new"}}\n');
  const { patchJsonObject } = await import("../../src/config/json-store.js");

  await expect(patchJsonObject(path, { future: undefined })).rejects.toThrow(
    "JSON patch values cannot be undefined",
  );
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ future: { mode: "new" } });
});

test("makes an existing configuration directory private", async () => {
  const directory = await temporaryDirectory();
  const configDirectory = join(directory, "config");
  const path = join(configDirectory, "settings.json");
  await mkdir(configDirectory, { mode: 0o755 });
  const { writeJsonObject } = await import("../../src/config/json-store.js");

  await writeJsonObject(path, { private: true });

  expect((await stat(configDirectory)).mode & 0o777).toBe(0o700);
});

test("rejects a symlink used as the configuration directory", async () => {
  const directory = await temporaryDirectory();
  const actualDirectory = join(directory, "actual");
  const linkedDirectory = join(directory, "linked");
  await mkdir(actualDirectory);
  await symlink(actualDirectory, linkedDirectory, "dir");
  const { writeJsonObject } = await import("../../src/config/json-store.js");

  await expect(writeJsonObject(join(linkedDirectory, "settings.json"), { private: true }))
    .rejects.toThrow(`Configuration directory must not be a symbolic link: ${linkedDirectory}`);
  expect(await readdir(actualDirectory)).toEqual([]);
});

test("cleans its temporary file and preserves the target when serialization fails", async () => {
  const directory = await temporaryDirectory();
  const path = join(directory, "settings.json");
  await writeFile(path, '{"stable":true}\n');
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const { writeJsonObject } = await import("../../src/config/json-store.js");

  await expect(writeJsonObject(path, circular)).rejects.toThrow();

  expect(await readFile(path, "utf8")).toBe('{"stable":true}\n');
  expect(await readdir(directory)).toEqual(["settings.json"]);
});
