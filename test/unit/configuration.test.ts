import { expect, test, vi } from "vitest";
import { runCompleteConfiguration, type CompleteConfigurationTerminal } from "../../src/cli/configuration.js";

function terminal(overrides: Partial<CompleteConfigurationTerminal> = {}): CompleteConfigurationTerminal {
  return {
    chooseLocale: vi.fn(async () => "zh-CN" as const),
    setLocale: vi.fn(),
    showSkillBoundary: vi.fn(),
    showSkillAudit: vi.fn(),
    confirmSkillRisk: vi.fn(async () => true),
    chooseWebhookAction: vi.fn(async () => "preserve" as const),
    readWebhookConfiguration: vi.fn(),
    chooseModelAction: vi.fn(async () => "configure" as const),
    showConfigurationSummary: vi.fn(),
    ...overrides,
  };
}

const cleanAudit = {
  status: "complete" as const, cwd: "/project", externalCount: 0, excludedCount: 0,
  dynamicExtensionsEnumerated: false as const, skills: [], limitations: [], candidateScanCommand: "find",
};

test("complete configuration orders locale, Skill education/audit, webhook, and models", async () => {
  const events: string[] = [];
  const ui = terminal({
    chooseLocale: vi.fn(async () => { events.push("choose-locale"); return "zh-CN" as const; }),
    setLocale: vi.fn((locale) => { events.push(`terminal-locale:${locale}`); }),
    showSkillBoundary: vi.fn(() => { events.push("skill-boundary"); }),
    showSkillAudit: vi.fn(() => { events.push("skill-audit"); }),
    chooseWebhookAction: vi.fn(async () => { events.push("webhook-choice"); return "preserve" as const; }),
    chooseModelAction: vi.fn(async () => { events.push("model-choice"); return "configure" as const; }),
    showConfigurationSummary: vi.fn(() => { events.push("summary"); }),
  });
  const result = await runCompleteConfiguration({
    initialLocale: "en", terminal: ui,
    persistLocale: async (locale) => { events.push(`persist-locale:${locale}`); },
    auditSkills: async () => cleanAudit,
    applyWebhook: async () => { events.push("webhook-apply"); return "preserved"; },
    setupModels: async () => { events.push("models-apply"); return "configured"; },
  });

  expect(events).toEqual([
    "choose-locale", "persist-locale:zh-CN", "terminal-locale:zh-CN", "skill-boundary", "skill-audit",
    "webhook-choice", "webhook-apply", "model-choice", "models-apply", "summary",
  ]);
  expect(result).toMatchObject({
    status: "complete", locale: { status: "configured", value: "zh-CN" },
    skills: { status: "acknowledged", auditStatus: "complete", externalCount: 0 },
    webhook: { status: "preserved" }, modelSetup: { status: "configured" },
  });
  expect(ui.confirmSkillRisk).not.toHaveBeenCalled();
});

test("default-No Skill risk refusal stops webhook and model changes", async () => {
  const ui = terminal({ confirmSkillRisk: vi.fn(async () => false) });
  const applyWebhook = vi.fn();
  const setupModels = vi.fn();
  const result = await runCompleteConfiguration({
    initialLocale: "en", terminal: ui, persistLocale: vi.fn(),
    auditSkills: async () => ({ ...cleanAudit, status: "partial", externalCount: 1, skills: [{ name: "external", scope: "project", source: "settings", path: "$PROJECT/.pi/skills/external/SKILL.md", evidence: "resolved" }] }),
    applyWebhook, setupModels,
  });

  expect(result).toMatchObject({
    status: "canceled", skills: { status: "declined", auditStatus: "partial" },
    webhook: { status: "not_started" }, modelSetup: { status: "not_started" },
    followUps: ["horsepower configure --interactive"],
  });
  expect(applyWebhook).not.toHaveBeenCalled();
  expect(setupModels).not.toHaveBeenCalled();
});

test("installer context reuses its pre-activation gate without suppressing boundary education", async () => {
  const ui = terminal();
  const auditSkills = vi.fn();
  const result = await runCompleteConfiguration({
    initialLocale: "en", terminal: ui, installerContext: true, persistLocale: vi.fn(), auditSkills,
    applyWebhook: async () => "skipped", setupModels: async () => "skipped",
  });

  expect(ui.chooseLocale).not.toHaveBeenCalled();
  expect(ui.showSkillBoundary).toHaveBeenCalledWith("en");
  expect(auditSkills).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    status: "incomplete", skills: { status: "preconfirmed" },
    modelSetup: { status: "skipped", followUp: "horsepower setup --interactive" },
  });
});

test("terminal cancellation before locale persistence points back to complete configuration", async () => {
  const ui = terminal({ chooseLocale: vi.fn(async () => undefined) });
  const persistLocale = vi.fn();
  const result = await runCompleteConfiguration({
    initialLocale: "en", terminal: ui, persistLocale, auditSkills: vi.fn(),
    applyWebhook: vi.fn(), setupModels: vi.fn(),
  });

  expect(result).toMatchObject({
    status: "canceled", locale: { status: "preserved", value: "en" }, skills: { status: "not_started" },
    followUps: ["horsepower configure --interactive"],
  });
  expect(persistLocale).not.toHaveBeenCalled();
});
