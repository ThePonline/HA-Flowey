/**
 * Minimal i18n: the Dutch text is the key, EN holds the English translation.
 * Missing translations fall back to Dutch. `{name}` placeholders are filled from `vars`.
 */
import { createContext, useContext } from "react";
import { EN } from "./i18n-en";

export type Lang = "nl" | "en";
export type LangSetting = "auto" | Lang;
export type Translate = (text: string, vars?: Record<string, string | number>) => string;

/** "auto" follows the language of the user's Home Assistant profile. */
export const resolveLang = (setting: LangSetting, hassLanguage: string | undefined): Lang =>
  setting !== "auto" ? setting : hassLanguage?.toLowerCase().startsWith("nl") ? "nl" : "en";

export function makeT(lang: Lang): Translate {
  return (text, vars) => {
    const template = lang === "en" ? EN[text] ?? text : text;
    return vars ? template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match)) : template;
  };
}

export interface LangState {
  lang: Lang;
  setting: LangSetting;
  t: Translate;
  setSetting: (setting: LangSetting) => void;
}

export const LangContext = createContext<LangState>({
  lang: "nl",
  setting: "auto",
  t: makeT("nl"),
  setSetting: () => undefined,
});

export const useLang = () => useContext(LangContext);

/** "5 minuten geleden" / "5 minutes ago". */
export function timeAgo(date: string | Date, lang: Lang): string {
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}

export const useT = () => useContext(LangContext).t;
