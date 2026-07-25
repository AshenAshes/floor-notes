import type { FloorNotesMode, FloorNotesTheme } from "../theme";

export const THREAD_VIEW_STYLES = ["bubble", "glass", "paper", "timeline"] as const;
export const PREFERRED_NEWLINES = ["LF", "CRLF", "auto"] as const;
export const DEFAULT_SORT_ORDERS = ["asc", "desc"] as const;
export const LOCALES = ["en", "zh-cn", "auto"] as const;

export type ThreadViewStyle = (typeof THREAD_VIEW_STYLES)[number];
export type PreferredNewline = (typeof PREFERRED_NEWLINES)[number];

export function isThreadViewStyle(value: unknown): value is ThreadViewStyle {
  return typeof value === "string" && (THREAD_VIEW_STYLES as readonly string[]).includes(value);
}

export function isPreferredNewline(value: unknown): value is FloorNotesSettings["preferredNewline"] {
  return typeof value === "string" && (PREFERRED_NEWLINES as readonly string[]).includes(value);
}

export function isDefaultSortOrder(value: unknown): value is FloorNotesSettings["defaultSortOrder"] {
  return typeof value === "string" && (DEFAULT_SORT_ORDERS as readonly string[]).includes(value);
}

export function isLocale(value: unknown): value is FloorNotesSettings["locale"] {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export interface FloorNotesSettings {
  readonly preferredNewline: "LF" | "CRLF" | "auto";
  readonly defaultSortOrder: "asc" | "desc";
  readonly locale: "en" | "zh-cn" | "auto";
  readonly theme: FloorNotesTheme;
  readonly mode: FloorNotesMode;
  readonly autoOpenThreadView: boolean;
  readonly defaultViewStyle: ThreadViewStyle;
}

export const DEFAULT_SETTINGS: FloorNotesSettings = {
  preferredNewline: "auto",
  defaultSortOrder: "asc",
  locale: "auto",
  theme: "obsidian",
  mode: "auto",
  autoOpenThreadView: true,
  defaultViewStyle: "bubble"
};
