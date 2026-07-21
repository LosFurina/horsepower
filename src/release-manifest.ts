import { supportedCompatibility, type ReleaseCompatibility } from "./compatibility.js";

export type { ReleaseCompatibility } from "./compatibility.js";
export { supportedCompatibility } from "./compatibility.js";

export function validateReleaseCompatibility(value: unknown): ReleaseCompatibility {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Invalid release manifest compatibility");
  }
  const compatibility = value as Record<string, unknown>;
  const fields = Object.keys(compatibility).sort();
  if (fields.join(",") !== "node,openspec,pi") {
    throw new Error("Invalid release manifest compatibility fields; expected node, pi, and openspec");
  }
  for (const [name, expected] of Object.entries(supportedCompatibility)) {
    if (compatibility[name] !== expected) {
      throw new Error(`Invalid release manifest ${name} compatibility; expected ${expected}`);
    }
  }
  return { ...supportedCompatibility };
}
