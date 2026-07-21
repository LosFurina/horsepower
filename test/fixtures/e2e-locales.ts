import type { OutputLocale } from "../../src/localization/index.js";

export function selectedE2ELocales(environment: Readonly<Record<string, string | undefined>> = process.env): OutputLocale[] {
  const selected = environment.HORSEPOWER_E2E_LOCALE;
  if (selected === undefined || selected === "") return ["en", "zh-CN"];
  if (selected === "en" || selected === "zh-CN") return [selected];
  throw new Error(`Invalid HORSEPOWER_E2E_LOCALE: ${selected}`);
}
