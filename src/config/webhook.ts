import type { WebhookAuth, WebhookNotifierOptions } from "../lifecycle/webhook-notifier.js";
import type { JsonObject } from "./json-store.js";

const SECRET = "[REDACTED]";
const credentialKey = /(?:secret|token|authorization|authentication|api[-_]?key|credential|password)/iu;

function isObject(value: unknown): value is JsonObject {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function settingObject(value: unknown, label: string): JsonObject {
  if (value === undefined) return {};
  if (!isObject(value)) throw new Error(`Invalid Horsepower webhook configuration: ${label} must be an object`);
  return value;
}

function hasUrlUserinfo(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.username.length > 0 || parsed.password.length > 0;
  } catch {
    return false;
  }
}

export function redactCredentials(value: unknown, key = "", insideAuth = false): unknown {
  const normalizedKey = key.toLowerCase();
  const authContainer = insideAuth || normalizedKey === "auth" || normalizedKey === "authentication";
  if (credentialKey.test(key) && normalizedKey !== "auth" && normalizedKey !== "authentication") return SECRET;
  if (Array.isArray(value)) return value.map((item) => redactCredentials(item, "", authContainer));
  if (!isObject(value)) {
    if (authContainer) {
      if (normalizedKey === "mode" && (value === "none" || value === "hmac" || value === "bearer")) return value;
      return SECRET;
    }
    return typeof value === "string" && hasUrlUserinfo(value) ? SECRET : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nested]) => [
    nestedKey,
    redactCredentials(nested, nestedKey, authContainer),
  ]));
}

export interface ParsedWebhook {
  config: WebhookNotifierOptions["config"];
  notifications: { change?: boolean; dispatch?: boolean };
}

export function parseWebhookSettings(globalValue: unknown, projectValue?: unknown): ParsedWebhook | undefined {
  const global = settingObject(globalValue, "webhook");
  const project = settingObject(projectValue, "project webhook");
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
  let parsedUrl: URL;
  try { parsedUrl = new URL(merged.url); } catch { throw new Error("Invalid Horsepower webhook configuration: url is invalid"); }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error("Invalid Horsepower webhook configuration: url must not contain credentials");
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.hostname !== "localhost" && parsedUrl.hostname !== "127.0.0.1") {
    throw new Error("Invalid Horsepower webhook configuration: url must use HTTPS");
  }
  const authValue = merged.auth;
  if (!isObject(authValue)) throw new Error("Invalid Horsepower webhook configuration: auth is required");
  let auth: WebhookAuth;
  if (authValue.mode === "none" && authValue.secret === undefined && authValue.token === undefined) auth = { mode: "none" };
  else if (authValue.mode === "hmac" && typeof authValue.secret === "string" && authValue.secret.length > 0 && authValue.token === undefined) auth = { mode: "hmac", secret: authValue.secret };
  else if (authValue.mode === "bearer" && typeof authValue.token === "string" && authValue.token.length > 0 && authValue.secret === undefined) auth = { mode: "bearer", token: authValue.token };
  else throw new Error("Invalid Horsepower webhook configuration: auth credentials are missing, invalid, or incompatible");

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
