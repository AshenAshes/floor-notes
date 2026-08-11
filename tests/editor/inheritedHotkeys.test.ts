import { beforeEach, describe, expect, it, vi } from "vitest";
import { App, Platform } from "obsidian";
import { readInheritedFormattingHotkeys } from "../../src/editor/inheritedHotkeys";

interface HotkeyValue {
  readonly modifiers: readonly string[];
  readonly key: string;
}

function installHotkeyManager(
  app: App,
  custom: ReadonlyMap<string, readonly HotkeyValue[]>,
  defaults: ReadonlyMap<string, readonly HotkeyValue[]>
) {
  const getHotkeys = vi.fn((commandId: string) => custom.has(commandId)
    ? custom.get(commandId)
    : undefined);
  const getDefaultHotkeys = vi.fn((commandId: string) => defaults.get(commandId) ?? []);
  Reflect.set(app, "hotkeyManager", { getHotkeys, getDefaultHotkeys });
  return { getHotkeys, getDefaultHotkeys };
}

describe("inherited formatting hotkeys", () => {
  beforeEach(() => {
    Reflect.set(Platform, "isMacOS", false);
  });

  it("uses the complete custom array, preserves an explicit empty array, and otherwise uses defaults", () => {
    const app = new App();
    const manager = installHotkeyManager(
      app,
      new Map([
        ["editor:toggle-bold", [
          { modifiers: ["Mod"], key: "B" },
          { modifiers: ["Alt"], key: "B" }
        ]],
        ["editor:toggle-italics", []]
      ]),
      new Map([
        ["editor:toggle-bold", [{ modifiers: ["Mod"], key: "B" }]],
        ["editor:toggle-italics", [{ modifiers: ["Mod"], key: "I" }]],
        ["editor:insert-link", [{ modifiers: ["Mod"], key: "K" }]]
      ])
    );

    const snapshot = readInheritedFormattingHotkeys(app);

    expect(snapshot.hasIssues).toBe(false);
    expect(snapshot.bindings.bold.map((binding) => binding.key)).toEqual(["Mod-b", "Alt-b"]);
    expect(snapshot.bindings.bold.map((binding) => binding.display)).toEqual(["Ctrl + B", "Alt + B"]);
    expect(snapshot.bindings.bold.map((binding) => binding.aria)).toEqual(["Control+B", "Alt+B"]);
    expect(snapshot.bindings.italic).toEqual([]);
    expect(snapshot.bindings.strikethrough).toEqual([]);
    expect(snapshot.bindings.link.map((binding) => binding.key)).toEqual(["Mod-k"]);
    expect(manager.getDefaultHotkeys).not.toHaveBeenCalledWith("editor:toggle-bold");
    expect(manager.getDefaultHotkeys).not.toHaveBeenCalledWith("editor:toggle-italics");
    expect(manager.getDefaultHotkeys).toHaveBeenCalledWith("editor:insert-link");
  });

  it("rejects unsupported bindings and removes protected or ambiguous combinations", () => {
    const app = new App();
    installHotkeyManager(
      app,
      new Map([
        ["editor:toggle-bold", [{ modifiers: ["Mod"], key: "I" }]],
        ["editor:toggle-italics", [{ modifiers: ["Ctrl"], key: "I" }]],
        ["editor:toggle-strikethrough", [
          { modifiers: [], key: "x" },
          { modifiers: [], key: "F5" }
        ]],
        ["editor:insert-link", [{ modifiers: ["Mod"], key: "Enter" }]]
      ]),
      new Map()
    );

    const snapshot = readInheritedFormattingHotkeys(app);

    expect(snapshot.hasIssues).toBe(true);
    expect(snapshot.bindings.bold).toEqual([]);
    expect(snapshot.bindings.italic).toEqual([]);
    expect(snapshot.bindings.strikethrough.map((binding) => binding.key)).toEqual(["F5"]);
    expect(snapshot.bindings.link).toEqual([]);
  });

  it("fails closed when the private hotkey manager is unavailable", () => {
    const app = new App();
    Reflect.deleteProperty(app, "hotkeyManager");
    const snapshot = readInheritedFormattingHotkeys(app);

    expect(snapshot.hasIssues).toBe(true);
    expect(snapshot.bindings).toEqual({
      bold: [],
      italic: [],
      strikethrough: [],
      link: []
    });
  });

  it("formats inherited bindings for macOS tooltips and aria-keyshortcuts", () => {
    Reflect.set(Platform, "isMacOS", true);
    const app = new App();
    installHotkeyManager(
      app,
      new Map([
        ["editor:toggle-bold", [
          { modifiers: ["Mod", "Shift"], key: "B" },
          { modifiers: ["Ctrl"], key: "B" }
        ]]
      ]),
      new Map()
    );

    const snapshot = readInheritedFormattingHotkeys(app);

    expect(snapshot.bindings.bold.map((binding) => binding.display)).toEqual(["⌘ ⇧ B", "⌃ B"]);
    expect(snapshot.bindings.bold.map((binding) => binding.aria)).toEqual(["Meta+Shift+B", "Control+B"]);
  });
});
