import type { WebhookAuth, WebhookProvider, WebhookConfig } from "../lifecycle/webhook-types.js";
import type { JsonObject } from "./json-store.js";

const SECRET = "[REDACTED]";
const credentialTerms = new Set([
  "auth",
  "authentication",
  "authorization",
  "credential",
  "key",
  "password",
  "secret",
  "token",
]);
const credentialPrefixes = new Set([
  "access",
  "api",
  "auth",
  "authentication",
  "authorization",
  "client",
  "refresh",
  "signing",
  "webhook",
]);

function decodedCredentialKey(value: string): string {
  try { return decodeURIComponent(value.replaceAll("+", " ")); }
  catch { return value; }
}

function credentialKeyParts(value: string): { compact: string; tokens: string[] } {
  const decoded = decodedCredentialKey(value)
    .replaceAll(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replaceAll(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase();
  return {
    compact: decoded.replaceAll(/[^a-z0-9]/gu, ""),
    tokens: decoded.split(/[^a-z0-9]+/gu).filter(Boolean),
  };
}

export function isCredentialKey(value: string): boolean {
  const { compact, tokens } = credentialKeyParts(value);
  if (credentialTerms.has(compact) || tokens.some((token) => credentialTerms.has(token))) return true;
  return [...credentialPrefixes].some((prefix) => compact.startsWith(prefix)
    && ["credential", "key", "password", "secret", "token"].some((term) => compact === `${prefix}${term}`));
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function settingObject(value: unknown, label: string): JsonObject {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`Invalid Horsepower webhook configuration: ${label} must be an object`);
  return value;
}

function redactUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return value;
    if (parsed.username) parsed.username = SECRET;
    if (parsed.password) parsed.password = SECRET;
    if (parsed.search.length > 1) {
      parsed.search = `?${parsed.search.slice(1).split("&").map((parameter) => {
        const separator = parameter.indexOf("=");
        const name = separator < 0 ? parameter : parameter.slice(0, separator);
        return isCredentialKey(name) ? `${name}=${encodeURIComponent(SECRET)}` : parameter;
      }).join("&")}`;
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

function redactUrls(value: string): string {
  return value.replaceAll(/https?:\/\/[^\s"'<>]+/giu, (url) => redactUrl(url));
}

export function redactCredentials(value: unknown, key = "", insideAuth = false): unknown {
  const normalizedKey = credentialKeyParts(key).compact;
  const authContainer = insideAuth || normalizedKey === "auth" || normalizedKey === "authentication";
  if (isCredentialKey(key) && normalizedKey !== "auth" && normalizedKey !== "authentication") return SECRET;
  if (Array.isArray(value)) return value.map((item) => redactCredentials(item, "", authContainer));
  if (!isObject(value)) {
    if (authContainer) {
      if (normalizedKey === "mode" && (value === "none" || value === "hmac" || value === "bearer")) return value;
      return SECRET;
    }
    return typeof value === "string" ? redactUrls(value) : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [
    nestedKey,
    redactCredentials(nested, nestedKey, authContainer),
  ]));
}

const validProviders = new Set<WebhookProvider>(["generic", "discord"]);

export function validateWebhookProvider(value: unknown): WebhookProvider {
  if (value === undefined || value === null) return "generic";
  if (typeof value !== "string") throw new Error("Invalid Horsepower webhook configuration: provider must be a string");
  if (!validProviders.has(value as WebhookProvider)) {
    throw new Error('Invalid Horsepower webhook configuration: unsupported provider. Use "generic" or "discord".');
  }
  return value as WebhookProvider;
}

export function validateWebhookUrl(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Invalid Horsepower webhook configuration: url is invalid"); }
  if (parsed.username || parsed.password) {
    throw new Error("Invalid Horsepower webhook configuration: url must not contain credentials");
  }
  const localHttp = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new Error("Invalid Horsepower webhook configuration: url must use HTTPS or local HTTP");
  }
  return parsed;
}

export interface ParsedWebhook {
  config: WebhookConfig;
  notifications: { change?: boolean; dispatch?: boolean };
}

function validateWebhookShape(value: JsonObject, label: string): void {
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    throw new Error(`Invalid Horsepower webhook configuration: ${label}enabled must be boolean`);
  }
  const notifications = settingObject(value.notifications, `${label}notifications`);
  if (notifications.change !== undefined && typeof notifications.change !== "boolean") {
    throw new Error(`Invalid Horsepower webhook configuration: ${label}notifications.change must be boolean`);
  }
  if (notifications.dispatch !== undefined && typeof notifications.dispatch !== "boolean") {
    throw new Error(`Invalid Horsepower webhook configuration: ${label}notifications.dispatch must be boolean`);
  }
  if (value.auth !== undefined) parseWebhookAuth(value.auth);
  // Validate provider if present
  if (value.provider !== undefined) validateWebhookProvider(value.provider);
}

function parseWebhookAuth(authValue: unknown): WebhookAuth {
  if (!isObject(authValue)) throw new Error("Invalid Horsepower webhook configuration: auth is required");
  if (authValue.mode === "none" && authValue.secret === undefined && authValue.token === undefined) return { mode: "none" };
  if (authValue.mode === "hmac" && typeof authValue.secret === "string" && authValue.secret.length > 0 && authValue.token === undefined) return { mode: "hmac", secret: authValue.secret };
  if (authValue.mode === "bearer" && typeof authValue.token === "string" && authValue.token.length > 0 && authValue.secret === undefined) return { mode: "bearer", token: authValue.token };
  throw new Error("Invalid Horsepower webhook configuration: auth credentials are missing, invalid, or incompatible");
}

/**
 * Validate that provider and authentication mode are compatible.
 * Discord webhooks must use auth.mode=none because the URL carries the credential.
 */
function validateProviderAuthCompatibility(provider: WebhookProvider, auth: WebhookAuth): void {
  if (provider === "discord" && auth.mode !== "none") {
    throw new Error("Invalid Horsepower webhook configuration: Discord provider requires auth.mode=none");
  }
}

export function validateWebhookSettingsShape(value: unknown, label = ""): void {
  validateWebhookShape(settingObject(value, `${label}webhook`), label);
}

export function parseWebhookSettings(globalValue: unknown, projectValue?: unknown): ParsedWebhook | undefined {
  const project = settingObject(projectValue, "project webhook");
  if (project.enabled !== undefined && typeof project.enabled !== "boolean") {
    throw new Error("Invalid Horsepower webhook configuration: project enabled must be boolean");
  }
  if (project.enabled === false) return undefined;

  const global = settingObject(globalValue, "webhook");
  if (Object.keys(global).length === 0 && Object.keys(project).length === 0) return undefined;

  const projectNotifications = settingObject(project.notifications, "project notifications");
  const projectReplacesAllNotifications = Object.hasOwn(projectNotifications, "change")
    && Object.hasOwn(projectNotifications, "dispatch");
  const globalNotifications = projectReplacesAllNotifications
    ? {}
    : settingObject(global.notifications, "notifications");
  const merged: JsonObject = {
    ...global,
    ...project,
    notifications: { ...globalNotifications, ...projectNotifications },
  };
  validateWebhookShape(merged, "");
  if (merged.enabled === false) return undefined;
  if (typeof merged.url !== "string" || !merged.url) {
    throw new Error("Invalid Horsepower webhook configuration: url is required");
  }
  validateWebhookUrl(merged.url);
  const auth = parseWebhookAuth(merged.auth);
  const provider = validateWebhookProvider(merged.provider);

  // Validate provider/auth compatibility
  validateProviderAuthCompatibility(provider, auth);

  const notifications = settingObject(merged.notifications, "notifications");
  if (notifications.change !== undefined && typeof notifications.change !== "boolean") {
    throw new Error("Invalid Horsepower webhook configuration: notifications.change must be boolean");
  }
  if (notifications.dispatch !== undefined && typeof notifications.dispatch !== "boolean") {
    throw new Error("Invalid Horsepower webhook configuration: notifications.dispatch must be boolean");
  }
  return {
    config: { url: merged.url, auth, provider },
    notifications: {
      ...(typeof notifications.change === "boolean" ? { change: notifications.change } : {}),
      ...(typeof notifications.dispatch === "boolean" ? { dispatch: notifications.dispatch } : {}),
    },
  };
}
