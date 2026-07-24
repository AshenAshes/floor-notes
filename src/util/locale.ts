declare function getLanguage(): string;

interface GlobalWithMoment {
  moment?: {
    locale: () => string;
  };
}

import en from "../locales/en.json";
import zhCn from "../locales/zh-cn.json";

let currentLocale = "en";

export function setLocale(locale: "en" | "zh-cn" | "auto"): void {
  if (locale === "auto") {
    let lang = "en";
    let userLang = "";
    
    const globalMoment = (typeof activeWindow !== "undefined" ? (activeWindow as unknown as GlobalWithMoment).moment : undefined);
    if (globalMoment && typeof globalMoment.locale === "function") {
      userLang = globalMoment.locale();
    }
    
    if (!userLang && typeof getLanguage === "function") {
      userLang = getLanguage();
    }
    
    if (userLang) {
      userLang = userLang.toLowerCase();
      if (userLang.startsWith("zh")) {
        lang = "zh-cn";
      }
    }
    currentLocale = lang;
  } else {
    currentLocale = locale;
  }
}

export function t(key: keyof typeof en): string {
  const dict = currentLocale === "zh-cn" ? zhCn : en;
  return dict[key] || en[key] || String(key);
}
