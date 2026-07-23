import { expect, test } from "vitest";
import * as verificationGate from "../../src/lifecycle/verification-gate.js";

type Manifest = { observedAt: string; commands: Array<{ id: string; kind: "e2e" | "targeted"; command: string; exitCode: number; durationMs?: number; summary: string; acceptanceRefs: string[] }>; acceptance: Array<{ ref: string; evidenceIds: string[] }>; e2eWaiver?: { reason: string; alternativeEvidence: Array<{ id: string; summary: string; acceptanceRefs: string[] }> } };
type Context = { runStartedAt: string; now: string; currentAcceptanceSnapshot: { digest: string; refs: string[] } };
const base: Manifest = { observedAt: "2026-07-21T12:00:00.000Z", commands: [{ id: "evidence-1", kind: "e2e", command: "npm run e2e", exitCode: 0, durationMs: 1200, summary: "passed", acceptanceRefs: ["task:1.1"] }], acceptance: [{ ref: "task:1.1", evidenceIds: ["evidence-1"] }] };
const context: Context = { runStartedAt: "2026-07-21T11:59:00.000Z", now: "2026-07-21T12:01:00.000Z", currentAcceptanceSnapshot: { digest: "sha256:current", refs: ["task:1.1"] } };
// Future-facing seam for tasks 1.3–1.5; RED until the manifest-aware API exists.
const verify = (manifest: Manifest, injectedContext: Context = context): unknown => {
  const candidate = (verificationGate as typeof verificationGate & { verifyCompletionManifest?: (value: Manifest, context: Context) => unknown }).verifyCompletionManifest;
  if (!candidate) throw new Error("Manifest lifecycle API is not implemented");
  return candidate(manifest, injectedContext);
};
test("accepts fresh evidence reconciled with current acceptance", () => expect(verify(base)).toMatchObject({ kind: "e2e", scopeDigest: "sha256:current" }));
test("rejects a missing evidence ID", () => expect(() => verify({ ...base, commands: [{ ...base.commands[0]!, id: "" }] })).toThrow(/evidence id/i));
test("rejects duplicate evidence IDs", () => expect(() => verify({ ...base, commands: [base.commands[0]!, { ...base.commands[0]! }] })).toThrow(/duplicate/i));
test("rejects a missing acceptance reference", () => expect(() => verify({ ...base, acceptance: [{ ref: "task:1.1", evidenceIds: ["missing"] }] })).toThrow(/reference|missing/i));
test("rejects observedAt before run start", () => expect(() => verify({ ...base, observedAt: "2026-07-21T11:58:00.000Z" })).toThrow(/fresh|start|observed/i));
test("rejects observedAt after current time", () => expect(() => verify({ ...base, observedAt: "2026-07-21T12:02:00.000Z" })).toThrow(/fresh|future|clock|observed/i));
test("rejects evidence older than the freshness window", () => expect(() => verify(base, { ...context, now: "2026-07-21T12:11:01.000Z" })).toThrow(/stale|fresh|age/i));
test("rejects a failed command even when acceptance is mapped", () => expect(() => verify({ ...base, commands: [{ ...base.commands[0]!, exitCode: 1, summary: "failed" }] })).toThrow(/failed|exit/i));
test("rejects a missing command evidence reference", () => expect(() => verify({ ...base, acceptance: [{ ref: "task:1.1", evidenceIds: ["missing-evidence"] }] })).toThrow(/reference|missing/i));
test("rejects partial evidence that leaves current acceptance unchecked", () => expect(() => verify({ ...base, acceptance: [] }, { ...context, currentAcceptanceSnapshot: { digest: "sha256:current", refs: ["task:1.1", "task:1.2"] } })).toThrow(/unchecked|partial|acceptance|scope/i));
test("rejects mismatch with injected current acceptance snapshot", () => expect(() => verify(base, { ...context, currentAcceptanceSnapshot: { digest: "sha256:changed", refs: ["task:2.1"] } })).toThrow(/scope|acceptance/i));
test("rejects non-UTC observedAt", () => expect(() => verify({ ...base, observedAt: "2026-07-21T12:00:00-04:00" })).toThrow(/UTC/i));
test("rejects legacy unmapped completion evidence", () => expect(() => verify({ e2e: [{ command: "npm run e2e", exitCode: 0, summary: "passed" }] } as unknown as Manifest)).toThrow(/legacy|manifest|mapping|evidence/i));
test("rejects worker-report-only evidence", () => expect(() => verify({ workerReport: { status: "success", summary: "all tests passed" } } as unknown as Manifest)).toThrow(/worker|Captain|observed|evidence/i));
test("permits a concrete mapped waiver", () => expect(verify({ ...base, commands: [], e2eWaiver: { reason: "Documentation-only change; no runtime interface exists", alternativeEvidence: [{ id: "alternative-1", summary: "OpenSpec validation passed", acceptanceRefs: ["task:1.1"] }] }, acceptance: [{ ref: "task:1.1", evidenceIds: ["alternative-1"] }] })).toMatchObject({ kind: "waiver" }));

test("accepts authoritative command evidence when duration is unavailable", () => {
  const { durationMs: _duration, ...command } = base.commands[0]!;
  expect(verify({ ...base, commands: [command] })).toMatchObject({ kind: "e2e" });
});

test.each([Number.NaN, -1])("rejects invalid durationMs %s independently of the public schema", (durationMs) => {
  expect(() => verify({ ...base, commands: [{ ...base.commands[0]!, durationMs }] })).toThrow(/durationMs.*finite.*nonnegative/i);
});

test.each([1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid exitCode %s independently of the public schema", (exitCode) => {
  expect(() => verify({ ...base, commands: [{ ...base.commands[0]!, exitCode }] })).toThrow(/exitCode.*integer/i);
});

test("rejects ambiguous command and waiver evidence", () => {
  expect(() => verify({ ...base, e2eWaiver: { reason: "ambiguous", alternativeEvidence: [{ id: "alternative-1", summary: "other", acceptanceRefs: ["task:1.1"] }] } })).toThrow(/both commands and e2eWaiver/i);
});

test("rejects a mapping whose evidence does not declare the mapped claim", () => {
  const manifest = { ...base, commands: [{ ...base.commands[0]!, acceptanceRefs: ["task:2.1"] }] };
  expect(() => verify(manifest)).toThrow(/SCOPE_DRIFT|CLAIM_MISMATCH/);
});

test("rejects an unrelated E2E command when acceptance maps only targeted evidence", () => {
  const commands = [
    { ...base.commands[0]!, id: "e2e-unused", command: "echo unrelated" },
    { ...base.commands[0]!, id: "targeted-used", kind: "targeted" as const, command: "npm test" },
  ];
  expect(() => verify({ ...base, commands, acceptance: [{ ref: "task:1.1", evidenceIds: ["targeted-used"] }] }))
    .toThrow("VERIFICATION_ACCEPTANCE_CLAIM_MISMATCH");
});

test.each([
  [{ ...base, observedAt: "not-utc" }, "VERIFICATION_TIMESTAMP_INVALID"],
  [{ ...base, commands: [{ ...base.commands[0]!, id: "" }] }, "VERIFICATION_FIELD_INVALID"],
  [{ ...base, commands: [base.commands[0]!, { ...base.commands[0]! }] }, "VERIFICATION_EVIDENCE_DUPLICATE"],
] as const)("uses a stable verification diagnostic for malformed evidence %#", (manifest, diagnostic) => {
  expect(() => verify(manifest as Manifest)).toThrow(diagnostic);
});

test("rejects an evidence claim omitted from the acceptance mapping", () => {
  const injected = { ...context, currentAcceptanceSnapshot: { digest: "sha256:current", refs: ["task:1.1", "task:2.1"] } };
  const manifest = { ...base, commands: [{ ...base.commands[0]!, acceptanceRefs: ["task:1.1", "task:2.1"] }] };
  expect(() => verify(manifest, injected)).toThrow(/ACCEPTANCE_PARTIAL|CLAIM_MISMATCH/);
});
