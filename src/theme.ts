export const THEME_OPTIONS = [
  { id: "obsidian", labelKey: "themeObsidian", modeBehavior: "host" },
  { id: "nord", labelKey: "themeNord", modeBehavior: "fixed" },
  { id: "monokai", labelKey: "themeMonokai", modeBehavior: "fixed" },
  { id: "vscode", labelKey: "themeVsCode", modeBehavior: "fixed" },
  { id: "material", labelKey: "themeMaterial", modeBehavior: "fixed" },
  { id: "claude", labelKey: "themeClaude", modeBehavior: "fixed" },
  { id: "dracula", labelKey: "themeDracula", modeBehavior: "fixed" },
  { id: "gruvbox", labelKey: "themeGruvbox", modeBehavior: "fixed" },
  { id: "solarized", labelKey: "themeSolarized", modeBehavior: "fixed" },
  { id: "custom", labelKey: "themeCustom", modeBehavior: "fixed" }
] as const;

export type FloorNotesTheme = (typeof THEME_OPTIONS)[number]["id"];
export type FloorNotesMode = "auto" | "light" | "dark";

type FixedTheme = Exclude<FloorNotesTheme, "obsidian">;

export interface ThemeResolution {
  themeClass: `theme-${FloorNotesTheme}`;
  modeClass: "mode-light" | "mode-dark" | null;
}

const THEME_CLASSES = THEME_OPTIONS.map(({ id }) => `theme-${id}` as const);

export function isFloorNotesTheme(value: unknown): value is FloorNotesTheme {
  return typeof value === "string" && THEME_OPTIONS.some(({ id }) => id === value);
}

export function isFloorNotesMode(value: unknown): value is FloorNotesMode {
  return value === "auto" || value === "light" || value === "dark";
}

function isHostTheme(theme: FloorNotesTheme): boolean {
  return THEME_OPTIONS.find(({ id }) => id === theme)?.modeBehavior === "host";
}

export function supportsExplicitMode(theme: FloorNotesTheme): boolean {
  return !isHostTheme(theme);
}

export function resolveTheme(
  theme: FloorNotesTheme,
  mode: FloorNotesMode,
  el: HTMLElement
): ThemeResolution {
  const themeClass = `theme-${theme}` as const;
  if (isHostTheme(theme)) {
    return { themeClass, modeClass: null };
  }

  const resolvedMode = mode === "auto"
    ? el.ownerDocument.body.classList.contains("theme-dark") ? "dark" : "light"
    : mode;

  return {
    themeClass,
    modeClass: `mode-${resolvedMode}`
  };
}

export function applyThemeClasses(
  el: HTMLElement,
  theme: FloorNotesTheme,
  mode: FloorNotesMode
): ThemeResolution {
  el.classList.remove(...THEME_CLASSES, "mode-light", "mode-dark");

  const resolution = resolveTheme(theme, mode, el);
  el.classList.add(resolution.themeClass);
  if (resolution.modeClass) {
    el.classList.add(resolution.modeClass);
  }

  return resolution;
}

export function isFixedTheme(theme: FloorNotesTheme): theme is FixedTheme {
  return supportsExplicitMode(theme);
}
