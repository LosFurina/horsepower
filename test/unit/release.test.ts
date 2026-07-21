import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, expect, test } from "vitest";
import {
  buildRelease,
  inspectReleaseArchive,
  scanPublicContent,
  validateStagedRelease,
} from "../../src/release/index.js";

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

test("requires the requested, package, and manifest versions to agree", async () => {
  const repositoryRoot = await fixtureRepository();
  await expect(buildRelease({ repositoryRoot, outputDir: join(await temporaryDirectory(), "out"), version: "1.2.4", runBuild: async () => {} }))
    .rejects.toThrow("Release version 1.2.4 does not match package version 1.2.3-alpha.1");
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

test("archive inspection rejects traversal, absolute names, unsafe links, and special entries", async () => {
  const root = await temporaryDirectory();
  const samples = [
    { name: "../escape", type: "0", error: "Archive path traversal" },
    { name: "/absolute", type: "0", error: "Archive path must be relative" },
    { name: "horsepower/link", type: "2", link: "../../escape", error: "Archive links are not allowed" },
    { name: "horsepower/device", type: "3", error: "Unsupported archive entry type" },
    { name: "horsepower/unsafe", type: "0", mode: 0o777, error: "Unsafe archive mode" },
  ];
  for (const [index, sample] of samples.entries()) {
    const archive = join(root, `${index}.tar.gz`);
    await writeFile(archive, makeHostileArchive(sample.name, sample.type, sample.link, sample.mode));
    await expect(inspectReleaseArchive(archive)).rejects.toThrow(sample.error);
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

test("privacy scanner rejects seeded private data while accepting model-neutral resources", () => {
  const forbidden = [
    ["private agent", "resources/personas/executive.md"],
    ["provider mapping", "provider: secret-cloud"],
    ["concrete model", "model: private-model-v9"],
    ["credential", "api_key = 'synthetic-api-token'"],
    ["token", "Authorization: Bearer abcdefghijklmnopqrstuvwxyz"],
    ["machine path", "/Users/alice/work/private"],
    ["home path", "/home/alice/.config/private"],
    ["session", ".pi/sessions/2026.jsonl"],
    ["competing plan", "implementation-plan.md"],
    ["legacy reference", "AgentFlow runtime"],
    ["forbidden workflow", "Superpowers process"],
  ] as const;
  for (const [label, content] of forbidden) {
    expect(() => scanPublicContent([{ path: `${label}.txt`, content: Buffer.from(content) }])).toThrow(/Forbidden public content/u);
  }
  expect(() => scanPublicContent([{ path: "resources/agents/coder.md", content: Buffer.from("role: Implement changes\nrecommendedSlots: [craft]\n") }])).not.toThrow();
  expect(() => scanPublicContent([{ path: "bin/horsepower", content: Buffer.from("return {\n  model: binding.model,\n  provider: resolved.provider,\n};\n") }])).not.toThrow();
});

function makeHostileArchive(name: string, type: string, link = "", mode = 0o644): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write("00000000000\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write(link, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const sum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]), { level: 9 });
}
