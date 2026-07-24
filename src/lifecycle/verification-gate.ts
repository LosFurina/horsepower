export interface VerificationEvidence {
  id: string;
  kind: "e2e" | "targeted";
  command: string;
  exitCode: number;
  durationMs?: number;
  summary: string;
  acceptanceRefs: readonly string[];
}

export interface VerificationAlternativeEvidence {
  id: string;
  summary: string;
  acceptanceRefs: readonly string[];
}

export interface E2EWaiver {
  reason: string;
  alternativeEvidence: readonly VerificationAlternativeEvidence[];
}

export type CompletionEvidence = VerificationManifest;

export interface VerificationManifest {
  observedAt?: string;
  commands?: readonly VerificationEvidence[];
  /** Legacy fields remain type-readable but are rejected by the validator. */
  unit?: readonly unknown[];
  e2e?: readonly unknown[];
  acceptance?: readonly { ref: string; evidenceIds: readonly string[] }[];
  e2eWaiver?: E2EWaiver;
}

export interface AcceptanceSnapshot {
  digest: string;
  refs: readonly string[];
}

export interface VerificationContext {
  runStartedAt: string;
  now: string;
  currentAcceptanceSnapshot: AcceptanceSnapshot;
}

export type VerificationDecision =
  | { kind: "e2e"; scopeDigest: string; observedAt: string; evidence: VerificationEvidence[] }
  | { kind: "waiver"; scopeDigest: string; observedAt: string; reason: string; evidence: VerificationAlternativeEvidence[] };

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
/** Evidence is accepted only for this explicit freshness window. */
export const VERIFICATION_MAX_AGE_MS = 10 * 60 * 1000;
/** Evidence may not be timestamped after the injected verification clock. */
export const VERIFICATION_MAX_FUTURE_SKEW_MS = 0;
const bounded = (value: string, label: string, max: number) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`VERIFICATION_FIELD_INVALID: ${label} is required`);
  if (value.length > max) throw new Error(`VERIFICATION_FIELD_INVALID: ${label} exceeds ${max} characters`);
  return value;
};

function timestamp(value: string, label: string): number {
  if (!UTC.test(value) || new Date(value).toISOString() !== value) throw new Error(`VERIFICATION_TIMESTAMP_INVALID: ${label} must be an exact UTC timestamp`);
  return Date.parse(value);
}

export function verifyFreshEvidence(manifest: VerificationManifest, context: VerificationContext): VerificationDecision {
  if (!manifest || typeof manifest !== "object") throw new Error("VERIFICATION_MANIFEST_REQUIRED: completion requires a verification manifest; legacy evidence is unsupported");
  if ("workerReport" in (manifest as object)) throw new Error("VERIFICATION_WORKER_REPORT_ONLY: Captain must independently verify worker claims");
  if (Array.isArray((manifest as Record<string, unknown>).e2e) || (("e2eWaiver" in (manifest as object)) && !("observedAt" in (manifest as object) && "acceptance" in (manifest as object)))) throw new Error("VERIFICATION_LEGACY_E2E_MIGRATION_REQUIRED: submit a claim-matched verification manifest");
  if (!Array.isArray(manifest.commands) && manifest.commands !== undefined) throw new Error("VERIFICATION_COMMANDS_INVALID: verification commands must be an array");
  if (!Array.isArray(manifest.acceptance)) throw new Error("VERIFICATION_ACCEPTANCE_INVALID: verification manifest requires current acceptance mapping");
  if (typeof manifest.observedAt !== "string") throw new Error("VERIFICATION_MANIFEST_REQUIRED: completion requires a claim-matched verification manifest; legacy evidence is unsupported");
  const observed = timestamp(manifest.observedAt, "Verification observedAt");
  const started = timestamp(context.runStartedAt, "Run start");
  const now = timestamp(context.now, "Verification clock");
  if (observed < started) throw new Error("VERIFICATION_EVIDENCE_STALE: verification observed before active run start");
  if (observed > now + VERIFICATION_MAX_FUTURE_SKEW_MS) throw new Error("VERIFICATION_EVIDENCE_FUTURE_SKEW: observedAt cannot be in the future");
  if (now - observed > VERIFICATION_MAX_AGE_MS) throw new Error("VERIFICATION_EVIDENCE_STALE: provide verification observed within the freshness window");
  if (manifest.e2eWaiver && Array.isArray(manifest.commands) && manifest.commands.length > 0) throw new Error("VERIFICATION_EVIDENCE_AMBIGUOUS: verification manifest cannot contain both commands and e2eWaiver");
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) {
    if (!manifest.e2eWaiver) throw new Error("VERIFICATION_EVIDENCE_REQUIRED: completion requires commands or a mapped e2eWaiver");
  }
  if (manifest.e2eWaiver && !Array.isArray(manifest.e2eWaiver.alternativeEvidence)) throw new Error("VERIFICATION_WAIVER_INVALID: e2eWaiver requires mapped alternative evidence");
  const all: Array<VerificationEvidence | VerificationAlternativeEvidence> = [...(manifest.commands ?? []), ...(manifest.e2eWaiver?.alternativeEvidence ?? [])];
  if (all.length > 8) throw new Error("VERIFICATION_EVIDENCE_LIMIT: verification manifest permits at most 8 evidence items");
  const ids = new Set<string>();
  for (const item of all) {
    bounded(item.id, "Evidence id", 128);
    if (ids.has(item.id)) throw new Error(`VERIFICATION_EVIDENCE_DUPLICATE: ${item.id}`);
    ids.add(item.id);
    bounded(item.summary, "Evidence summary", 500);
    if (!Array.isArray(item.acceptanceRefs) || item.acceptanceRefs.length === 0 || item.acceptanceRefs.length > 20) throw new Error(`VERIFICATION_ACCEPTANCE_INVALID: evidence ${item.id} requires 1 to 20 acceptance references`);
    if (new Set(item.acceptanceRefs).size !== item.acceptanceRefs.length) throw new Error(`VERIFICATION_ACCEPTANCE_DUPLICATE: evidence ${item.id} has duplicate acceptance references`);
    for (const ref of item.acceptanceRefs) bounded(ref, "Acceptance reference", 256);
    if ("durationMs" in item && (typeof item.durationMs !== "number" || !Number.isFinite(item.durationMs) || item.durationMs < 0)) throw new Error(`VERIFICATION_DURATION_INVALID: evidence ${item.id} durationMs must be finite and nonnegative`);
  }
  for (const command of manifest.commands ?? []) {
    if (command.kind !== "e2e" && command.kind !== "targeted") throw new Error(`VERIFICATION_KIND_INVALID: evidence ${command.id} kind must be e2e or targeted`);
    bounded(command.command, "Evidence command", 500);
    if (!Number.isSafeInteger(command.exitCode)) throw new Error(`VERIFICATION_EXIT_CODE_INVALID: evidence ${command.id} exitCode must be an integer`);
    if (command.exitCode !== 0) throw new Error("VERIFICATION_COMMAND_FAILED: every verification command must succeed");
  }
  const currentRefs = [...context.currentAcceptanceSnapshot.refs];
  const mappings = manifest.acceptance;
  if (Array.isArray(mappings) && mappings.length > 100) throw new Error("VERIFICATION_ACCEPTANCE_LIMIT: verification manifest permits at most 100 acceptance mappings");
  if (!Array.isArray(mappings)) throw new Error("VERIFICATION_ACCEPTANCE_INVALID: verification manifest requires current acceptance mapping");
  const mapped = new Set<string>();
  const mappedEvidenceIds = new Set<string>();
  for (const mapping of mappings) {
    bounded(mapping.ref, "Acceptance reference", 256);
    if (!Array.isArray(mapping.evidenceIds) || mapping.evidenceIds.length === 0 || mapping.evidenceIds.length > 20) throw new Error(`VERIFICATION_ACCEPTANCE_INVALID: ${mapping.ref} has no valid evidence mapping`);
    if (mapped.has(mapping.ref)) throw new Error(`VERIFICATION_ACCEPTANCE_DUPLICATE: ${mapping.ref}`);
    mapped.add(mapping.ref);
    for (const id of mapping.evidenceIds) {
      if (!all.some((item) => item.id === id)) throw new Error("VERIFICATION_EVIDENCE_REFERENCE_MISSING: acceptance references must resolve to command evidence");
      mappedEvidenceIds.add(id);
    }
  }
  const currentSet = new Set(currentRefs);
  const unchecked = currentRefs.filter((ref) => !mapped.has(ref));
  const extra = [...mapped].filter((ref) => !currentSet.has(ref));
  if (extra.length) throw new Error("VERIFICATION_SCOPE_DRIFT: evidence must match the current acceptance scope");
  if (unchecked.length) throw new Error("VERIFICATION_ACCEPTANCE_PARTIAL: every current acceptance item must be covered");
  for (const evidence of all) {
    if (!mappedEvidenceIds.has(evidence.id)) throw new Error("VERIFICATION_ACCEPTANCE_CLAIM_MISMATCH: every evidence item must be mapped to acceptance");
    for (const ref of evidence.acceptanceRefs) {
      if (!currentSet.has(ref)) throw new Error("VERIFICATION_SCOPE_DRIFT: evidence must match the current acceptance scope");
      if (!mapped.has(ref)) throw new Error("VERIFICATION_ACCEPTANCE_CLAIM_MISMATCH: every evidence claim must be mapped");
    }
  }
  for (const mapping of mappings) {
    for (const id of mapping.evidenceIds) {
      const evidence = all.find((item) => item.id === id)!;
      if (!evidence.acceptanceRefs.includes(mapping.ref)) throw new Error("VERIFICATION_ACCEPTANCE_CLAIM_MISMATCH: mapped evidence must declare the acceptance reference");
    }
  }


  if (!manifest.e2eWaiver && (manifest.commands ?? []).length === 0) throw new Error("VERIFICATION_EVIDENCE_REQUIRED: completion requires Captain-observed verification evidence");
  if (manifest.e2eWaiver) {
    bounded(manifest.e2eWaiver.reason, "e2eWaiver reason", 500);
    if (!manifest.e2eWaiver.alternativeEvidence.length) throw new Error("VERIFICATION_WAIVER_INVALID: e2eWaiver requires mapped alternative evidence");
    return { kind: "waiver", scopeDigest: context.currentAcceptanceSnapshot.digest, observedAt: manifest.observedAt, reason: manifest.e2eWaiver.reason, evidence: [...manifest.e2eWaiver.alternativeEvidence] };
  }
  return { kind: "e2e", scopeDigest: context.currentAcceptanceSnapshot.digest, observedAt: manifest.observedAt, evidence: [...(manifest.commands ?? [])] };
}

/** Completion and targeted review resolution share the same bounded evidence contract. */
export function verifyCompletionManifest(manifest: VerificationManifest, context: VerificationContext): VerificationDecision {
  const decision = verifyFreshEvidence(manifest, context);
  if (decision.kind === "e2e" && !decision.evidence.some((item) => item.kind === "e2e")) {
    throw new Error("VERIFICATION_E2E_REQUIRED: completion requires a successful E2E command or mapped e2eWaiver");
  }
  return decision;
}

/** @deprecated Bare e2e/e2eWaiver payloads intentionally fail closed. */
export function verifyCompletion(evidence: unknown): never {
  void evidence;
  throw new Error("Legacy completion evidence is unsupported; submit a claim-matched verification manifest");
}
