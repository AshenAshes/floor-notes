import { getLanguage } from "obsidian";
import en from "../locales/en.json";
import zhCn from "../locales/zh-cn.json";

let currentLocale = "en";

export function setLocale(locale: "en" | "zh-cn" | "auto"): void {
  if (locale === "auto") {
    const userLanguage = getLanguage().toLowerCase();
    currentLocale = userLanguage.startsWith("zh") ? "zh-cn" : "en";
  } else {
    currentLocale = locale;
  }
}

export function t(key: keyof typeof en): string {
  const dict = currentLocale === "zh-cn" ? zhCn : en;
  return dict[key] || en[key] || String(key);
}
