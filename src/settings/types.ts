import type { FloorNotesMode, FloorNotesTheme } from "../theme";

export const THREAD_VIEW_STYLES = ["bubble", "glass", "paper", "timeline"] as const;
export type ThreadViewStyle = (typeof THREAD_VIEW_STYLES)[number];

export function isThreadViewStyle(value: unknown): value is ThreadViewStyle {
  return typeof value === "string" && (THREAD_VIEW_STYLES as readonly string[]).includes(value);
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
