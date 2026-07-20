export interface CommandEvidence {
  command: string;
  exitCode: number;
  durationMs?: number;
  summary: string;
}

export interface E2EWaiver {
  reason: string;
  alternativeEvidence: readonly string[];
}

export interface CompletionEvidence {
  unit?: readonly CommandEvidence[];
  e2e?: readonly CommandEvidence[];
  e2eWaiver?: E2EWaiver;
}

export type VerificationDecision =
  | { kind: "e2e"; evidence: CommandEvidence[] }
  | { kind: "waiver"; reason: string; alternativeEvidence: string[] };

export function verifyCompletion(evidence: CompletionEvidence): VerificationDecision {
  if (evidence.e2e && evidence.e2e.length > 0) {
    if (evidence.e2e.length > 8) throw new Error("At most 8 E2E commands may be declared");
    for (const command of evidence.e2e) {
      if (!command.command.trim() || !command.summary.trim()) {
        throw new Error("E2E command evidence requires command and summary");
      }
      if (command.command.length > 500 || command.summary.length > 500) {
        throw new Error("E2E command evidence exceeds 500 characters");
      }
    }
    const failed = evidence.e2e.find((command) => command.exitCode !== 0);
    if (failed) throw new Error(`Captain-selected E2E failed: ${failed.command}`);
    return {
      kind: "e2e",
      evidence: evidence.e2e.map((command) => ({ ...command })),
    };
  }
  const waiver = evidence.e2eWaiver;
  if (waiver?.reason.trim() && waiver.alternativeEvidence.length > 0 &&
      waiver.alternativeEvidence.every((item) => item.trim())) {
    return {
      kind: "waiver",
      reason: waiver.reason,
      alternativeEvidence: [...waiver.alternativeEvidence],
    };
  }
  throw new Error(
    "Completion requires Captain-selected successful E2E evidence or an explicit e2eWaiver",
  );
}
