import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, expect, test } from "vitest";
import {
  buildRelease,
  inspectReleaseArchive,
  scanPublicContent,
  validateStagedRelease,
} from "../../src/release/index.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "horsepower-release-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixtureRepository(): Promise<string> {
  const root = await temporaryDirectory();
  await Promise.all([
    mkdir(join(root, "dist", "cli"), { recursive: true }),
    mkdir(join(root, "dist", "extension"), { recursive: true }),
    mkdir(join(root, "resources", "agents"), { recursive: true }),
    mkdir(join(root, "resources", "skills", "horsepower"), { recursive: true }),
  ]);
  await writeFile(join(root, "package.json"), JSON.stringify({
    name: "horsepower", version: "1.2.3-alpha.1", private: true, type: "module", engines: { node: ">=22.19.0" },
  }));
  await writeFile(join(root, "LICENSE"), "MIT\n");
  await writeFile(join(root, "dist", "cli", "horsepower.js"), "#!/usr/bin/env node\nconsole.log('horsepower');\n");
  await chmod(join(root, "dist", "cli", "horsepower.js"), 0o755);
  await writeFile(join(root, "dist", "extension", "index.js"), "export default function horsepower() {}\n");
  await writeFile(join(root, "resources", "agents", "coder.md"), "---\nname: coder\nrole: Implement scoped changes\nrecommendedSlots: [craft]\ntools: [read, edit]\nstandards: [correctness]\n---\nImplement directly.\n");
  await writeFile(join(root, "resources", "skills", "horsepower", "SKILL.md"), "---\nname: horsepower\ndescription: Explicitly dispatch Horsepower workers.\n---\nUse `horsepower_subagent` only when explicit execution is useful.\n");
  await Promise.all([
    mkdir(join(root, "src"), { recursive: true }),
    mkdir(join(root, "test", "fixtures"), { recursive: true }),
    mkdir(join(root, "docs"), { recursive: true }),
  ]);
  await writeFile(join(root, "src", "public.ts"), "export const semanticSlot = 'craft';\n");
  await writeFile(join(root, "test", "fixtures", "public.txt"), "model-neutral fixture\n");
  await writeFile(join(root, "docs", "release.md"), "Public release documentation.\n");
  await writeFile(join(root, ".gitignore"), "dist/\n");
  await execFileAsync("git", ["init", "-q"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  return root;
}

const expectedFiles = [
  "horsepower/LICENSE",
  "horsepower/bin/horsepower",
  "horsepower/package.json",
  "horsepower/pi/extensions/horsepower/index.js",
  "horsepower/pi/skills/horsepower/SKILL.md",
  "horsepower/release-manifest.json",
  "horsepower/resources/agents/coder.md",
];

test("builds the exact Pi layout with strict manifest digests and canonical modes", async () => {
  const repositoryRoot = await fixtureRepository();
  const outputDir = join(await temporaryDirectory(), "assets");

  const result = await buildRelease({ repositoryRoot, outputDir, version: "1.2.3-alpha.1", runBuild: async () => {} });
  const inspected = await inspectReleaseArchive(result.archivePath);

  expect(inspected.entries.filter((entry) => entry.type === "file").map((entry) => entry.path)).toEqual(expectedFiles);
  expect(inspected.entries.filter((entry) => entry.type === "directory").every((entry) => entry.mode === 0o755)).toBe(true);
  expect(inspected.entries.find((entry) => entry.path === "horsepower/bin/horsepower")?.mode).toBe(0o755);
  expect(inspected.entries.filter((entry) => entry.type === "file" && entry.path !== "horsepower/bin/horsepower").every((entry) => entry.mode === 0o644)).toBe(true);

  const manifestEntry = inspected.entries.find((entry) => entry.path === "horsepower/release-manifest.json");
  const manifest = JSON.parse(manifestEntry?.content?.toString("utf8") ?? "null");
  expect(manifest).toEqual({
    version: "1.2.3-alpha.1",
    compatibility: { node: ">=22.19.0", pi: "0.80.10", openspec: ">=1.6.0" },
    entryPoints: {
      cli: "bin/horsepower",
      extension: "pi/extensions/horsepower/index.js",
      skill: "pi/skills/horsepower/SKILL.md",
    },
    digests: {
      "bin/horsepower": expect.stringMatching(/^[a-f0-9]{64}$/u),
      "pi/extensions/horsepower/index.js": expect.stringMatching(/^[a-f0-9]{64}$/u),
      "pi/skills/horsepower/SKILL.md": expect.stringMatching(/^[a-f0-9]{64}$/u),
    },
  });
  for (const [path, digest] of Object.entries(manifest.digests as Record<string, string>)) {
    const content = inspected.entries.find((entry) => entry.path === `horsepower/${path}`)?.content;
    expect(createHash("sha256").update(content!).digest("hex")).toBe(digest);
  }
  const packaged = JSON.parse(inspected.entries.find((entry) => entry.path === "horsepower/package.json")!.content!.toString("utf8"));
  expect(packaged).toEqual({ name: "horsepower", version: "1.2.3-alpha.1", private: true, type: "module", engines: { node: ">=22.19.0" } });
});

test("produces byte-identical archives and a verifiable external checksum", async () => {
  const repositoryRoot = await fixtureRepository();
  const firstOutput = join(await temporaryDirectory(), "first");
  const secondOutput = join(await temporaryDirectory(), "second");

  const first = await buildRelease({ repositoryRoot, outputDir: firstOutput, version: "1.2.3-alpha.1", runBuild: async () => {} });
  const second = await buildRelease({ repositoryRoot, outputDir: secondOutput, version: "1.2.3-alpha.1", runBuild: async () => {} });
  const [firstBytes, secondBytes, checksum] = await Promise.all([
    readFile(first.archivePath), readFile(second.archivePath), readFile(first.checksumPath, "utf8"),
  ]);

  expect(firstBytes).toEqual(secondBytes);
  expect(checksum).toBe(`${createHash("sha256").update(firstBytes).digest("hex")}  horsepower-v1.2.3-alpha.1.tar.gz\n`);
  expect((await readdir(firstOutput)).sort()).toEqual(["horsepower-v1.2.3-alpha.1.tar.gz", "horsepower-v1.2.3-alpha.1.tar.gz.sha256"]);
});

test("refuses to clear unrelated output content", async () => {
  const repositoryRoot = await fixtureRepository();
  const outputDir = join(await temporaryDirectory(), "assets");
  await mkdir(outputDir);
  await writeFile(join(outputDir, "keep.txt"), "owned by someone else");

  await expect(buildRelease({ repositoryRoot, outputDir, version: "1.2.3-alpha.1", runBuild: async () => {} }))
    .rejects.toThrow("Release output contains unexpected entry: keep.txt");
  expect(await readFile(join(outputDir, "keep.txt"), "utf8")).toBe("owned by someone else");
});

test("requires strict SemVer and requested/package version agreement", async () => {
  const repositoryRoot = await fixtureRepository();
  await expect(buildRelease({ repositoryRoot, outputDir: join(await temporaryDirectory(), "out"), version: "1.2.4", runBuild: async () => {} }))
    .rejects.toThrow("Release version 1.2.4 does not match package version 1.2.3-alpha.1");
  for (const version of ["01.2.3", "1.2.3-", "1.2.3-alpha..1", "1.2.3-01", "1.2.3+build..1"]) {
    await expect(buildRelease({ repositoryRoot, outputDir: join(await temporaryDirectory(), version.replaceAll("/", "_")), version, runBuild: async () => {} }))
      .rejects.toThrow(`Invalid release version: ${version}`);
  }
  await writeFile(join(repositoryRoot, "package.json"), JSON.stringify({
    name: "horsepower", version: "01.2.3", private: true, type: "module", engines: { node: ">=22.19.0" },
  }));
  await expect(buildRelease({ repositoryRoot, outputDir: join(await temporaryDirectory(), "invalid-package"), version: "1.2.3", runBuild: async () => {} }))
    .rejects.toThrow("Invalid package version: 01.2.3");
});

test("scans tracked source, documentation, tests, and rejects unclassified tracked files", async () => {
  const repositoryRoot = await fixtureRepository();
  const trackedLeaks = ["src/public.ts", "docs/release.md", "test/fixtures/public.txt"];
  for (const [index, path] of trackedLeaks.entries()) {
    const original = await readFile(join(repositoryRoot, path));
    await writeFile(join(repositoryRoot, path), `credential ${["ghp", ""].join("_")}${"a".repeat(36)}\n`);
    await expect(buildRelease({ repositoryRoot, outputDir: join(await temporaryDirectory(), `leak-${index}`), version: "1.2.3-alpha.1", runBuild: async () => {} }), path)
      .rejects.toThrow(new RegExp(`Forbidden public content \\(credential\\).*${path.replaceAll("/", "\\/")}`, "u"));
    await writeFile(join(repositoryRoot, path), original);
  }

  await writeFile(join(repositoryRoot, "mystery.private"), "not classified\n");
  await execFileAsync("git", ["add", "mystery.private"], { cwd: repositoryRoot });
  await expect(buildRelease({ repositoryRoot, outputDir: join(await temporaryDirectory(), "unknown"), version: "1.2.3-alpha.1", runBuild: async () => {} }))
    .rejects.toThrow("Unclassified tracked repository file: mystery.private");
});

test("concurrent builds use isolated staging and remain deterministic", async () => {
  const repositoryRoot = await fixtureRepository();
  const outputParent = await temporaryDirectory();
  const outputs = await Promise.all(Array.from({ length: 4 }, async (_, index) =>
    buildRelease({ repositoryRoot, outputDir: join(outputParent, `concurrent-${index}`), version: "1.2.3-alpha.1", runBuild: async () => {} })));
  const archives = await Promise.all(outputs.map(({ archivePath }) => readFile(archivePath)));
  for (const archive of archives.slice(1)) expect(archive).toEqual(archives[0]);
});

test("strict staged validation rejects unexpected paths, links, and unsafe modes", async () => {
  const repositoryRoot = await fixtureRepository();
  const stage = join(await temporaryDirectory(), "horsepower");
  await mkdir(stage, { recursive: true });
  await writeFile(join(stage, "unexpected.txt"), "no");
  await expect(validateStagedRelease(stage, { version: "1.2.3-alpha.1", allowedFiles: [] })).rejects.toThrow("Unexpected staged path: unexpected.txt");

  await rm(join(stage, "unexpected.txt"));
  await mkdir(join(stage, "unexpected-directory"));
  await expect(validateStagedRelease(stage, { version: "1.2.3-alpha.1", allowedFiles: [] })).rejects.toThrow("Unexpected staged directory: unexpected-directory");

  await rm(join(stage, "unexpected-directory"), { recursive: true });
  await symlink("/etc/passwd", join(stage, "escape"));
  await expect(validateStagedRelease(stage, { version: "1.2.3-alpha.1", allowedFiles: ["escape"] })).rejects.toThrow("Symbolic links are not allowed: escape");

  await rm(join(stage, "escape"));
  await writeFile(join(stage, "unsafe"), "x");
  await chmod(join(stage, "unsafe"), 0o666);
  await expect(validateStagedRelease(stage, { version: "1.2.3-alpha.1", allowedFiles: ["unsafe"] })).rejects.toThrow("Unsafe staged mode");
  void repositoryRoot;
});

test("archive inspection rejects hostile USTAR name/prefix combinations and malformed headers", async () => {
  const root = await temporaryDirectory();
  const samples = [
    { name: "../escape", error: "Archive path traversal" },
    { name: "/absolute", error: "Archive path must be relative" },
    { name: "file", prefix: "../horsepower", error: "Archive path traversal" },
    { name: "../file", prefix: "horsepower", error: "Archive path traversal" },
    { name: "file", prefix: "/horsepower", error: "Archive path must be relative" },
    { name: "", prefix: "horsepower", error: "Invalid archive USTAR path" },
    { name: "horsepower/file\0ignored", error: "Invalid archive USTAR name" },
    { name: "file", prefix: "horsepower\0ignored", error: "Invalid archive USTAR prefix" },
    { name: "horsepower/link", type: "2", link: "../../escape", error: "Archive links are not allowed" },
    { name: "horsepower/device", type: "3", error: "Unsupported archive entry type" },
    { name: "horsepower/unsafe", mode: 0o777, error: "Unsafe archive mode" },
    { name: "horsepower/file", sizeField: "77777777777\0", error: "Invalid archive size" },
    { name: "horsepower/file", corruptChecksum: true, error: "Invalid archive header checksum" },
  ];
  for (const [index, sample] of samples.entries()) {
    const archive = join(root, `${index}.tar.gz`);
    await writeFile(archive, makeHostileArchive(sample));
    await expect(inspectReleaseArchive(archive), JSON.stringify(sample)).rejects.toThrow(sample.error);
  }

  const boundary = join(root, "boundary.tar.gz");
  await writeFile(boundary, makeHostileArchive({ name: `horsepower/${"n".repeat(89)}`, prefix: "p".repeat(155) }));
  await expect(inspectReleaseArchive(boundary)).rejects.toThrow("Unexpected archive root");
});

test("archive validation rejects duplicate, unexpected, missing, and conflicting directory layout", async () => {
  const mutations: Array<{ name: string; error: string; mutate(entries: Awaited<ReturnType<typeof inspectReleaseArchive>>["entries"]): void }> = [
    {
      name: "duplicate entry",
      error: "Archive entry layout mismatch",
      mutate(entries) { entries.push({ ...entries.find((entry) => entry.path === "horsepower/bin")! }); },
    },
    {
      name: "unexpected private directory",
      error: "Archive entry layout mismatch",
      mutate(entries) { entries.push({ path: "horsepower/personas", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 0, content: Buffer.alloc(0) }); },
    },
    {
      name: "missing directory",
      error: "Archive entry layout mismatch",
      mutate(entries) { entries.splice(entries.findIndex((entry) => entry.path === "horsepower/bin"), 1); },
    },
    {
      name: "path/type conflict",
      error: "Archive path/type conflict",
      mutate(entries) { entries.find((entry) => entry.path === "horsepower/bin")!.type = "file"; },
    },
  ];
  for (const mutation of mutations) {
    const repositoryRoot = await fixtureRepository();
    const builder = (await import("../../src/release/index.js")).createReleaseBuilder({
      async inspectArchive(path) {
        const inspected = await inspectReleaseArchive(path);
        mutation.mutate(inspected.entries);
        return inspected;
      },
    });
    await expect(builder.build({
      repositoryRoot,
      outputDir: join(await temporaryDirectory(), mutation.name.replaceAll(" ", "-")),
      version: "1.2.3-alpha.1",
      runBuild: async () => {},
    }), mutation.name).rejects.toThrow(mutation.error);
  }
});

test("injects scanning at repository, stage, and archive boundaries", async () => {
  const repositoryRoot = await fixtureRepository();
  const scans: string[][] = [];
  const builder = (await import("../../src/release/index.js")).createReleaseBuilder({
    scan(contents) { scans.push(contents.map(({ path }) => path)); },
  });

  await builder.build({ repositoryRoot, outputDir: join(await temporaryDirectory(), "assets"), version: "1.2.3-alpha.1", runBuild: async () => {} });

  expect(scans).toHaveLength(3);
  expect(scans[0]).toContain("package.json");
  expect(scans[1]).toContain("release-manifest.json");
  expect(scans[2]).toContain("horsepower/release-manifest.json");
});

test("privacy scanner rejects structured bindings, standalone credentials, NUL content, and private artifacts", () => {
  const githubToken = `${["ghp", ""].join("_")}${"a".repeat(36)}`;
  const jwt = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from('{"sub":"private"}').toString("base64url")}.${"a".repeat(32)}`;
  const authorization = ["Author", "ization"].join("");
  const forbidden = [
    ["provider mapping", "provider: secret-cloud"],
    ["quoted provider", `{"provider": "secret-cloud"}`],
    ["provider array", `providers: ["secret-cloud"]`],
    ["concrete model", "model: private-model-v9"],
    ["quoted model", `{"modelId": "private-model-v9"}`],
    ["model array", `models: ["private-model-v9"]`],
    ["credential", `${["api", "key"].join("_")} = '${"a".repeat(24)}1'`],
    ["token", `${authorization}: Bearer ${"a".repeat(26)}`],
    ["standalone github", githubToken],
    ["standalone openai", `${["s", "k"].join("")}-${"a".repeat(32)}`],
    ["standalone slack", `${["xox", "b"].join("")}-${"1".repeat(12)}-${"a".repeat(24)}`],
    ["standalone google", `${["AI", "za"].join("")}${"A".repeat(35)}`],
    ["standalone jwt", jwt],
    ["private key", `-----${["BE", "GIN"].join("")} PRIVATE KEY-----`],
    ["cloud token", `${["AK", "IA"].join("")}${"A".repeat(16)}`],
    ["nul credential", `safe\0${githubToken}`],
    ["encoded basic secret", `${authorization}: Basic ${Buffer.from("user:long-private-password").toString("base64")}`],
    ["machine path", ["", "Users", "alice", "work", "private"].join("/")],
    ["home path", ["", "home", "alice", ".config", "private"].join("/")],
    ["legacy reference", "AgentFlow runtime"],
    ["forbidden workflow", "Superpowers process"],
  ] as const;
  for (const [label, content] of forbidden) {
    const extension = /provider|model/u.test(label) ? "yaml" : "txt";
    expect(() => scanPublicContent([{ path: `${label}.${extension}`, content: Buffer.from(content) }]), label).toThrow(/Forbidden public content/u);
  }
  for (const path of ["resources/personas/executive.md", ".pi/sessions/2026.jsonl", "state/transcripts/run.ndjson", "implementation-plan.md"]) {
    expect(() => scanPublicContent([{ path, content: Buffer.from("otherwise harmless") }]), path).toThrow(/Forbidden public content/u);
  }
  expect(() => scanPublicContent([{ path: "resources/agents/coder.md", content: Buffer.from("role: Implement changes\nrecommendedSlots: [craft]\n") }])).not.toThrow();
  expect(() => scanPublicContent([{ path: "bin/horsepower", content: Buffer.from("return {\n  model: binding.model,\n  provider: resolved.provider,\n};\n") }])).not.toThrow();
});

function makeHostileArchive(options: {
  name: string;
  prefix?: string;
  type?: string;
  link?: string;
  mode?: number;
  sizeField?: string;
  corruptChecksum?: boolean;
}): Buffer {
  const { name, prefix = "", type = "0", link = "", mode = 0o644, sizeField = "00000000000\0" } = options;
  const header = Buffer.alloc(512);
  Buffer.from(name).copy(header, 0, 0, 100);
  header.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(sizeField, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write(link, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  Buffer.from(prefix).copy(header, 345, 0, 155);
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  if (options.corruptChecksum === true) header[0] = (header[0] ?? 0) ^ 1;
  return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]), { level: 9 });
}
