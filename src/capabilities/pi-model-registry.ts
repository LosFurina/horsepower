// Build-time adapter: keep Pi model discovery behind one version-pinned compatibility boundary.
// The CLI bundle resolves these concrete modules instead of the audit-only package-root alias.
export { ModelRegistry } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.js";
export { ModelRuntime } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.js";
