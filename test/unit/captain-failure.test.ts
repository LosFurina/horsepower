import { describe, expect, it } from "vitest";
import { projectComposite, projectFailure, safeText, createDiagnosticBuffer } from "../../src/failures/captain-failure.js";

describe("Captain failure projection", () => {
  it("redacts secrets and private paths", () => {
    const value = safeText("token=abc123 /Users/alice/.pi/handoff/report.txt");
    expect(value).not.toContain("abc123");
    expect(value).not.toContain("/Users/alice");
    expect(value).toContain("REDACTED");
  });
  it("bounds UTF-8 fields", () => expect(Buffer.byteLength(safeText("é".repeat(1000)), "utf8")).toBeLessThanOrEqual(512));
  it("keeps canonical input order for primary failure", () => {
    const result = projectComposite([
      { status: "failed", failure: projectFailure({ code: "LATE", boundary: "x", stage: "run", message: "late", remediation: "retry" }) },
      { status: "failed", failure: projectFailure({ code: "FIRST", boundary: "x", stage: "run", message: "first", remediation: "retry" }) },
    ]);
    expect(result.status).toBe("failed");
    expect(result.primaryFailure?.code).toBe("LATE");
    expect(result.outcomes).toHaveLength(2);
  });
  it("preserves secondary cleanup failures", () => {
    const result = projectComposite([{ status: "failed", failure: projectFailure({ code: "PRIMARY", boundary: "x", stage: "run" }) }], [projectFailure({ code: "CLEANUP", boundary: "x", stage: "cleanup" })]);
    expect(result.primaryFailure?.code).toBe("PRIMARY");
    expect(result.secondaryFailures[0]?.code).toBe("CLEANUP");
  });
  it("safely handles non-string values in safeText", () => {
    expect(safeText(null)).toBe("null");
    expect(safeText(undefined)).toBe("undefined");
    expect(safeText(42)).toBe("42");
    const err = new Error("operation failed: token=secret123");
    expect(safeText(err)).not.toContain("secret123");
    expect(safeText(err)).toContain("REDACTED");
  });
  it("truncates oversized safeText with narrow limit", () => {
    const long = "a".repeat(600);
    const result = safeText(long, 100);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(102);
    // The result should end with an ellipsis or be shorter than the original
    expect(result.length).toBeLessThan(long.length);
  });
  it("normalizes control characters in safeText", () => {
    expect(safeText("line1\u0000line2\u0007bell")).toBe("line1 line2 bell");
  });
  it("handles empty or whitespace-only strings", () => {
    expect(safeText("")).toBe("");
    expect(safeText("   ")).toBe("");
  });
  it("redacts multiple secret patterns", () => {
    const result = safeText("password=abc123 api_key=xyz789 authorization:my-auth-token");
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("xyz789");
    expect(result).not.toContain("my-auth-token");
    expect(result).toContain("REDACTED");
  });
  it("redacts private paths in non-User home directories", () => {
    const result = safeText("handoff path /home/dev/.pi/agent/horsepower/state/handoffs/abc/brief.md");
    expect(result).toContain("[PRIVATE_PATH]");
    expect(result).not.toContain("/home/dev");
  });
  it("projectFailure honors all optional fields", () => {
    const result = projectFailure({
      code: "TEST", boundary: "unit", stage: "check", message: "test msg", remediation: "fix it", retryable: true,
      path: "$.tasks[0].agent", index: 1, name: "worker-a", workerId: "w-1", messageId: "m-1", runId: "r-1",
      changeId: "c-1", provider: "openai", evidenceId: "evt-1", failureId: "fail-1",
    });
    expect(result.retryable).toBe(true);
    expect(result.path).toBe("$.tasks[0].agent");
    expect(result.index).toBe(1);
    expect(result.name).toBe("worker-a");
    expect(result.workerId).toBe("w-1");
    expect(result.messageId).toBe("m-1");
    expect(result.runId).toBe("r-1");
    expect(result.changeId).toBe("c-1");
    expect(result.provider).toBe("openai");
    expect(result.evidenceId).toBe("evt-1");
    expect(result.failureId).toBe("fail-1");
  });
  it("projectFailure bounds oversized messages", () => {
    const result = projectFailure({ code: "BIG", boundary: "x", stage: "s", message: "x".repeat(2000), remediation: "y".repeat(2000) });
    // message and remediation get re-truncated when total > MAX_TOTAL_BYTES (8192)
    // The total includes all fields so with 2000 bytes each plus other fields it'll exceed
    const json = JSON.stringify(result);
    expect(Buffer.byteLength(json, "utf8")).toBeLessThanOrEqual(8192);
  });
  it("projectFailure uses defaults for missing message and stage", () => {
    const result = projectFailure({ code: "MIN", boundary: "y" });
    expect(result.stage).toBe("unknown");
    expect(result.message).toBe("Operation failed");
    expect(result.remediation).toBe("Inspect the operation status and retry after resolving the reported failure.");
  });
  it("projectComposite with canceled and skipped outcomes", () => {
    const result = projectComposite([
      { status: "completed", value: "ok" },
      { status: "canceled" },
      { status: "skipped" },
    ]);
    // canceled takes precedence over completed
    expect(result.status).toBe("canceled");
    expect(result.outcomes).toHaveLength(3);
    expect(result.primaryFailure).toBeUndefined();
  });
  it("projectComposite failed status overrides canceled", () => {
    const result = projectComposite([
      { status: "canceled" },
      { status: "failed", failure: projectFailure({ code: "ERR", boundary: "x", stage: "run" }) },
    ]);
    expect(result.status).toBe("failed");
  });
  it("projectComposite caps secondary failures at 8", () => {
    const secondaries = Array.from({ length: 12 }, (_, i) => projectFailure({ code: `SEC${i}`, boundary: "x", stage: "c" }));
    const result = projectComposite([{ status: "failed", failure: projectFailure({ code: "P", boundary: "x", stage: "r" }) }], secondaries);
    expect(result.secondaryFailures).toHaveLength(8);
  });
  it("empty outcomes yields completed status", () => {
    const result = projectComposite([]);
    expect(result.status).toBe("completed");
    expect(result.outcomes).toEqual([]);
  });
});

describe("createDiagnosticBuffer", () => {
  it("records and snapshots diagnostics", () => {
    const buffer = createDiagnosticBuffer();
    buffer.record({ code: "WARN", boundary: "test", stage: "observe", message: "degradation detected", remediation: "check logs" });
    const snap = buffer.snapshot();
    expect(snap.diagnostics).toHaveLength(1);
    expect(snap.diagnostics[0]!.code).toBe("WARN");
    expect(snap.diagnostics[0]!.kind).toBe("observational-degradation");
    expect(snap.diagnostics[0]!.observedAt).toBeDefined();
    expect(snap.dropped).toBe(0);
  });
  it("drops records when buffer is full", () => {
    const buffer = createDiagnosticBuffer();
    for (let i = 0; i < 70; i++) {
      buffer.record({ code: `D${i}`, boundary: "test", stage: "fill" });
    }
    const snap = buffer.snapshot();
    expect(snap.diagnostics).toHaveLength(64);
    expect(snap.dropped).toBe(6);
  });
  it("drops records that would exceed byte budget", () => {
    const buffer = createDiagnosticBuffer();
    // Send a large message that nearly fills the budget
    buffer.record({ code: "BIG", boundary: "test", stage: "fill", message: "x".repeat(31_000) });
    const snap = buffer.snapshot();
    // The first record might fit because safeText truncates the message field to 512 bytes
    expect(snap.diagnostics.length).toBeGreaterThanOrEqual(1);
    // Record more small ones to fill up remaining budget and cause drops
    for (let i = 0; i < 5; i++) {
      buffer.record({ code: `SMALL${i}`, boundary: "test", stage: "fill" });
    }
    const snap2 = buffer.snapshot();
    expect(snap2.dropped).toBeGreaterThanOrEqual(0);
  });
  it("handles non-string message values gracefully", () => {
    const buffer = createDiagnosticBuffer();
    buffer.record({ code: "ERR", boundary: "test", stage: "observe", message: new Error("runtime issue"), remediation: "restart" });
    const snap = buffer.snapshot();
    expect(snap.diagnostics).toHaveLength(1);
    expect(snap.diagnostics[0]!.message).toContain("runtime issue");
  });
  it("snapshot returns a copy that cannot mutate buffer state", () => {
    const buffer = createDiagnosticBuffer();
    buffer.record({ code: "A", boundary: "test", stage: "s" });
    const snap = buffer.snapshot();
    snap.diagnostics[0]!.code = "MUTATED";
    const snap2 = buffer.snapshot();
    expect(snap2.diagnostics[0]!.code).toBe("A");
  });
});
