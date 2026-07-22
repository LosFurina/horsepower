import { supportedCompatibility, type ReleaseCompatibility } from "./compatibility.js";

export type { ReleaseCompatibility } from "./compatibility.js";
export { supportedCompatibility } from "./compatibility.js";

export function parseReleaseCompatibility(value: unknown): ReleaseCompatibility {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Invalid release manifest compatibility");
  }
  const compatibility = value as Record<string, unknown>;
  const fields = Object.keys(compatibility).sort();
  if (fields.join(",") !== "node,openspec,pi") {
    throw new Error("Invalid release manifest compatibility fields; expected node, pi, and openspec");
  }
  for (const name of fields) {
    if (typeof compatibility[name] !== "string" || compatibility[name].length === 0) {
      throw new Error(`Invalid release manifest ${name} compatibility`);
    }
  }
  return compatibility as unknown as ReleaseCompatibility;
}

export function validateReleaseCompatibility(value: unknown): ReleaseCompatibility {
  const compatibility = parseReleaseCompatibility(value);
  for (const [name, expected] of Object.entries(supportedCompatibility)) {
    if (compatibility[name as keyof ReleaseCompatibility] !== expected) {
      throw new Error(`Invalid release manifest ${name} compatibility; expected ${expected}`);
    }
  }
  return { ...supportedCompatibility };
}
