import type { OutputLocale } from "../localization/index.js";
import type { SkillAuditResult } from "../skills/audit.js";

export type WebhookAction = "preserve" | "skip" | "disable" | "configure" | "cancel";
export type ModelAction = "configure" | "skip" | "cancel";
export interface WebhookConfigurationInput {
  url: string;
  auth: { mode: "hmac"; secret: string } | { mode: "bearer"; token: string } | { mode: "none" };
  dispatch: boolean;
}

export interface CompleteConfigurationTerminal {
  isAvailable?(): Promise<boolean>;
  chooseLocale(current: OutputLocale): Promise<OutputLocale | undefined>;
  setLocale(locale: OutputLocale): void;
  showSkillBoundary(locale: OutputLocale): void | Promise<void>;
  showSkillAudit(locale: OutputLocale, audit: SkillAuditResult): void | Promise<void>;
  confirmSkillRisk(locale: OutputLocale, audit: SkillAuditResult): Promise<boolean>;
  chooseWebhookAction(locale: OutputLocale, existing: boolean): Promise<WebhookAction>;
  readWebhookConfiguration(locale: OutputLocale): Promise<WebhookConfigurationInput | undefined>;
  chooseModelAction(locale: OutputLocale): Promise<ModelAction>;
  showConfigurationSummary(locale: OutputLocale, result: CompleteConfigurationResult): void | Promise<void>;
}

export interface CompleteConfigurationResult {
  status: "complete" | "incomplete" | "canceled";
  locale: { status: "configured" | "preserved"; value: OutputLocale };
  skills: { status: "acknowledged" | "declined" | "preconfirmed" | "not_started"; auditStatus?: SkillAuditResult["status"]; externalCount?: number };
  webhook: { status: "preserved" | "skipped" | "disabled" | "configured" | "canceled" | "not_started" };
  models: { status: "configured" | "skipped" | "canceled" | "not_started"; followUp?: "horsepower setup --interactive" };
  followUps: string[];
}

export interface CompleteConfigurationOptions {
  initialLocale: OutputLocale;
  installerContext?: boolean;
  terminal: CompleteConfigurationTerminal;
  persistLocale(locale: OutputLocale): Promise<void>;
  auditSkills(): Promise<SkillAuditResult>;
  existingWebhook?: boolean;
  applyWebhook(action: Exclude<WebhookAction, "cancel">, configuration?: WebhookConfigurationInput): Promise<"preserved" | "skipped" | "disabled" | "configured">;
  setupModels(locale: OutputLocale): Promise<"configured" | "skipped" | "canceled">;
}

export class ConfigurationFailure extends Error {
  constructor(
    readonly code: "CONTROLLING_TERMINAL_UNAVAILABLE",
    readonly fields: Readonly<Record<string, unknown>>,
    message: string,
  ) { super(message); }
}

function finish(result: CompleteConfigurationResult): CompleteConfigurationResult {
  const completeJourneyStopped = result.skills.status === "not_started" || result.skills.status === "declined"
    || result.webhook.status === "not_started" || result.webhook.status === "canceled";
  result.followUps = completeJourneyStopped
    ? ["horsepower configure --interactive"]
    : result.models.status === "configured" ? [] : ["horsepower setup --interactive"];
  if (!completeJourneyStopped && result.models.status !== "configured") result.models.followUp = "horsepower setup --interactive";
  result.status = result.skills.status === "not_started" || result.skills.status === "declined" || result.webhook.status === "canceled" || result.models.status === "canceled"
    ? "canceled"
    : result.webhook.status === "configured" || result.webhook.status === "preserved" || result.webhook.status === "skipped" || result.webhook.status === "disabled"
      ? result.models.status === "configured" ? "complete" : "incomplete"
      : "incomplete";
  return result;
}

export async function runCompleteConfiguration(options: CompleteConfigurationOptions): Promise<CompleteConfigurationResult> {
  let locale = options.initialLocale;
  let localeStatus: CompleteConfigurationResult["locale"]["status"] = "preserved";
  if (!options.installerContext) {
    const selected = await options.terminal.chooseLocale(locale);
    if (!selected) {
      const canceled = finish({
        status: "canceled", locale: { status: "preserved", value: locale }, skills: { status: "not_started" },
        webhook: { status: "not_started" }, models: { status: "not_started" }, followUps: [],
      });
      await options.terminal.showConfigurationSummary(locale, canceled);
      return canceled;
    }
    locale = selected;
    await options.persistLocale(locale);
    localeStatus = "configured";
  }
  options.terminal.setLocale(locale);
  await options.terminal.showSkillBoundary(locale);

  let skills: CompleteConfigurationResult["skills"];
  if (options.installerContext) {
    skills = { status: "preconfirmed" };
  } else {
    const audit = await options.auditSkills();
    await options.terminal.showSkillAudit(locale, audit);
    const risky = audit.externalCount > 0 || audit.status !== "complete";
    if (risky && !(await options.terminal.confirmSkillRisk(locale, audit))) {
      const declined = finish({
        status: "canceled", locale: { status: localeStatus, value: locale },
        skills: { status: "declined", auditStatus: audit.status, externalCount: audit.externalCount },
        webhook: { status: "not_started" }, models: { status: "not_started" }, followUps: [],
      });
      await options.terminal.showConfigurationSummary(locale, declined);
      return declined;
    }
    skills = { status: "acknowledged", auditStatus: audit.status, externalCount: audit.externalCount };
  }

  const webhookAction = await options.terminal.chooseWebhookAction(locale, options.existingWebhook === true);
  if (webhookAction === "cancel") {
    const canceled = finish({ status: "canceled", locale: { status: localeStatus, value: locale }, skills, webhook: { status: "canceled" }, models: { status: "not_started" }, followUps: [] });
    await options.terminal.showConfigurationSummary(locale, canceled);
    return canceled;
  }
  const webhookConfiguration = webhookAction === "configure" ? await options.terminal.readWebhookConfiguration(locale) : undefined;
  if (webhookAction === "configure" && !webhookConfiguration) {
    const canceled = finish({ status: "canceled", locale: { status: localeStatus, value: locale }, skills, webhook: { status: "canceled" }, models: { status: "not_started" }, followUps: [] });
    await options.terminal.showConfigurationSummary(locale, canceled);
    return canceled;
  }
  const webhookStatus = await options.applyWebhook(webhookAction, webhookConfiguration);
  const modelAction = await options.terminal.chooseModelAction(locale);
  const modelStatus = modelAction === "configure" ? await options.setupModels(locale) : modelAction === "skip" ? "skipped" : "canceled";
  const result = finish({
    status: "incomplete", locale: { status: localeStatus, value: locale }, skills,
    webhook: { status: webhookStatus }, models: { status: modelStatus }, followUps: [],
  });
  await options.terminal.showConfigurationSummary(locale, result);
  return result;
}
