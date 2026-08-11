import { App, Platform } from "obsidian";
import { FORMATTING_COMMANDS, FormattingCommandId } from "./formattingCommands";

const CORE_COMMAND_IDS: Readonly<Record<FormattingCommandId, string>> = {
  bold: "editor:toggle-bold",
  italic: "editor:toggle-italics",
  strikethrough: "editor:toggle-strikethrough",
  link: "editor:insert-link"
};

const MODIFIER_ORDER = ["Mod", "Ctrl", "Meta", "Alt", "Shift"] as const;
const MODIFIER_NAMES = new Set<string>(MODIFIER_ORDER);
const PURE_MODIFIER_KEYS = new Set(["Control", "Ctrl", "Alt", "Shift", "Meta", "Mod"]);

type ModifierName = typeof MODIFIER_ORDER[number];

interface ParsedHotkey {
  readonly modifiers: readonly ModifierName[];
  readonly key: string;
}

export interface ResolvedHotkey {
  readonly key: string;
  readonly display: string;
  readonly aria: string;
}

export interface InheritedFormattingHotkeys {
  readonly bindings: Readonly<Record<FormattingCommandId, readonly ResolvedHotkey[]>>;
  readonly hasIssues: boolean;
}

function emptyBindings(): Record<FormattingCommandId, ResolvedHotkey[]> {
  return {
    bold: [],
    italic: [],
    strikethrough: [],
    link: []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeKey(value: string): string {
  if (value === " ") {
    return "Space";
  }
  if (/^Key[A-Z]$/.test(value)) {
    return value.slice(3);
  }
  if (/^[a-z]$/.test(value)) {
    return value.toUpperCase();
  }
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(value)) {
    return value.toUpperCase();
  }
  return value;
}

function parseHotkey(value: unknown): ParsedHotkey | null {
  if (!isRecord(value) || !Array.isArray(value.modifiers)) {
    return null;
  }

  const rawKey = typeof value.key === "string"
    ? value.key
    : typeof value.code === "string"
      ? value.code
      : null;
  if (!rawKey || (rawKey.trim() === "" && rawKey !== " ") || PURE_MODIFIER_KEYS.has(rawKey)) {
    return null;
  }

  const modifiers: ModifierName[] = [];
  for (const modifier of value.modifiers) {
    if (typeof modifier !== "string" || !MODIFIER_NAMES.has(modifier)) {
      return null;
    }
    const typedModifier = modifier as ModifierName;
    if (modifiers.includes(typedModifier)) {
      return null;
    }
    modifiers.push(typedModifier);
  }
  modifiers.sort((left, right) => MODIFIER_ORDER.indexOf(left) - MODIFIER_ORDER.indexOf(right));

  const key = normalizeKey(rawKey);
  const isBareFunctionKey = modifiers.length === 0 && /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key);
  const isShiftLetter = modifiers.length === 1
    && modifiers[0] === "Shift"
    && /^[A-Z]$/.test(key);
  if ((modifiers.length === 0 && !isBareFunctionKey) || isShiftLetter) {
    return null;
  }

  return { modifiers, key };
}

function callPrivateMethod(target: object, methodName: string, commandId: string): unknown {
  const method = Reflect.get(target, methodName) as unknown;
  if (typeof method !== "function") {
    throw new Error(`Missing private hotkey method: ${methodName}`);
  }
  return Reflect.apply(method, target, [commandId]) as unknown;
}

function resolvePlatformModifiers(modifiers: readonly ModifierName[]): readonly string[] {
  return modifiers.map((modifier) => {
    if (modifier === "Mod") {
      return Platform.isMacOS ? "Meta" : "Ctrl";
    }
    return modifier;
  });
}

function identityOf(hotkey: ParsedHotkey): string {
  const modifiers = Array.from(new Set(resolvePlatformModifiers(hotkey.modifiers)))
    .sort()
    .join("+");
  return `${modifiers}|${hotkey.key.toUpperCase()}`;
}

function keyNameOf(hotkey: ParsedHotkey): string {
  const codeMirrorKey = /^[A-Z]$/.test(hotkey.key) && !hotkey.modifiers.includes("Shift")
    ? hotkey.key.toLowerCase()
    : hotkey.key;
  return [...hotkey.modifiers, codeMirrorKey].join("-");
}

function displayOf(hotkey: ParsedHotkey): string {
  const keyParts = hotkey.modifiers.map((modifier) => {
    if (Platform.isMacOS) {
      const macNames: Readonly<Record<ModifierName, string>> = {
        Mod: "⌘",
        Ctrl: "⌃",
        Meta: "⌘",
        Alt: "⌥",
        Shift: "⇧"
      };
      return macNames[modifier];
    }
    const desktopNames: Readonly<Record<ModifierName, string>> = {
      Mod: "Ctrl",
      Ctrl: "Ctrl",
      Meta: "Win",
      Alt: "Alt",
      Shift: "Shift"
    };
    return desktopNames[modifier];
  });
  const directionalKeys: Readonly<Record<string, string>> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓"
  };
  const displayKey = directionalKeys[hotkey.key]
    ?? hotkey.key.replace(/([a-z])([A-Z])/g, "$1 $2");
  return [...keyParts, displayKey].join(Platform.isMacOS ? " " : " + ");
}

function ariaOf(hotkey: ParsedHotkey): string {
  const ariaModifiers = hotkey.modifiers.map((modifier) => {
    const ariaNames: Readonly<Record<ModifierName, string>> = {
      Mod: Platform.isMacOS ? "Meta" : "Control",
      Ctrl: "Control",
      Meta: "Meta",
      Alt: "Alt",
      Shift: "Shift"
    };
    return ariaNames[modifier];
  });
  return [...ariaModifiers, hotkey.key].join("+");
}

export function readInheritedFormattingHotkeys(app: App): InheritedFormattingHotkeys {
  const bindings = emptyBindings();
  const parsed = new Map<FormattingCommandId, ParsedHotkey[]>();
  let hasIssues = false;

  try {
    const manager = Reflect.get(app, "hotkeyManager") as unknown;
    if (!isRecord(manager)) {
      throw new Error("Private hotkey manager is unavailable");
    }

    for (const command of FORMATTING_COMMANDS) {
      const commandId = CORE_COMMAND_IDS[command];
      const custom = callPrivateMethod(manager, "getHotkeys", commandId);
      const effectiveValue = custom !== undefined
        ? custom
        : callPrivateMethod(manager, "getDefaultHotkeys", commandId);
      const effective = effectiveValue === undefined ? [] : effectiveValue;
      if (!Array.isArray(effective)) {
        throw new Error(`Invalid private hotkey response for ${commandId}`);
      }

      const commandBindings: ParsedHotkey[] = [];
      const seen = new Set<string>();
      for (const candidate of effective) {
        const hotkey = parseHotkey(candidate);
        if (!hotkey) {
          hasIssues = true;
          continue;
        }
        if (new Set(resolvePlatformModifiers(hotkey.modifiers)).size !== hotkey.modifiers.length) {
          hasIssues = true;
          continue;
        }
        const identity = identityOf(hotkey);
        if (seen.has(identity)) {
          hasIssues = true;
          continue;
        }
        seen.add(identity);
        commandBindings.push(hotkey);
      }
      parsed.set(command, commandBindings);
    }
  } catch {
    return { bindings, hasIssues: true };
  }

  const protectedSubmitIdentity = identityOf({ modifiers: ["Mod"], key: "Enter" });
  const owners = new Map<string, Set<FormattingCommandId>>();
  for (const [command, hotkeys] of parsed) {
    for (const hotkey of hotkeys) {
      const identity = identityOf(hotkey);
      const commands = owners.get(identity) ?? new Set<FormattingCommandId>();
      commands.add(command);
      owners.set(identity, commands);
    }
  }

  for (const command of FORMATTING_COMMANDS) {
    for (const hotkey of parsed.get(command) ?? []) {
      const identity = identityOf(hotkey);
      if (identity === protectedSubmitIdentity || (owners.get(identity)?.size ?? 0) > 1) {
        hasIssues = true;
        continue;
      }
      bindings[command].push({
        key: keyNameOf(hotkey),
        display: displayOf(hotkey),
        aria: ariaOf(hotkey)
      });
    }
  }

  return { bindings, hasIssues };
}
