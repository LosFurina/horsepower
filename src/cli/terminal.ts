import { appendFile, open, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { SetupAction, SetupTerminal } from "./setup.js";
import type { ThinkingLevel } from "../slots/registry.js";
import { message, type OutputLocale } from "../localization/index.js";
import type { CompleteConfigurationResult, CompleteConfigurationTerminal, WebhookConfigurationInput } from "./configuration.js";

interface TerminalStreams {
  input: Readable;
  output: Writable;
  close(): Promise<void>;
}

async function terminalStreams(): Promise<TerminalStreams | undefined> {
  if (process.stdin.isTTY && process.stderr.isTTY) {
    return { input: process.stdin, output: process.stderr, close: async () => undefined };
  }
  try {
    const tty = await open("/dev/tty", "r+");
    return {
      input: tty.createReadStream({ autoClose: false }),
      output: tty.createWriteStream({ autoClose: false }),
      close: async () => tty.close(),
    };
  } catch {
    return undefined;
  }
}

async function select<T extends string>(
  question: (prompt: string) => Promise<string | undefined>,
  write: (text: string) => Promise<void>,
  locale: OutputLocale,
  prompt: string,
  choices: readonly T[],
  options: { defaultChoice?: T; showChoices?: boolean } = {},
): Promise<T | undefined> {
  if (options.showChoices !== false) {
    const rendered = choices.map((choice, index) => {
      const marker = choice === options.defaultChoice ? (locale === "zh-CN" ? "（默认）" : " (default)") : "";
      return `  ${index + 1}. ${choice}${marker}`;
    }).join("\n");
    await write(`${rendered}\n`);
  }
  for (;;) {
    const answer = await question(prompt);
    if (answer === undefined) return undefined;
    if (answer === "" && options.defaultChoice) return options.defaultChoice;
    const byNumber = /^\d+$/u.test(answer) ? choices[Number(answer) - 1] : undefined;
    const choice = byNumber ?? choices.find((candidate) => candidate === answer);
    if (choice) return choice;
    await write(`${message(locale, "setup.invalidSelection", { count: choices.length })}\n`);
  }
}

export function createSetupTerminal(initialLocale: OutputLocale = "en"): SetupTerminal & CompleteConfigurationTerminal {
  const configuredInput = process.env.HORSEPOWER_TTY_INPUT;
  const configuredOutput = process.env.HORSEPOWER_TTY_OUTPUT;
  const injectedInput = configuredInput && configuredInput !== "/dev/tty" ? configuredInput : undefined;
  const injectedOutput = configuredOutput && configuredOutput !== "/dev/tty" ? configuredOutput : undefined;
  const injectedOffset = Number(process.env.HORSEPOWER_TTY_INPUT_OFFSET ?? "0");
  let injectedAnswers: Promise<string[]> | undefined;
  let locale = initialLocale;
  const write = async (text: string): Promise<void> => {
    if (injectedOutput) await appendFile(injectedOutput, text);
    else if (configuredOutput === "/dev/tty") {
      try {
        const tty = await open(configuredOutput, "a");
        try { await tty.writeFile(text); } finally { await tty.close(); }
      } catch { process.stderr.write(text); }
    } else process.stderr.write(text);
  };
  const question = async (prompt: string): Promise<string | undefined> => {
    if (injectedInput && injectedOutput) {
      injectedAnswers ??= readFile(injectedInput, "utf8").then((value) => value.split(/\r?\n/u).slice(Number.isSafeInteger(injectedOffset) && injectedOffset > 0 ? injectedOffset : 0));
      await appendFile(injectedOutput, prompt);
      const next = (await injectedAnswers).shift();
      if (next === undefined) return undefined;
      const answer = next.trim();
      return answer.toLowerCase() === "cancel" ? undefined : answer;
    }
    const streams = await terminalStreams();
    if (!streams) return undefined;
    const readline = createInterface({ input: streams.input, output: streams.output });
    try {
      const answer = (await readline.question(prompt)).trim();
      return answer.toLowerCase() === "cancel" ? undefined : answer;
    } finally {
      readline.close();
      await streams.close();
    }
  };
  return {
    async isAvailable() {
      if (injectedInput && injectedOutput) return true;
      if (process.stdin.isTTY && process.stderr.isTTY) return true;
      try { const tty = await open("/dev/tty", "r+"); await tty.close(); return true; } catch { return false; }
    },
    setLocale(next) { locale = next; },
    async showModels(modelIds) {
      await write(`${message(locale, "setup.modelsHeading")}\n${modelIds.map((model, index) => `  ${index + 1}. ${model}`).join("\n")}\n`);
    },
    chooseModel({ slot, modelIds }) {
      return select(question, write, locale, message(locale, "setup.chooseModel", { slot }), modelIds, { showChoices: false });
    },
    chooseThinking({ slot, thinkingLevels }) {
      const defaultChoice = thinkingLevels.includes("medium") ? "medium" : thinkingLevels[0];
      return select<ThinkingLevel>(question, write, locale, message(locale, "setup.chooseThinking", { slot, choices: thinkingLevels.join(", ") }), thinkingLevels, { ...(defaultChoice ? { defaultChoice } : {}) });
    },
    chooseProbeAction({ result }) {
      const actions: readonly SetupAction[] = result.status === "inconclusive"
        ? ["retry", "reselect", "skip", "cancel"]
        : ["reselect", "skip", "cancel"];
      return select(question, write, locale, message(locale, "setup.capabilityAction", { status: result.status, code: result.evidence.code, actions: actions.join("/") }), actions);
    },
    chooseLocale() {
      return select(question, write, locale, message(locale, "configure.chooseLocale"), ["en", "zh-CN"] as const);
    },
    showSkillBoundary(current) { return write(`${message(current, "configure.skillBoundary")}\n`); },
    async showSkillAudit(current, audit) {
      await write(`${message(current, "audit.summary", { status: audit.status, count: audit.externalCount })}\n`);
      for (const skill of audit.skills) await write(`- ${skill.name} | ${skill.scope} | ${skill.source} | ${skill.path} | ${skill.evidence}\n`);
    },
    async confirmSkillRisk(current) {
      const answer = await question(message(current, "configure.auditRisk"));
      return answer === "y" || answer === "Y" || answer?.toLowerCase() === "yes";
    },
    async chooseWebhookAction(current, existing) {
      const actions = existing ? ["preserve", "configure", "disable", "cancel"] as const : ["skip", "configure", "disable", "cancel"] as const;
      return (await select(question, write, current, message(current, "configure.webhookAction", { actions: actions.join("/") }), actions, { defaultChoice: actions[0] })) ?? "cancel";
    },
    async readWebhookConfiguration(current): Promise<WebhookConfigurationInput | undefined> {
      const url = await question(message(current, "configure.webhookUrl"));
      if (!url) return undefined;
      const mode = (await select(question, write, current, message(current, "configure.webhookAuth"), ["hmac", "bearer", "none"] as const)) ?? "hmac";
      let auth: WebhookConfigurationInput["auth"];
      if (mode === "hmac") {
        const credentialValue = await question(message(current, "configure.webhookSecret")); if (!credentialValue) return undefined; auth = { mode, secret: credentialValue };
      } else if (mode === "bearer") {
        const credentialValue = await question(message(current, "configure.webhookToken")); if (!credentialValue) return undefined; auth = { mode, token: credentialValue };
      } else auth = { mode };
      const dispatch = await question(message(current, "configure.webhookDispatch"));
      return { url, auth, dispatch: dispatch === "y" || dispatch === "Y" || dispatch?.toLowerCase() === "yes" };
    },
    async chooseModelAction(current) {
      return (await select(question, write, current, message(current, "configure.modelAction"), ["configure", "skip", "cancel"] as const, { defaultChoice: "configure" })) ?? "cancel";
    },
    showConfigurationSummary(current, result: CompleteConfigurationResult) {
      return write(`${message(current, "configure.summary", { status: result.status })}\n${result.followUps.map((command) => `${message(current, "configure.next", { command })}\n`).join("")}`);
    },
  };
}
