export interface ReleaseCompatibility {
  node: string;
  pi: string;
  openspec: string;
}

export const supportedCompatibility = {
  node: ">=22.19.0",
  pi: ">=0.80.10",
  openspec: ">=1.6.0",
} as const satisfies ReleaseCompatibility;

const strictSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function isSupportedOpenSpecVersion(value: string): boolean {
  const match = strictSemver.exec(value);
  if (!match || match[4] !== undefined) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 6);
}

export function unsupportedOpenSpecMessage(value: string): string {
  return `OpenSpec ${supportedCompatibility.openspec} is required; found ${value || "unknown"}`;
}
