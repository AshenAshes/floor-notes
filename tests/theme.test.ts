import { describe, expect, it } from "vitest";
import {
  applyThemeClasses,
  isFloorNotesMode,
  isFloorNotesTheme,
  resolveTheme,
  supportsExplicitMode,
  THEME_OPTIONS
} from "../src/theme";

describe("theme registry and application", () => {
  it("exposes the ten stable built-in themes", () => {
    expect(THEME_OPTIONS.map(({ id }) => id)).toEqual([
      "obsidian",
      "nord",
      "monokai",
      "vscode",
      "material",
      "claude",
      "dracula",
      "gruvbox",
      "solarized",
      "custom"
    ]);
    expect(supportsExplicitMode("obsidian")).toBe(false);
    expect(supportsExplicitMode("custom")).toBe(true);
    expect(isFloorNotesTheme("custom")).toBe(true);
    expect(isFloorNotesTheme("retired-theme")).toBe(false);
    expect(isFloorNotesMode("auto")).toBe(true);
    expect(isFloorNotesMode("system")).toBe(false);
  });

  it("resolves auto mode from the target element's owning document", () => {
    const popoutDocument = document.implementation.createHTMLDocument("popout");
    const target = popoutDocument.createElement("div");
    popoutDocument.body.classList.add("theme-dark");

    expect(resolveTheme("solarized", "auto", target)).toEqual({
      themeClass: "theme-solarized",
      modeClass: "mode-dark"
    });
    expect(resolveTheme("solarized", "light", target)).toEqual({
      themeClass: "theme-solarized",
      modeClass: "mode-light"
    });
  });

  it("clears old theme and mode classes before applying the current theme", () => {
    const target = document.createElement("div");
    target.classList.add("theme-nord", "theme-dracula", "mode-dark", "mode-light");

    const result = applyThemeClasses(target, "gruvbox", "light");

    expect(result).toEqual({ themeClass: "theme-gruvbox", modeClass: "mode-light" });
    expect(target.classList.contains("theme-gruvbox")).toBe(true);
    expect(target.classList.contains("mode-light")).toBe(true);
    expect(target.classList.contains("theme-nord")).toBe(false);
    expect(target.classList.contains("theme-dracula")).toBe(false);
    expect(target.classList.contains("mode-dark")).toBe(false);
  });

  it("keeps Obsidian as a host-adapted theme without a forced mode class", () => {
    const target = document.createElement("div");
    target.classList.add("theme-dracula", "mode-dark");

    expect(applyThemeClasses(target, "obsidian", "dark")).toEqual({
      themeClass: "theme-obsidian",
      modeClass: null
    });
    expect(target.classList.contains("theme-obsidian")).toBe(true);
    expect(target.classList.contains("mode-dark")).toBe(false);
  });
});
