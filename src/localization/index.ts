import { readJsonObject, writeJsonObject, type JsonObject } from "../config/json-store.js";

export const outputLocales = ["en", "zh-CN"] as const;
export type OutputLocale = typeof outputLocales[number];

type Variables = Readonly<Record<string, string | number>>;
type Formatter = (variables: Variables) => string;

const en = {
  "dispatch.completed": ({ action }) => `${action} completed.`,
  "dispatch.failed": ({ action }) => `${action} failed.`,
  "dispatch.canceled": ({ action }) => `${action} canceled.`,
  "change.completed": () => "Change completed.",
  "change.blocked_needs_human": () => "Change is blocked and needs human input.",
  "change.failed": () => "Change failed.",
  "change.canceled": () => "Change canceled.",
  "campaign.started": ({ mode }) => `Implementation campaign started in ${mode} mode.`,
  "campaign.reviewAuthorized": () => "Bounded reviewer authorization recorded.",
  "doctor.healthy": () => "Horsepower diagnostics completed.",
  "cli.configured": () => "Horsepower configured.",
  "cli.localeConfigured": ({ locale }) => `Output language set to ${locale}.`,
  "cli.commandCompleted": ({ command }) => `${command} completed.`,
  "cli.commandFailed": ({ command }) => `${command} failed.`,
  "webhook.completed": ({ scope }) => `${scope} completed.`,
  "webhook.blocked_needs_human": ({ scope }) => `${scope} is blocked and needs human input.`,
  "webhook.failed": ({ scope }) => `${scope} failed.`,
  "webhook.canceled": ({ scope }) => `${scope} canceled.`,
  "error.localeInvalid": ({ locale }) => `Unsupported output locale: ${locale}. Use en or zh-CN.`,
} satisfies Record<string, Formatter>;

const zhCN: { [K in keyof typeof en]: Formatter } = {
  "dispatch.completed": ({ action }) => `${action} 已完成。`,
  "dispatch.failed": ({ action }) => `${action} 执行失败。`,
  "dispatch.canceled": ({ action }) => `${action} 已取消。`,
  "change.completed": () => "变更已完成。",
  "change.blocked_needs_human": () => "变更已阻塞，需要人工处理。",
  "change.failed": () => "变更执行失败。",
  "change.canceled": () => "变更已取消。",
  "campaign.started": ({ mode }) => `实施 campaign 已以 ${mode} 模式启动。`,
  "campaign.reviewAuthorized": () => "已记录受限 reviewer 授权。",
  "doctor.healthy": () => "Horsepower 诊断已完成。",
  "cli.configured": () => "Horsepower 已配置。",
  "cli.localeConfigured": ({ locale }) => `输出语言已设置为 ${locale}。`,
  "cli.commandCompleted": ({ command }) => `${command} 命令已完成。`,
  "cli.commandFailed": ({ command }) => `${command} 命令执行失败。`,
  "webhook.completed": ({ scope }) => `${scope} 已完成。`,
  "webhook.blocked_needs_human": ({ scope }) => `${scope} 已阻塞，需要人工处理。`,
  "webhook.failed": ({ scope }) => `${scope} 执行失败。`,
  "webhook.canceled": ({ scope }) => `${scope} 已取消。`,
  "error.localeInvalid": ({ locale }) => `不支持的输出语言：${locale}。请使用 en 或 zh-CN。`,
};

export const catalogs = { en, "zh-CN": zhCN } as const;
export type MessageId = keyof typeof en;

export function validateOutputLocale(value: unknown): OutputLocale {
  if (value === "en" || value === "zh-CN") return value;
  throw new Error(`OUTPUT_LOCALE_INVALID: ${String(value)}`);
}

async function optionalSettings(path: string): Promise<JsonObject> {
  try { return await readJsonObject(path); } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return {}; throw cause; }
}

export async function resolveOutputLocale(globalPath: string, projectPath: string): Promise<OutputLocale> {
  const [global, project] = await Promise.all([optionalSettings(globalPath), optionalSettings(projectPath)]);
  if (project.outputLocale !== undefined) return validateOutputLocale(project.outputLocale);
  if (global.outputLocale !== undefined) return validateOutputLocale(global.outputLocale);
  return "en";
}

export async function setOutputLocale(path: string, locale: OutputLocale): Promise<JsonObject> {
  const validated = validateOutputLocale(locale);
  const current = await optionalSettings(path);
  const next = { ...current, outputLocale: validated };
  await writeJsonObject(path, next);
  return next;
}

export function message(locale: OutputLocale, id: MessageId, variables: Variables = {}): string {
  return catalogs[locale][id](variables);
}

export function localizeResult<T extends Record<string, unknown>>(
  locale: OutputLocale,
  value: T,
  id: MessageId,
  variables: Variables = {},
): T & { outputLocale: OutputLocale; summary: string } {
  return { ...value, outputLocale: locale, summary: message(locale, id, variables) };
}
