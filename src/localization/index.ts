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
  "doctor.catalogUnavailable": () => "The Pi model catalog is unavailable; model capabilities could not be verified.",
  "doctor.catalogAction": () => "Restore the Pi model catalog, then run horsepower setup --interactive.",
  "doctor.capabilityUnverified": () => "The model and thinking combination is unverified.",
  "doctor.capabilityUnsupported": () => "The model and thinking combination is unsupported.",
  "doctor.capabilityInconclusive": () => "Model capability validation was inconclusive.",
  "doctor.capabilityStale": () => "Model capability evidence is stale.",
  "doctor.capabilityReconfigureAction": () => "Run horsepower setup --interactive to revalidate or reconfigure models.",
  "doctor.capabilityUnsupportedAction": () => "Run horsepower setup --interactive to choose a supported model and thinking combination.",
  "doctor.capabilityRetryAction": () => "Resolve the issue in rawEvidence, then retry with horsepower setup --interactive.",
  "doctor.capabilityStaleAction": () => "Run horsepower setup --interactive to refresh stale capability evidence.",
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
  "cli.setupCompleted": () => "Model setup completed.",
  "setup.unsupported": () => "The selected model and thinking combination is unsupported.",
  "setup.inconclusive": () => "Model capability could not be established.",
  "setup.writeFailed": () => "Model setup could not be committed.",
  "setup.skipped": () => "Model setup skipped; no configuration changed.",
  "setup.canceled": () => "Model setup canceled; no configuration changed.",
  "setup.modelsHeading": () => "Current Pi models:",
  "setup.chooseModel": ({ slot }) => `Select model for ${slot} (name or number; cancel to stop): `,
  "setup.chooseThinking": ({ slot, choices }) => `Select thinking for ${slot} (${choices}; cancel to stop): `,
  "setup.invalidSelection": ({ count }) => `Invalid selection. Choose 1-${count}, or type cancel.`,
  "setup.capabilityAction": ({ status, code, actions }) => `Capability ${status} (${code}). Choose ${actions}: `,
  "configure.chooseLocale": () => "Choose output language [1. English / 2. 简体中文] (cancel to stop): ",
  "configure.skillBoundary": () => "External Skills such as Superpowers remain user-managed. The main Captain follows normal Pi discovery; Horsepower workers always use --no-skills and cannot load them.",
  "configure.auditRisk": () => "External Skill exposure or audit uncertainty was found. Continue? [y/N]: ",
  "configure.webhookAction": ({ actions }) => `Webhook action (${actions}): `,
  "configure.webhookUrl": () => "Webhook URL: ",
  "configure.webhookAuth": () => "Authentication [hmac/bearer/none] (hmac recommended): ",
  "configure.webhookSecret": () => "HMAC secret: ",
  "configure.webhookToken": () => "Bearer token: ",
  "configure.webhookDispatch": () => "Enable dispatch notifications? [y/N]: ",
  "configure.modelAction": () => "Model-slot setup (configure/skip/cancel): ",
  "configure.summary": ({ status }) => status ? `Complete configuration ${status}.` : "Complete configuration finished.",
  "configure.next": ({ command }) => `Next: ${command}`,
  "configure.ttyUnavailable": () => "No controlling terminal is available. Retry horsepower configure --interactive from a terminal.",
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
  "doctor.catalogUnavailable": () => "Pi 模型目录不可用；无法验证模型能力。",
  "doctor.catalogAction": () => "恢复 Pi 模型目录后运行 horsepower setup --interactive。",
  "doctor.capabilityUnverified": () => "模型与 thinking 组合尚未验证。",
  "doctor.capabilityUnsupported": () => "模型与 thinking 组合不受支持。",
  "doctor.capabilityInconclusive": () => "模型能力验证无明确结论。",
  "doctor.capabilityStale": () => "模型能力证据已过期。",
  "doctor.capabilityReconfigureAction": () => "运行 horsepower setup --interactive 重新验证或配置模型。",
  "doctor.capabilityUnsupportedAction": () => "运行 horsepower setup --interactive 选择受支持的模型与 thinking 组合。",
  "doctor.capabilityRetryAction": () => "解决 rawEvidence 中的问题，然后运行 horsepower setup --interactive 重试。",
  "doctor.capabilityStaleAction": () => "运行 horsepower setup --interactive 刷新过期的能力证据。",
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
  "cli.setupCompleted": () => "模型设置已完成。",
  "setup.unsupported": () => "所选模型与 thinking 组合不受支持。",
  "setup.inconclusive": () => "无法确认模型能力。",
  "setup.writeFailed": () => "无法提交模型设置。",
  "setup.skipped": () => "已跳过模型设置；配置未更改。",
  "setup.canceled": () => "已取消模型设置；配置未更改。",
  "setup.modelsHeading": () => "当前 Pi 模型：",
  "setup.chooseModel": ({ slot }) => `为 ${slot} 选择模型（名称或编号；输入 cancel 停止）：`,
  "setup.chooseThinking": ({ slot, choices }) => `为 ${slot} 选择 thinking（${choices}；输入 cancel 停止）：`,
  "setup.invalidSelection": ({ count }) => `选择无效。请输入 1-${count}，或输入 cancel。`,
  "setup.capabilityAction": ({ status, code, actions }) => `能力状态 ${status}（${code}）。请选择 ${actions}：`,
  "configure.chooseLocale": () => "选择输出语言 [1. English / 2. 简体中文]（输入 cancel 停止）：",
  "configure.skillBoundary": () => "Superpowers 等外部技能仍由用户管理。主 Captain 遵循 Pi 的正常发现规则；Horsepower worker 始终使用 --no-skills，无法加载这些技能。",
  "configure.auditRisk": () => "发现外部技能暴露或审计不确定性。是否继续？[y/N]：",
  "configure.webhookAction": ({ actions }) => `Webhook 操作（${actions}）：`,
  "configure.webhookUrl": () => "Webhook URL：",
  "configure.webhookAuth": () => "认证方式 [hmac/bearer/none]（推荐 hmac）：",
  "configure.webhookSecret": () => "HMAC secret：",
  "configure.webhookToken": () => "Bearer token：",
  "configure.webhookDispatch": () => "启用 dispatch 通知？[y/N]：",
  "configure.modelAction": () => "模型 slot 设置（configure/skip/cancel）：",
  "configure.summary": ({ status }) => status ? `完整配置状态：${status}。` : "完整配置流程已结束。",
  "configure.next": ({ command }) => `下一步：${command}`,
  "configure.ttyUnavailable": () => "没有可用的控制终端。请在终端中重试 horsepower configure --interactive。",
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
