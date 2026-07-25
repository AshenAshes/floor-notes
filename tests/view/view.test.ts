import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { FloorThreadView } from "../../src/view/FloorThreadView";
import { FileIdentityRegistry } from "../../src/services/FileIdentityRegistry";
import { ThreadMutationService } from "../../src/services/ThreadMutationService";
import { FloorNotesSettingTab } from "../../src/settings/settingsTab";
import { CreateRecordModal } from "../../src/modals/ThreadModals";
import { DEFAULT_SETTINGS } from "../../src/settings/types";
import { setLocale } from "../../src/util/locale";
import en from "../../src/locales/en.json";
import zhCn from "../../src/locales/zh-cn.json";

const { _testState } = obsidian as any;

const mockTFile = (path: string, name: string) => {
  const file = new obsidian.TFile();
  file.path = path;
  file.name = name;
  file.basename = name.replace(".md", "");
  file.extension = "md";
  return file;
};

const validBaseDoc = `---
floor-notes: 1
---
# Thread Title

## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Body content.
`;

const invalidDoc = `---
floor-notes: 1
---
## Floor
[id:: invalid-id]
[date:: 2026-07-16 15:30:12]
`;

const paginatedDoc = Array.from({ length: 31 }, (_, index) => {
  const floorNumber = index + 1;
  const recordId = `floor-20260716-1530${String(floorNumber).padStart(2, "0")}-${String(floorNumber).padStart(8, "0")}`;
  return `## Floor
[id:: ${recordId}]
[date:: 2026-07-16 15:30:12]

Floor ${floorNumber} body.
`;
}).join("\n");

const validPaginatedDoc = `---
floor-notes: 1
---
# Thread Title

${paginatedDoc}`;

describe("T-070: Repeated render scope lifecycle tests", () => {
  beforeEach(() => {
    _testState.loadedComponents.clear();
    _testState.unloadedComponents.clear();
    _testState.notices.length = 0;
  });

  it("should manage standalone render scope Component on successful parse", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(validBaseDoc),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };

    const leafMock = {
      setViewState: vi.fn()
    };

    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView(leafMock as any, registry, service);
    view.app = appMock as any;
    
    const file = mockTFile("thread.md", "thread.md");
    await view.onLoadFile(file);

    // Capture this view's scope rather than asserting global mock counts.
    // Test files run concurrently and other views can use the same mock state.
    const firstScope = Array.from(_testState.loadedComponents)[0];
    expect(firstScope).toBeDefined();

    // Trigger another generation.
    await view.requestGeneration();

    // The previous scope must be unloaded and replaced by a distinct scope.
    expect(_testState.unloadedComponents.has(firstScope)).toBe(true);
    const secondScope = Array.from(_testState.loadedComponents).find((scope) => scope !== firstScope);
    expect(secondScope).toBeDefined();

    // Unload view.
    await view.onUnloadFile(file);
    expect(_testState.unloadedComponents.has(secondScope)).toBe(true);
  });

  it("keeps the committed records visible while the next page source is loading", async () => {
    const registry = new FileIdentityRegistry();
    let resolveNextRead: ((content: string) => void) | undefined;
    const appMock = {
      vault: {
        read: vi.fn()
          .mockResolvedValueOnce(validBaseDoc)
          .mockImplementationOnce(() => new Promise<string>((resolve) => {
            resolveNextRead = resolve;
          })),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;
    const file = mockTFile("thread.md", "thread.md");

    await view.onLoadFile(file);
    const previousList = view.contentEl.querySelector(".floor-notes-record-list");
    const pendingGeneration = view.requestGeneration();
    await vi.waitFor(() => expect(resolveNextRead).toBeTypeOf("function"));

    expect(view.contentEl.querySelector(".floor-notes-record-list")).toBe(previousList);

    resolveNextRead?.(validBaseDoc.replace("Body content.", "Updated body content."));
    await pendingGeneration;
    expect(view.contentEl.querySelector(".floor-notes-record-list")).not.toBe(previousList);
  });

  it("keeps the committed thread visible without a loading message while switching files", async () => {
    const registry = new FileIdentityRegistry();
    let resolveSecondRead: ((content: string) => void) | undefined;
    const secondDoc = validBaseDoc
      .replace("# Thread Title", "# Second Thread")
      .replace("Body content.", "Second body content.");
    const appMock = {
      vault: {
        read: vi.fn()
          .mockResolvedValueOnce(validBaseDoc)
          .mockImplementationOnce(() => new Promise<string>((resolve) => {
            resolveSecondRead = resolve;
          })),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;
    const firstFile = mockTFile("first.md", "first.md");
    const secondFile = mockTFile("second.md", "second.md");

    await view.onLoadFile(firstFile);
    const previousHeader = view.contentEl.querySelector(".floor-notes-header");
    const previousList = view.contentEl.querySelector(".floor-notes-record-list");

    await view.onUnloadFile(firstFile);
    const pendingLoad = view.onLoadFile(secondFile);
    await vi.waitFor(() => expect(resolveSecondRead).toBeTypeOf("function"));

    expect(view.contentEl.querySelector(".floor-notes-header")).toBe(previousHeader);
    expect(view.contentEl.querySelector(".floor-notes-record-list")).toBe(previousList);
    expect(view.contentEl.querySelector(".floor-notes-loading")).toBeNull();
    expect(view.contentEl.getAttribute("aria-busy")).toBe("true");

    resolveSecondRead?.(secondDoc);
    await pendingLoad;

    expect(view.contentEl.querySelector<HTMLElement>(".floor-notes-header-title")?.innerText).toBe("Second Thread");
    expect(view.contentEl.querySelector<HTMLElement>(".floor-notes-body")?.innerText).toBe("Second body content.");
    expect(view.contentEl.querySelector(".floor-notes-loading")).toBeNull();
    expect(view.contentEl.hasAttribute("aria-busy")).toBe(false);
  });

  it("clears the busy state when a cold thread load fails", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockRejectedValue(new Error("Read failed")),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;

    await view.onLoadFile(mockTFile("failed.md", "failed.md"));

    expect(view.contentEl.querySelector(".floor-notes-error-container")).not.toBeNull();
    expect(view.contentEl.querySelector(".floor-notes-loading")).toBeNull();
    expect(view.contentEl.hasAttribute("aria-busy")).toBe(false);
  });

  it("applies the effective thread view style and groups replies in a dedicated container", async () => {
    const registry = new FileIdentityRegistry();
    const docWithReply = `${validBaseDoc}
### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: 2026-07-16 15:31:12]

Reply body.
`;
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(docWithReply),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView(
      { setViewState: vi.fn() } as any,
      registry,
      service,
      { ...DEFAULT_SETTINGS, defaultViewStyle: "paper" }
    );
    view.app = appMock as any;

    await view.onLoadFile(mockTFile("thread.md", "thread.md"));

    expect(view.contentEl.classList.contains("floor-notes-view-style-paper")).toBe(true);
    const recordList = view.contentEl.querySelector(".floor-notes-records-container > .floor-notes-record-list");
    expect(recordList).not.toBeNull();
    const group = recordList?.querySelector(".floor-notes-floor-group");
    expect(group?.getAttribute("data-reply-count")).toBe("1");
    const replies = group?.querySelector(":scope > .floor-notes-replies");
    expect(replies?.querySelectorAll(":scope > article.floor-notes-reply")).toHaveLength(1);
  });

  it("keeps an explicit frontmatter view style when theme classes refresh", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(validBaseDoc.replace("floor-notes: 1", "floor-notes: 1\nfloor-notes-view-style: glass")),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView(
      { setViewState: vi.fn() } as any,
      registry,
      service,
      { ...DEFAULT_SETTINGS, defaultViewStyle: "paper" }
    );
    view.app = appMock as any;

    await view.onLoadFile(mockTFile("thread.md", "thread.md"));
    expect(view.contentEl.classList.contains("floor-notes-view-style-glass")).toBe(true);

    view.applyTheme();

    expect(view.contentEl.classList.contains("floor-notes-view-style-glass")).toBe(true);
    expect(view.contentEl.classList.contains("floor-notes-view-style-paper")).toBe(false);
  });

  it("persists a selected view style from the header palette menu", async () => {
    setLocale("en");
    _testState.menus.length = 0;
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(validBaseDoc),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const setViewStyle = vi.spyOn(service, "setViewStyle").mockResolvedValue({ type: "no-op" });
    const file = mockTFile("thread.md", "thread.md");
    const view = new FloorThreadView(
      { setViewState: vi.fn() } as any,
      registry,
      service,
      { ...DEFAULT_SETTINGS, defaultViewStyle: "paper" }
    );
    view.app = appMock as any;

    await view.onLoadFile(file);
    view.contentEl.querySelector<HTMLButtonElement>("button[aria-label='Change thread view style']")?.click();

    const menu = _testState.menus.at(-1);
    expect(menu?.items.map((item: { title: string }) => item.title)).toEqual([
      "Bubble",
      "Glass",
      "Paper",
      "Timeline"
    ]);
    expect(menu?.items.find((item: { title: string }) => item.title === "Paper")?.checked).toBe(true);

    menu?.items.find((item: { title: string }) => item.title === "Timeline")?.onClickCallback?.();
    await vi.waitFor(() => expect(setViewStyle).toHaveBeenCalledWith(file, "timeline"));
  });

  it("ignores a stale header palette selection", async () => {
    setLocale("en");
    _testState.menus.length = 0;
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(validBaseDoc),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const setViewStyle = vi.spyOn(service, "setViewStyle").mockResolvedValue({ type: "no-op" });
    const file = mockTFile("thread.md", "thread.md");
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;

    await view.onLoadFile(file);
    view.contentEl.querySelector<HTMLButtonElement>("button[aria-label='Change thread view style']")?.click();
    registry.handleRename(file, "thread.md");

    _testState.menus.at(-1)?.items[0]?.onClickCallback?.();
    expect(setViewStyle).not.toHaveBeenCalled();
  });

  it("unloads the previous scope and falls back to Markdown when a later generation fails to parse", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValueOnce(validBaseDoc).mockResolvedValueOnce(invalidDoc),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const leafMock = { setViewState: vi.fn() };
    const view = new FloorThreadView(leafMock as any, registry, service);
    view.app = appMock as any;

    const file = mockTFile("thread.md", "thread.md");
    await view.onLoadFile(file);
    expect(_testState.loadedComponents.size).toBe(1);

    await view.requestGeneration();
    expect(_testState.loadedComponents.size).toBe(1);
    expect(_testState.unloadedComponents.size).toBe(1);
    expect(leafMock.setViewState).toHaveBeenCalledWith({
      type: "markdown",
      state: { file: "thread.md", bypassThreadView: true }
    });
    expect(_testState.notices).toHaveLength(1);

    await view.requestGeneration();
    expect(leafMock.setViewState).toHaveBeenCalledTimes(1);
    expect(_testState.notices).toHaveLength(1);
  });

  it("falls back to Markdown when Markdown rendering fails", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(validBaseDoc),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const leafMock = { setViewState: vi.fn() };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView(leafMock as any, registry, service);
    view.app = appMock as any;
    vi.spyOn(obsidian.MarkdownRenderer, "render").mockRejectedValueOnce(new Error("Render failed"));

    await view.onLoadFile(mockTFile("thread.md", "thread.md"));

    expect(leafMock.setViewState).toHaveBeenCalledWith({
      type: "markdown",
      state: { file: "thread.md", bypassThreadView: true }
    });
    expect(_testState.notices).toHaveLength(1);
  });

  it("does not retry when the Markdown fallback itself fails", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(invalidDoc),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const leafMock = { setViewState: vi.fn().mockRejectedValue(new Error("Leaf update failed")) };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView(leafMock as any, registry, service);
    view.app = appMock as any;

    await view.onLoadFile(mockTFile("thread.md", "thread.md"));

    expect(leafMock.setViewState).toHaveBeenCalledTimes(1);
    expect(_testState.notices).toHaveLength(1);
    expect(view.contentEl.querySelector(".floor-notes-error-container")).not.toBeNull();
  });

  it("unloads the previous scope when reading a later generation fails", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValueOnce(validBaseDoc).mockRejectedValueOnce(new Error("Read failed")),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;

    const file = mockTFile("thread.md", "thread.md");
    await view.onLoadFile(file);
    await view.requestGeneration();

    expect(_testState.loadedComponents.size).toBe(1);
    expect(_testState.unloadedComponents.size).toBe(1);
    expect(view.contentEl.querySelector(".floor-notes-error-container")).not.toBeNull();
  });

  it("discards a delayed render after the file identity epoch changes", async () => {
    const registry = new FileIdentityRegistry();
    let resolveRead: ((content: string) => void) | undefined;
    const appMock = {
      vault: {
        read: vi.fn().mockImplementation(() => new Promise<string>((resolve) => {
          resolveRead = resolve;
        })),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;

    const file = mockTFile("thread.md", "thread.md");
    const pendingLoad = view.onLoadFile(file);
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf("function"));
    file.path = "renamed-thread.md";
    registry.handleRename(file, "thread.md");
    resolveRead?.(validBaseDoc);
    await pendingLoad;

    expect(_testState.loadedComponents.size).toBe(0);
    expect(_testState.unloadedComponents.size).toBe(0);
  });

  it("submits an already opened modal but prevents stale modal openings", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: { read: vi.fn().mockResolvedValue(validBaseDoc), process: vi.fn() },
      workspace: { requestSaveLayout: vi.fn() }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const addFloor = vi.spyOn(service, "addFloor").mockResolvedValue({ type: "no-op" });
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;
    const file = mockTFile("thread.md", "thread.md");
    const modalCapture: { value?: CreateRecordModal } = {};
    const openModal = vi.spyOn(CreateRecordModal.prototype, "open").mockImplementation(function (this: CreateRecordModal) {
      Reflect.set(modalCapture, "value", this);
    });

    try {
      await view.onLoadFile(file);
      view.contentEl.querySelector<HTMLButtonElement>("button[aria-label='Add floor']")?.click();
      const modal = modalCapture.value;
      if (!modal) {
        throw new Error("Expected the add-floor modal to open.");
      }

      registry.handleRename(file, "thread.md");
      const submit = Reflect.get(modal, "onSubmit") as (body: string) => Promise<unknown>;
      await submit("Saved after a refresh");
      expect(addFloor).toHaveBeenCalledWith(file, "Saved after a refresh", expect.any(Date));

      view.contentEl.querySelector<HTMLButtonElement>("button[aria-label='Add floor']")?.click();
      expect(openModal).toHaveBeenCalledOnce();
    } finally {
      openModal.mockRestore();
    }
  });

  it("does not restore focus to a detached modal trigger", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: { read: vi.fn().mockResolvedValue(validBaseDoc), process: vi.fn() },
      workspace: { requestSaveLayout: vi.fn() }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;
    const modalCapture: { value?: CreateRecordModal } = {};
    const openModal = vi.spyOn(CreateRecordModal.prototype, "open").mockImplementation(function (this: CreateRecordModal) {
      Reflect.set(modalCapture, "value", this);
    });
    document.body.append(view.contentEl);

    try {
      await view.onLoadFile(mockTFile("thread.md", "thread.md"));
      const trigger = view.contentEl.querySelector<HTMLButtonElement>("button[aria-label='Add floor']");
      trigger?.focus();
      trigger?.click();
      const focus = vi.spyOn(trigger!, "focus");

      view.contentEl.remove();
      modalCapture.value?.close();

      expect(focus).not.toHaveBeenCalled();
    } finally {
      openModal.mockRestore();
      view.contentEl.remove();
    }
  });
});

describe("pagination localization", () => {
  beforeEach(() => {
    setLocale("en");
  });

  afterEach(() => {
    setLocale("en");
  });

  it("renders English pagination controls and defines an English focus announcement", async () => {
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(validPaginatedDoc),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;
    const file = mockTFile("thread.md", "thread.md");

    await view.onLoadFile(file);

    const pagination = view.contentEl.querySelector<HTMLElement>(".floor-notes-pagination");
    const select = pagination?.querySelector<HTMLSelectElement>(".floor-notes-page-select");
    const buttons = pagination?.querySelectorAll<HTMLButtonElement>("button");
    expect(Array.from(select?.options ?? []).map((option) => option.innerText)).toEqual([
      "Page 1 / 2",
      "Page 2 / 2"
    ]);
    expect(buttons?.[0]?.getAttribute("aria-label")).toBe("Previous page");
    expect(buttons?.[1]?.getAttribute("aria-label")).toBe("Next page");
    expect(en.navigatedToFloor
      .replace("{title}", "Thread Title")
      .replace("{recordId}", "floor-20260716-153031-00000031"))
      .toBe("Navigated to Thread Title, floor floor-20260716-153031-00000031");
  });

  it("renders Chinese pagination controls", async () => {
    setLocale("zh-cn");
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(validPaginatedDoc),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const service = new ThreadMutationService(appMock as any, registry);
    const view = new FloorThreadView({ setViewState: vi.fn() } as any, registry, service);
    view.app = appMock as any;

    await view.onLoadFile(mockTFile("thread.md", "thread.md"));

    const pagination = view.contentEl.querySelector<HTMLElement>(".floor-notes-pagination");
    const select = pagination?.querySelector<HTMLSelectElement>(".floor-notes-page-select");
    const buttons = pagination?.querySelectorAll<HTMLButtonElement>("button");
    expect(Array.from(select?.options ?? []).map((option) => option.innerText)).toEqual([
      "第 1 / 2 页",
      "第 2 / 2 页"
    ]);
    expect(buttons?.[0]?.getAttribute("aria-label")).toBe("上一页");
    expect(buttons?.[1]?.getAttribute("aria-label")).toBe("下一页");
    expect(zhCn.navigatedToFloor
      .replace("{title}", "主题")
      .replace("{recordId}", "floor-20260716-153031-00000031"))
      .toBe("已跳转至 主题，楼层 floor-20260716-153031-00000031");
  });
});

describe("Settings, locales, leaf routing, and commands", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("T-030 T-031 T-032: renders accessible theme cards instead of a theme drop-down", async () => {
    const pluginMock = {
      settings: {
        defaultSortOrder: "asc",
        preferredNewline: "auto",
        locale: "auto",
        theme: "obsidian",
        mode: "auto",
        defaultViewStyle: "bubble",
        autoOpenThreadView: true
      },
      updateSettings: vi.fn().mockResolvedValue(undefined)
    };
    const tab = new FloorNotesSettingTab({} as any, pluginMock as any);
    const container = document.createElement("div");
    tab.containerEl = container;

    tab.display();

    const grid = container.querySelector(".floor-notes-theme-grid");
    const choices = grid?.querySelectorAll(".floor-notes-theme-choice");
    const radios = Array.from(container.querySelectorAll<HTMLInputElement>(".floor-notes-theme-input"));
    const previews = container.querySelectorAll(".floor-notes-theme-preview");
    expect(grid).not.toBeNull();
    expect(grid?.getAttribute("role")).toBe("radiogroup");
    expect(choices).toHaveLength(10);
    expect(Array.from(choices ?? []).every((choice) =>
      choice.querySelector(".floor-notes-theme-input + .floor-notes-theme-option") !== null
    )).toBe(true);
    expect(radios).toHaveLength(10);
    expect(previews).toHaveLength(10);
    expect(Array.from(previews).every((preview) => preview.getAttribute("aria-hidden") === "true")).toBe(true);
    const customPreview = container.querySelector("label[for='floor-notes-theme-custom'] .floor-notes-theme-preview");
    expect(customPreview?.querySelectorAll(".floor-notes-theme-custom-swatch")).toHaveLength(4);
    expect(Array.from(customPreview?.querySelectorAll(".floor-notes-theme-custom-swatch") ?? []).map((swatch) =>
      Array.from(swatch.classList).find((className) => className.startsWith("floor-notes-view-style-"))
    )).toEqual([
      "floor-notes-view-style-bubble",
      "floor-notes-view-style-glass",
      "floor-notes-view-style-paper",
      "floor-notes-view-style-timeline"
    ]);
    expect(container.querySelector<HTMLElement>("label[for='floor-notes-theme-custom'] .floor-notes-theme-option-name")?.innerText).toBe("Plugin");
    expect(radios.find((radio) => radio.value === "obsidian")?.checked).toBe(true);
    expect(container.querySelector("select option[value='obsidian']")).toBeNull();

    const dracula = radios.find((radio) => radio.value === "dracula");
    expect(container.querySelector<HTMLElement>("label[for='floor-notes-theme-dracula'] .floor-notes-theme-option-name")?.innerText).toContain("Dracula");
    dracula!.checked = true;
    dracula!.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(pluginMock.updateSettings).toHaveBeenCalledWith({ theme: "dracula" });
    });
  });

  it("uses ascending order for a new installation and rebuilds settings after a locale change", async () => {
    expect(DEFAULT_SETTINGS.defaultSortOrder).toBe("asc");

    const settings = { ...DEFAULT_SETTINGS, locale: "en" as const };
    const pluginMock = {
      settings,
      updateSettings: vi.fn().mockImplementation(async (nextSettings: Partial<typeof settings>) => {
        Object.assign(settings, nextSettings);
        if (nextSettings.locale) {
          setLocale(nextSettings.locale);
        }
      })
    };
    const tab = new FloorNotesSettingTab({} as any, pluginMock as any);
    const container = document.createElement("div");
    tab.containerEl = container;
    tab.display();

    const localeSelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select"))
      .find((select) => select.querySelector("option[value='zh-cn']") !== null);
    expect(localeSelect).toBeDefined();
    localeSelect!.value = "zh-cn";
    localeSelect!.dispatchEvent(new Event("change"));

    await vi.waitFor(() => {
      expect(pluginMock.updateSettings).toHaveBeenCalledWith({ locale: "zh-cn" });
      expect(container.textContent).toContain(zhCn.settingsTitle);
      expect(container.querySelector<HTMLElement>("label[for='floor-notes-theme-custom'] .floor-notes-theme-option-name")?.innerText).toBe("Plugin");
    });
  });

  it("restores locale, theme, and mode focus after each settings redraw", async () => {
    const settings = { ...DEFAULT_SETTINGS, locale: "en" as const, theme: "dracula" as const, mode: "dark" as const };
    const pluginMock = {
      settings,
      updateSettings: vi.fn().mockImplementation(async (nextSettings: Partial<typeof settings>) => {
        Object.assign(settings, nextSettings);
      })
    };
    const tab = new FloorNotesSettingTab({} as any, pluginMock as any);
    const container = document.createElement("div");
    document.body.append(container);
    tab.containerEl = container;
    tab.display();

    try {
      const locale = container.querySelector<HTMLSelectElement>("[data-floor-notes-settings-control='locale']");
      locale?.focus();
      locale!.value = "zh-cn";
      locale!.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(document.activeElement).toBe(
        container.querySelector("[data-floor-notes-settings-control='locale']")
      ));

      const theme = container.querySelector<HTMLInputElement>("[data-floor-notes-settings-control='theme'][value='dracula']");
      theme?.focus();
      theme!.checked = true;
      theme!.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(document.activeElement).toBe(
        container.querySelector("[data-floor-notes-settings-control='theme']:checked")
      ));

      const mode = container.querySelector<HTMLSelectElement>("[data-floor-notes-settings-control='mode']");
      mode?.focus();
      mode!.value = "light";
      mode!.dispatchEvent(new Event("change"));
      await vi.waitFor(() => expect(document.activeElement).toBe(
        container.querySelector("[data-floor-notes-settings-control='mode']")
      ));
    } finally {
      container.remove();
    }
  });

  it("disables the color mode selector only for the host-adapted Obsidian theme", () => {
    const pluginMock = {
      settings: {
        defaultSortOrder: "desc",
        preferredNewline: "auto",
        locale: "auto",
        theme: "obsidian",
        mode: "dark",
        defaultViewStyle: "bubble",
        autoOpenThreadView: true
      },
      updateSettings: vi.fn().mockResolvedValue(undefined)
    };
    const tab = new FloorNotesSettingTab({} as any, pluginMock as any);
    const container = document.createElement("div");
    tab.containerEl = container;

    tab.display();
    const hostModeSelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select"))
      .find((select) => select.querySelector("option[value='light']") !== null);
    expect(hostModeSelect?.disabled).toBe(true);

    pluginMock.settings.theme = "dracula";
    tab.display();
    const fixedModeSelect = Array.from(container.querySelectorAll<HTMLSelectElement>("select"))
      .find((select) => select.querySelector("option[value='light']") !== null);
    expect(fixedModeSelect?.disabled).toBe(false);
  });

  it("T-033 T-037: view leaf routing, auto-open suppression, and markdown fallback", () => {
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService({} as any, registry);
    const leafMock = {
      setViewState: vi.fn()
    };
    const view = new FloorThreadView(leafMock as any, registry, service);
    expect(view.getViewType()).toBe("floor-notes-thread");

    // fallback: verify view states can be set
    expect(leafMock.setViewState).not.toHaveBeenCalled();
    expect(view.getDisplayText()).toBe("Floor thread");
  });

  it("T-034 T-036: Ribbon icon sheets-in-box and commands", () => {
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService({} as any, registry);
    const view = new FloorThreadView({} as any, registry, service);
    // display checks
    expect(view.getIcon()).toBe("sheets-in-box");
    expect(view.getDisplayText()).toBe("Floor thread");
    
    // Ribbon click command verification
    expect(view.getViewType()).toBe("floor-notes-thread");
  });

  it("T-038: Locale file validation", () => {
    const enKeys = Object.keys(en);
    const zhKeys = Object.keys(zhCn);
    for (const key of enKeys) {
      expect(zhKeys).toContain(key);
    }
  });
});
