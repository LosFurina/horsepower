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
  "doctor.configurationValid": () => "Model capability slot configuration is valid.",
  "doctor.configurationInvalid": () => "Model capability slot configuration is invalid.",
  "doctor.setupAction": () => "Run horsepower setup.",
  "doctor.webhookEnabled": ({ mode }) => `Webhook is enabled (${mode}).`,
  "doctor.webhookDisabled": () => "Webhook is disabled.",
  "doctor.webhookInvalid": () => "Webhook configuration is invalid.",
  "doctor.webhookRepairAction": () => "Run horsepower webhook configure or horsepower webhook disable.",
  "doctor.settingsInvalid": () => "Horsepower settings are invalid.",
  "doctor.settingsRepairAction": () => "Repair or remove the invalid settings listed in rawEvidence.",
  "doctor.openspecHealthy": () => "Official OpenSpec is healthy.",
  "doctor.openspecInvalid": () => "Official OpenSpec is unavailable or invalid.",
  "doctor.openspecInitAction": () => "Run openspec init --tools pi.",
  "doctor.openspecUpdateAction": () => "Run openspec update.",
  "doctor.openspecDoctorAction": () => "Run openspec doctor.",
  "doctor.openspecInstallAction": () => "Install official @fission-ai/openspec >=1.6.0 <2.0.0.",
  "doctor.modelValidated": () => "Slot models are valid.",
  "doctor.modelNeedsConfiguration": () => "Model validation requires valid slot configuration.",
  "doctor.modelUnavailable": () => "Pi model registry is unavailable; validation was skipped.",
  "doctor.integrationEnabled": () => "Horsepower Pi integration is enabled.",
  "doctor.integrationDisabled": () => "Horsepower Pi integration is disabled.",
  "doctor.integrationPartial": () => "Horsepower Pi integration is partially enabled.",
  "doctor.integrationConflict": () => "Horsepower Pi integration has a conflict.",
  "doctor.installationInvalid": () => "Horsepower installation is invalid.",
  "doctor.enableAction": () => "Run horsepower enable.",
  "doctor.integrationRepairAction": () => "Repair the conflict, then run horsepower enable or horsepower disable.",
  "doctor.integrationPartialAction": () => "Run horsepower enable to restore missing links, or run horsepower disable to remain disabled.",
  "doctor.installationRepairAction": () => "Install or repair Horsepower from an official release.",
  "cli.configured": () => "Horsepower configured.",
  "cli.localeConfigured": ({ locale }) => `Output language set to ${locale}.`,
  "cli.commandCompleted": ({ command }) => `${command} completed.`,
  "cli.commandFailed": ({ command }) => `${command} failed.`,
  "cli.enabled": () => "Horsepower enabled; run /reload or restart Pi.",
  "cli.disabled": () => "Horsepower disabled; run /reload or restart Pi.",
  "audit.summary": ({ status, count }) => `Skill exposure audit: ${status} (${count} external).`,
  "audit.boundary": () => "Horsepower workers use --no-skills; the main Captain remains in your user-controlled Pi environment.",
  "audit.scope": () => "This covers global and current-project context. Extension-contributed Skills were not enumerated, and future projects may differ.",
  "audit.incomplete": () => "The audit is incomplete; candidate files may not reflect their enabled state.",
  "audit.candidates": () => "Optional candidate scan (files found are not necessarily enabled by Pi):",
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
  "doctor.configurationValid": () => "模型能力 slot 配置有效。",
  "doctor.configurationInvalid": () => "模型能力 slot 配置无效。",
  "doctor.setupAction": () => "运行 horsepower setup。",
  "doctor.webhookEnabled": ({ mode }) => `Webhook 已启用（${mode}）。`,
  "doctor.webhookDisabled": () => "Webhook 已禁用。",
  "doctor.webhookInvalid": () => "Webhook 配置无效。",
  "doctor.webhookRepairAction": () => "运行 horsepower webhook configure 或 horsepower webhook disable。",
  "doctor.settingsInvalid": () => "Horsepower 设置无效。",
  "doctor.settingsRepairAction": () => "修复或删除 rawEvidence 中列出的无效设置。",
  "doctor.openspecHealthy": () => "官方 OpenSpec 运行正常。",
  "doctor.openspecInvalid": () => "官方 OpenSpec 不可用或无效。",
  "doctor.openspecInitAction": () => "运行 openspec init --tools pi。",
  "doctor.openspecUpdateAction": () => "运行 openspec update。",
  "doctor.openspecDoctorAction": () => "运行 openspec doctor。",
  "doctor.openspecInstallAction": () => "安装官方 @fission-ai/openspec >=1.6.0 <2.0.0。",
  "doctor.modelValidated": () => "Slot 模型验证通过。",
  "doctor.modelNeedsConfiguration": () => "模型验证需要有效的 slot 配置。",
  "doctor.modelUnavailable": () => "Pi 模型注册表不可用；已跳过验证。",
  "doctor.integrationEnabled": () => "Horsepower Pi 集成已启用。",
  "doctor.integrationDisabled": () => "Horsepower Pi 集成已禁用。",
  "doctor.integrationPartial": () => "Horsepower Pi 集成仅部分启用。",
  "doctor.integrationConflict": () => "Horsepower Pi 集成存在冲突。",
  "doctor.installationInvalid": () => "Horsepower 安装无效。",
  "doctor.enableAction": () => "运行 horsepower enable。",
  "doctor.integrationRepairAction": () => "修复冲突，然后运行 horsepower enable 或 horsepower disable。",
  "doctor.integrationPartialAction": () => "运行 horsepower enable 恢复缺失的链接，或运行 horsepower disable 保持禁用。",
  "doctor.installationRepairAction": () => "从官方 release 安装或修复 Horsepower。",
  "cli.configured": () => "Horsepower 已配置。",
  "cli.localeConfigured": ({ locale }) => `输出语言已设置为 ${locale}。`,
  "cli.commandCompleted": ({ command }) => `${command} 命令已完成。`,
  "cli.commandFailed": ({ command }) => `${command} 命令执行失败。`,
  "cli.enabled": () => "Horsepower 已启用；请运行 /reload 或重启 Pi。",
  "cli.disabled": () => "Horsepower 已禁用；请运行 /reload 或重启 Pi。",
  "audit.summary": ({ status, count }) => `技能暴露审计：${status}（${count} 个外部技能）。`,
  "audit.boundary": () => "Horsepower worker 使用 --no-skills；主 Captain 仍处于用户控制的 Pi 环境中。",
  "audit.scope": () => "审计涵盖全局及当前项目上下文；未枚举扩展动态提供的技能，未来项目也可能不同。",
  "audit.incomplete": () => "审计不完整；候选文件可能无法反映其启用状态。",
  "audit.candidates": () => "可选候选文件扫描（找到文件不表示 Pi 已启用）：",
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
