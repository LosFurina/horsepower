import type { ThinkingLevel } from "../slots/registry.js";

export const MAX_CAPABILITY_EVIDENCE_TTL_MS = 10 * 60 * 1_000;
export const MAX_CAPABILITY_EVIDENCE_CODE_LENGTH = 256;

export interface CapabilityEvidenceKey {
  model: string;
  thinking: ThinkingLevel;
  catalogRevision: string;
}

export interface SupportedCapabilityEvidence {
  source: "declared" | "live-probe";
  code: string;
}

export interface CachedCapabilityEvidence extends SupportedCapabilityEvidence {
  recordedAt: number;
}

export interface CreateCapabilityEvidenceCacheOptions {
  now?: () => number;
  ttlMs?: number;
}

function cacheKey(key: CapabilityEvidenceKey): string {
  return JSON.stringify([key.model, key.thinking, key.catalogRevision]);
}

export function createCapabilityEvidenceCache(options: CreateCapabilityEvidenceCacheOptions = {}) {
  const now = options.now ?? Date.now;
  const ttlMs = Math.min(
    MAX_CAPABILITY_EVIDENCE_TTL_MS,
    Math.max(0, options.ttlMs ?? MAX_CAPABILITY_EVIDENCE_TTL_MS),
  );
  const entries = new Map<string, CachedCapabilityEvidence>();

  return {
    get size(): number {
      return entries.size;
    },
    get(key: CapabilityEvidenceKey): CachedCapabilityEvidence | undefined {
      const encoded = cacheKey(key);
      const evidence = entries.get(encoded);
      if (!evidence) return undefined;
      if (now() - evidence.recordedAt > ttlMs) {
        entries.delete(encoded);
        return undefined;
      }
      return evidence;
    },
    recordSupported(key: CapabilityEvidenceKey, evidence: SupportedCapabilityEvidence): void {
      entries.set(cacheKey(key), Object.freeze({
        source: evidence.source,
        code: evidence.code.slice(0, MAX_CAPABILITY_EVIDENCE_CODE_LENGTH),
        recordedAt: now(),
      }));
    },
    invalidate(key: CapabilityEvidenceKey): boolean {
      return entries.delete(cacheKey(key));
    },
  };
}
