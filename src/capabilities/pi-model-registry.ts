// Build-time adapter: keep Pi model discovery behind one version-pinned compatibility boundary.
// The CLI bundle resolves these concrete modules instead of the audit-only package-root alias.
export { ModelRegistry } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js";
export { ModelRuntime } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js";
export { resolveModelScope } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-resolver.js";
export { SettingsManager } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/settings-manager.js";
export { createAgentSessionServices } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session-services.js";
export { ProjectTrustStore, hasTrustRequiringProjectResources } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/trust-manager.js";
export { getAgentDir } from "../../node_modules/@earendil-works/pi-coding-agent/dist/config.js";
