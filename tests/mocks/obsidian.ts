import { vi } from "vitest";

let mockLanguage = "en";

export function getLanguage(): string {
  return mockLanguage;
}

// Inject Obsidian's prototype monkeypatches for test environment
if (typeof window !== "undefined") {
  (globalThis as any).activeWindow = window;
  (globalThis as any).activeDocument = document;
  if (!window.crypto) {
    (window as any).crypto = {};
  }
  window.crypto.getRandomValues = function <T extends ArrayBufferView>(array: T): T {
    const uint8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < uint8.length; i++) {
      uint8[i] = Math.floor(Math.random() * 256);
    }
    return array;
  };
  if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
    (Range.prototype as any).getClientRects = (): DOMRectList => [] as unknown as DOMRectList;
  }
  (HTMLElement.prototype as any).empty = function (): void {
    this.innerHTML = "";
  };
  (HTMLElement.prototype as any).setText = function (text: string): void {
    this.textContent = text;
  };
  (HTMLElement.prototype as any).hasClass = function (className: string): boolean {
    return this.classList.contains(className);
  };
  (HTMLElement.prototype as any).instanceOf = function (constructor: typeof HTMLElement): boolean {
    return this instanceof constructor;
  };

  (HTMLElement.prototype as any).createDiv = function (attrs?: any): HTMLElement {
    const div = document.createElement("div");
    if (attrs?.cls) {
      div.className = attrs.cls;
    }
    if (attrs?.text) {
      div.innerText = attrs.text;
    }
    if (attrs?.attr) {
      for (const [k, v] of Object.entries(attrs.attr)) {
        div.setAttribute(k, String(v));
      }
    }
    this.appendChild(div);
    return div;
  };

  (HTMLElement.prototype as any).createSpan = function (attrs?: any): HTMLElement {
    const span = document.createElement("span");
    if (attrs?.cls) {
      span.className = attrs.cls;
    }
    if (attrs?.text) {
      span.innerText = attrs.text;
    }
    this.appendChild(span);
    return span;
  };

  (HTMLElement.prototype as any).createEl = function (tag: string, attrs?: any): HTMLElement {
    const el = document.createElement(tag);
    if (attrs?.cls) {
      el.className = attrs.cls;
    }
    if (attrs?.text) {
      el.innerText = attrs.text;
    }
    if (attrs?.attr) {
      for (const [k, v] of Object.entries(attrs.attr)) {
        el.setAttribute(k, String(v));
      }
    }
    this.appendChild(el);
    return el;
  };

  (Document.prototype as any).createEl = function (tag: string, attrs?: any): HTMLElement {
    const el = document.createElement(tag);
    if (attrs?.cls) {
      el.className = attrs.cls;
    }
    if (attrs?.text) {
      el.innerText = attrs.text;
    }
    if (attrs?.attr) {
      for (const [k, v] of Object.entries(attrs.attr)) {
        el.setAttribute(k, String(v));
      }
    }
    return el;
  };
}

export const loadedComponents = new Set<any>();
export const unloadedComponents = new Set<any>();

export class Component {
  private readonly cleanupCallbacks: (() => void)[] = [];

  public load(): void {
    loadedComponents.add(this);
  }

  public unload(): void {
    for (const cleanup of this.cleanupCallbacks.splice(0)) {
      cleanup();
    }
    unloadedComponents.add(this);
  }

  public register(cleanup: () => void): void {
    this.cleanupCallbacks.push(cleanup);
  }

  public registerDomEvent(
    target: Document | Window | HTMLElement,
    type: string,
    callback: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, callback, options);
    this.cleanupCallbacks.push(() => target.removeEventListener(type, callback, options));
  }
}

export class FileView {
  public contentEl = document.createElement("div");
  public file: any = null;
  public app: any = null;
  public leaf: any = null;
  constructor(leaf: any) {
    this.leaf = leaf;
  }
  public async onLoadFile(file: any): Promise<void> {
    this.file = file;
  }
  public async onUnloadFile(_file: any): Promise<void> {
    this.file = null;
  }
  public async onClose(): Promise<void> {}
  public async onOpen(): Promise<void> {}
}

export const setIcon = vi.fn();

export const Platform = {
  isMacOS: false,
  isWin: true,
  isLinux: false,
  isDesktop: true,
  isDesktopApp: true,
  isMobile: false
};

export const MarkdownRenderer = {
  render: vi.fn(async (_app: any, markdown: string, el: HTMLElement) => {
    const wikiLink = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(markdown);
    if (!wikiLink) {
      el.innerText = markdown;
      return;
    }

    const [, href, alias] = wikiLink;
    el.createEl("a", {
      text: alias ?? href ?? "",
      cls: "internal-link",
      attr: { "data-href": href ?? "" }
    });
  })
};

export class TFile {
  public path = "";
  public name = "";
  public basename = "";
  public extension = "md";
}

export class WorkspaceLeaf {
  public view: any = null;
  public readonly setViewStateCalls: { state: any; eState?: unknown }[] = [];

  public async setViewState(state: any, eState?: unknown): Promise<void> {
    this.setViewStateCalls.push({ state, eState });
  }
}

export const menus: Menu[] = [];

export class MenuItem {
  public title = "";
  public checked = false;
  public onClickCallback: (() => void) | null = null;

  public setTitle(title: string): this {
    this.title = title;
    return this;
  }

  public setChecked(checked: boolean): this {
    this.checked = checked;
    return this;
  }

  public onClick(callback: () => void): this {
    this.onClickCallback = callback;
    return this;
  }
}

export class Menu {
  public readonly items: MenuItem[] = [];

  constructor() {
    menus.push(this);
  }

  public addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }

  public showAtPosition(_position: unknown, _doc?: Document): this {
    return this;
  }
}

export class Plugin {
  public readonly registeredEvents: any[] = [];
  public readonly registeredCleanups: (() => void)[] = [];
  public readonly registeredViews: { type: string; creator: (leaf: WorkspaceLeaf) => unknown }[] = [];
  public readonly registeredCommands: any[] = [];

  constructor(public app: any, _manifest?: unknown) {}

  public async onload(): Promise<void> {}
  public onunload(): void {}

  public async loadData(): Promise<unknown> {
    return null;
  }

  public async saveData(_data: unknown): Promise<void> {}

  public registerView(type: string, creator: (leaf: WorkspaceLeaf) => unknown): void {
    this.registeredViews.push({ type, creator });
  }

  public registerEvent(eventRef: any): void {
    this.registeredEvents.push(eventRef);
  }

  public register(cleanup: () => void): void {
    this.registeredCleanups.push(cleanup);
  }

  public addSettingTab(_tab: unknown): void {}
  public addCommand(command: unknown): void {
    this.registeredCommands.push(command);
  }
  public addRibbonIcon(_icon: string, _title: string, _callback: () => void): void {}

  public unload(): void {
    for (const cleanup of this.registeredCleanups.splice(0)) {
      cleanup();
    }
  }
}

const mockLocalStorage = new Map<string, any>();
export const notices: Notice[] = [];

export class App {
  public readonly hotkeyManager = {
    getHotkeys: vi.fn((_commandId: string) => undefined),
    getDefaultHotkeys: vi.fn((commandId: string) => {
      if (commandId === "editor:toggle-bold") return [{ modifiers: ["Mod"], key: "B" }];
      if (commandId === "editor:toggle-italics") return [{ modifiers: ["Mod"], key: "I" }];
      if (commandId === "editor:insert-link") return [{ modifiers: ["Mod"], key: "K" }];
      return [];
    })
  };

  public readonly workspace = {
    getActiveFile: vi.fn(() => null)
  };

  public readonly vault = {
    createBinary: vi.fn(async (path: string, _buffer: ArrayBuffer) => {
      const file = new TFile();
      file.path = path;
      file.name = path.split("/").at(-1) ?? path;
      const extensionIndex = file.name.lastIndexOf(".");
      file.basename = extensionIndex === -1 ? file.name : file.name.slice(0, extensionIndex);
      file.extension = extensionIndex === -1 ? "" : file.name.slice(extensionIndex + 1);
      return file;
    })
  };

  public readonly fileManager = {
    getAvailablePathForAttachment: vi.fn(async (fileName: string) => `attachments/${fileName}`),
    generateMarkdownLink: vi.fn((file: TFile) => `[[${file.path}]]`)
  };

  public loadLocalStorage(key: string): any {
    return mockLocalStorage.get(key) ?? null;
  }
  public saveLocalStorage(key: string, value: any): void {
    if (value === null || value === undefined) {
      mockLocalStorage.delete(key);
    } else {
      mockLocalStorage.set(key, value);
    }
  }
}
export class PluginSettingTab {
  constructor(public app: any, public plugin: any) {}
}
export class Notice {
  constructor(public message: string) {
    notices.push(this);
  }
}
export class Modal {
  public titleEl = document.createElement("div");
  public contentEl = document.createElement("div");
  public modalEl = document.createElement("div");
  constructor(public app: any) {}
  public open(): void {
    this.onOpen();
  }
  public close(): void {
    this.onClose();
  }
  public onOpen(): void {}
  public onClose(): void {}
}

export class ItemView {
  constructor(public leaf: any) {}
}

export const registeredButtons = new Set<any>();
export const registeredTextAreas = new Set<any>();

export class Setting {
  public settingEl = document.createElement("div");
  public controlEl = document.createElement("div");
  private readonly infoEl = document.createElement("div");
  private readonly nameEl = document.createElement("div");
  private readonly descEl = document.createElement("div");

  constructor(public containerEl: HTMLElement) {
    this.settingEl.className = "setting-item";
    this.infoEl.className = "setting-item-info";
    this.nameEl.className = "setting-item-name";
    this.descEl.className = "setting-item-description";
    this.controlEl.className = "setting-item-control";
    this.infoEl.append(this.nameEl, this.descEl);
    this.settingEl.append(this.infoEl, this.controlEl);
    this.containerEl.appendChild(this.settingEl);
  }
  public setHeading(): this {
    this.settingEl.classList.add("setting-item-heading");
    return this;
  }
  public setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }
  public setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }
  public addDropdown(cb: (dropdown: any) => void): this {
    const selectEl = document.createElement("select");
    this.controlEl.appendChild(selectEl);
    cb({
      selectEl,
      addOption(value: string, label: string) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        selectEl.appendChild(option);
        return this;
      },
      setValue(value: string) {
        selectEl.value = value;
        return this;
      },
      setDisabled(value: boolean) {
        selectEl.disabled = value;
        return this;
      },
      onChange(callback: (value: string) => void) {
        selectEl.addEventListener("change", () => callback(selectEl.value));
        return this;
      }
    });
    return this;
  }
  public addToggle(cb: (toggle: any) => void): this {
    const inputEl = document.createElement("input");
    inputEl.type = "checkbox";
    this.controlEl.appendChild(inputEl);
    cb({
      inputEl,
      setValue(value: boolean) {
        inputEl.checked = value;
        return this;
      },
      onChange(callback: (value: boolean) => void) {
        inputEl.addEventListener("change", () => callback(inputEl.checked));
        return this;
      }
    });
    return this;
  }
  public addButton(cb: (btn: any) => void): this {
    const btn = {
      buttonEl: document.createElement("button"),
      setButtonText: function () {
        return this;
      },
      setCta: function () {
        return this;
      },
      setWarning: function () {
        return this;
      },
      onClick: function (onClickCb: () => void) {
        (this as any)._onClick = onClickCb;
        return this;
      },
      _onClick: () => {}
    };
    registeredButtons.add(btn);
    cb(btn);
    return this;
  }
  public addTextArea(cb: (text: any) => void): this {
    const txt = {
      inputEl: document.createElement("textarea"),
      setValue: function () {
        return this;
      },
      onChange: function (onChangeCb: (val: string) => void) {
        (this as any)._onChange = onChangeCb;
        return this;
      },
      _onChange: (_val: string) => {}
    };
    registeredTextAreas.add(txt);
    cb(txt);
    return this;
  }
}

export const _testState = {
  loadedComponents,
  unloadedComponents,
  registeredButtons,
  registeredTextAreas,
  notices,
  menus,
  mockLocalStorage,
  get language(): string {
    return mockLanguage;
  },
  set language(value: string) {
    mockLanguage = value;
  }
};

export function htmlToMarkdown(html: string | HTMLElement): string {
  if (typeof html === "string") {
    return html;
  }
  return html.innerText || html.innerHTML || "";
}
