import type { WebhookAuth, WebhookNotifierOptions } from "../lifecycle/webhook-notifier.js";
import type { JsonObject } from "./json-store.js";

const SECRET = "[REDACTED]";
const credentialKeys = new Set([
  "auth",
  "authentication",
  "authorization",
  "credential",
  "key",
  "password",
  "secret",
  "token",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "authkey",
  "authsecret",
  "authtoken",
  "authenticationkey",
  "authenticationsecret",
  "authenticationtoken",
  "authorizationkey",
  "authorizationsecret",
  "authorizationtoken",
]);

function normalizedCredentialKey(value: string): string {
  let decoded: string;
  try { decoded = decodeURIComponent(value.replaceAll("+", " ")); }
  catch { decoded = value; }
  return decoded.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

export function isCredentialKey(value: string): boolean {
  return credentialKeys.has(normalizedCredentialKey(value));
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
  const normalizedKey = normalizedCredentialKey(key);
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
  config: WebhookNotifierOptions["config"];
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
}

function parseWebhookAuth(authValue: unknown): WebhookAuth {
  if (!isObject(authValue)) throw new Error("Invalid Horsepower webhook configuration: auth is required");
  if (authValue.mode === "none" && authValue.secret === undefined && authValue.token === undefined) return { mode: "none" };
  if (authValue.mode === "hmac" && typeof authValue.secret === "string" && authValue.secret.length > 0 && authValue.token === undefined) return { mode: "hmac", secret: authValue.secret };
  if (authValue.mode === "bearer" && typeof authValue.token === "string" && authValue.token.length > 0 && authValue.secret === undefined) return { mode: "bearer", token: authValue.token };
  throw new Error("Invalid Horsepower webhook configuration: auth credentials are missing, invalid, or incompatible");
}

export function validateWebhookSettingsShape(value: unknown, label = ""): void {
  validateWebhookShape(settingObject(value, `${label}webhook`), label);
}

export function parseWebhookSettings(globalValue: unknown, projectValue?: unknown): ParsedWebhook | undefined {
  const global = settingObject(globalValue, "webhook");
  const project = settingObject(projectValue, "project webhook");
  validateWebhookShape(global, "");
  validateWebhookShape(project, "project ");
  if (project.enabled === false || (project.enabled === undefined && global.enabled === false)) return undefined;
  if (Object.keys(global).length === 0 && Object.keys(project).length === 0) return undefined;

  const globalNotifications = settingObject(global.notifications, "notifications");
  const projectNotifications = settingObject(project.notifications, "notifications");
  const merged: JsonObject = {
    ...global,
    ...project,
    notifications: { ...globalNotifications, ...projectNotifications },
  };
  if (merged.enabled === false) return undefined;
  if (typeof merged.url !== "string" || !merged.url) {
    throw new Error("Invalid Horsepower webhook configuration: url is required");
  }
  validateWebhookUrl(merged.url);
  const auth = parseWebhookAuth(merged.auth);

  const notifications = settingObject(merged.notifications, "notifications");
  if (notifications.change !== undefined && typeof notifications.change !== "boolean") {
    throw new Error("Invalid Horsepower webhook configuration: notifications.change must be boolean");
  }
  if (notifications.dispatch !== undefined && typeof notifications.dispatch !== "boolean") {
    throw new Error("Invalid Horsepower webhook configuration: notifications.dispatch must be boolean");
  }
  return {
    config: { url: merged.url, auth },
    notifications: {
      ...(typeof notifications.change === "boolean" ? { change: notifications.change } : {}),
      ...(typeof notifications.dispatch === "boolean" ? { dispatch: notifications.dispatch } : {}),
    },
  };
}
