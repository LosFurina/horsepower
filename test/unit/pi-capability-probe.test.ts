import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, test, vi } from "vitest";

class FakeProbeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  signals: NodeJS.Signals[] = [];
  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);
    this.emit("close", null, signal);
    return true;
  }
}

const genericId = ["provider", "exact-model"].join("/");
const request = { model: genericId, thinking: "xhigh" as const };

function successful(child: FakeProbeChild): void {
  queueMicrotask(() => {
    child.stdout.write(`${JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "OK" }], stopReason: "stop" },
    })}\n`);
    child.emit("close", 0, null);
  });
}

test("launches a shell-free bounded Pi probe for the exact selection", async () => {
  const child = new FakeProbeChild();
  let command = "";
  let args: readonly string[] = [];
  let options: SpawnOptionsWithoutStdio | undefined;
  const { PI_CAPABILITY_PROBE_PROMPT, createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
  const probe = createPiCapabilityProbe({
    executable: "/usr/local/bin/pi",
    timeoutMs: 1234,
    outputByteLimit: 2048,
    spawnProcess: (nextCommand, nextArgs, nextOptions) => {
      command = nextCommand;
      args = nextArgs;
      options = nextOptions;
      successful(child);
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(probe.probe(request)).resolves.toMatchObject({ status: "supported" });
  expect(command).toBe("/usr/local/bin/pi");
  expect(args).toEqual([
    "--mode", "json", "--no-session", "--no-skills", "--no-tools",
    "--model", "provider/exact-model", "--thinking", "xhigh",
    PI_CAPABILITY_PROBE_PROMPT,
  ]);
  expect(PI_CAPABILITY_PROBE_PROMPT).toBe("Reply with OK.");
  expect(options).toMatchObject({ shell: false, stdio: ["pipe", "pipe", "pipe"] });
});

test("classifies only structured selected-value rejection as unsupported", async () => {
  const child = new FakeProbeChild();
  const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
  const probe = createPiCapabilityProbe({
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: "error",
          error: { kind: "capability_rejection", parameter: "thinking", rejectedValue: "xhigh", code: "INVALID_THINKING" },
        })}\n`);
        child.emit("close", 1, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(probe.probe(request)).resolves.toEqual({
    status: "unsupported",
    evidence: { code: "INVALID_THINKING", detail: "thinking=xhigh" },
  });
});

test("uses authoritative accepted-values exclusion but distrusts failure prose", async () => {
  const run = async (event: unknown) => {
    const child = new FakeProbeChild();
    const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
    const probe = createPiCapabilityProbe({
      spawnProcess: () => {
        queueMicrotask(() => {
          child.stdout.write(`${JSON.stringify(event)}\n`);
          child.emit("close", 1, null);
        });
        return child as unknown as ChildProcessWithoutNullStreams;
      },
    });
    return probe.probe(request);
  };

  await expect(run({
    type: "error",
    error: { kind: "capability_rejection", parameter: "thinking", acceptedValues: ["off", "high"], acceptedValuesAuthoritative: true },
  })).resolves.toMatchObject({ status: "unsupported" });
  await expect(run({ type: "error", error: { message: "xhigh unsupported; accepted: off, high" } }))
    .resolves.toMatchObject({ status: "inconclusive" });
});

test("bounds and redacts inconclusive evidence without retaining model output", async () => {
  const child = new FakeProbeChild();
  const sampleValue = ["fixture", "redaction-value"].join("-");
  const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
  const probe = createPiCapabilityProbe({
    evidenceByteLimit: 80,
    outputByteLimit: 4096,
    spawnProcess: () => {
      queueMicrotask(() => {
        child.stderr.write(`${"x".repeat(500)}\nAuthorization: Bearer ${sampleValue}`);
        child.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: sampleValue }] } })}\n`);
        child.emit("close", 1, null);
      });
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  const result = await probe.probe(request);
  expect(result.status).toBe("inconclusive");
  expect(result.evidence.detail).not.toContain(sampleValue);
  expect(result.evidence.detail).toContain("[REDACTED]");
  expect(Buffer.byteLength(result.evidence.detail ?? "", "utf8")).toBeLessThanOrEqual(80);
});

test("aborts immediately, escalates stubborn children, and removes abort listeners", async () => {
  class StubbornChild extends FakeProbeChild {
    override kill(signal: NodeJS.Signals): boolean {
      this.signals.push(signal);
      if (signal === "SIGKILL") this.emit("close", null, signal);
      return true;
    }
  }
  const child = new StubbornChild();
  const controller = new AbortController();
  const add = vi.spyOn(controller.signal, "addEventListener");
  const remove = vi.spyOn(controller.signal, "removeEventListener");
  const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
  const probe = createPiCapabilityProbe({
    gracefulShutdownMs: 2,
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
  });

  const running = probe.probe({ ...request, signal: controller.signal });
  controller.abort();

  await expect(running).resolves.toMatchObject({ status: "inconclusive", evidence: { code: "aborted" } });
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(add).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
});

test("observes cancellation that occurs synchronously during spawn", async () => {
  const child = new FakeProbeChild();
  const controller = new AbortController();
  const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
  const probe = createPiCapabilityProbe({
    timeoutMs: 2,
    spawnProcess: () => {
      controller.abort();
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(probe.probe({ ...request, signal: controller.signal })).resolves.toMatchObject({
    status: "inconclusive",
    evidence: { code: "aborted" },
  });
  expect(child.signals).toEqual(["SIGTERM"]);
});

test("times out and terminates a probe that does not finish", async () => {
  const child = new FakeProbeChild();
  const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
  const probe = createPiCapabilityProbe({
    timeoutMs: 2,
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
  });

  await expect(probe.probe(request)).resolves.toMatchObject({ status: "inconclusive", evidence: { code: "timeout" } });
  expect(child.signals).toEqual(["SIGTERM"]);
});

test("stops a probe whose process output exceeds the fixed bound", async () => {
  const child = new FakeProbeChild();
  const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
  const probe = createPiCapabilityProbe({
    outputByteLimit: 16,
    spawnProcess: () => {
      queueMicrotask(() => child.stdout.write("x".repeat(17)));
      return child as unknown as ChildProcessWithoutNullStreams;
    },
  });

  await expect(probe.probe(request)).resolves.toMatchObject({ status: "inconclusive", evidence: { code: "output_limit" } });
  expect(child.signals).toEqual(["SIGTERM"]);
});

test("classifies synchronous process creation failure as inconclusive transport", async () => {
  const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");
  const probe = createPiCapabilityProbe({
    spawnProcess: () => { throw new Error("ENOENT: pi"); },
  });

  await expect(probe.probe(request)).resolves.toMatchObject({
    status: "inconclusive",
    evidence: { code: "transport" },
  });
});

test("does not spawn for an already-aborted request", async () => {
  const controller = new AbortController();
  controller.abort();
  const spawnProcess = vi.fn();
  const { createPiCapabilityProbe } = await import("../../src/runtime/pi-capability-probe.js");

  await expect(createPiCapabilityProbe({ spawnProcess }).probe({ ...request, signal: controller.signal }))
    .resolves.toMatchObject({ status: "inconclusive", evidence: { code: "aborted" } });
  expect(spawnProcess).not.toHaveBeenCalled();
});
