import { appendFile, open, readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import type { SetupAction, SetupTerminal } from "./setup.js";
import type { ThinkingLevel } from "../slots/registry.js";

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

async function select<T extends string>(question: (prompt: string) => Promise<string | undefined>, prompt: string, choices: readonly T[]): Promise<T | undefined> {
  for (;;) {
    const answer = await question(prompt);
    if (answer === undefined) return undefined;
    const byNumber = /^\d+$/u.test(answer) ? choices[Number(answer) - 1] : undefined;
    const choice = byNumber ?? choices.find((candidate) => candidate === answer);
    if (choice) return choice;
    process.stderr.write(`Invalid selection. Choose 1-${choices.length}, or type cancel.\n`);
  }
}

export function createSetupTerminal(): SetupTerminal {
  const injectedInput = process.env.HORSEPOWER_TTY_INPUT;
  const injectedOutput = process.env.HORSEPOWER_TTY_OUTPUT;
  let injectedAnswers: Promise<string[]> | undefined;
  const question = async (prompt: string): Promise<string | undefined> => {
    if (injectedInput && injectedOutput) {
      injectedAnswers ??= readFile(injectedInput, "utf8").then((value) => value.split(/\r?\n/u));
      await appendFile(injectedOutput, prompt);
      const answer = ((await injectedAnswers).shift() ?? "").trim();
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
    async showModels(modelIds) {
      const text = `Current Pi models:\n${modelIds.map((model, index) => `  ${index + 1}. ${model}`).join("\n")}\n`;
      if (injectedOutput) await appendFile(injectedOutput, text);
      else process.stderr.write(text);
    },
    chooseModel({ slot, modelIds }) {
      return select(question, `Select model for ${slot} (name or number; cancel to stop): `, modelIds);
    },
    chooseThinking({ slot, thinkingLevels }) {
      return select<ThinkingLevel>(question, `Select thinking for ${slot} (${thinkingLevels.join(", ")}; cancel to stop): `, thinkingLevels);
    },
    chooseProbeAction({ result }) {
      const actions: readonly SetupAction[] = result.status === "inconclusive"
        ? ["retry", "reselect", "skip", "cancel"]
        : ["reselect", "skip", "cancel"];
      return select(question, `Capability ${result.status} (${result.evidence.code}). Choose ${actions.join("/")}: `, actions);
    },
  };
}
