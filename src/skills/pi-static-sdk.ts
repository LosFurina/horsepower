// Build-time adapter: audit.ts imports Pi's supported public API for type safety.
// scripts/build.mjs aliases that package import here so unrelated SDK subsystems are not bundled.
export { DefaultPackageManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js";
export { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js";
