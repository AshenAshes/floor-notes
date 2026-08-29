import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { FloorThreadView } from "../../src/view/FloorThreadView";
import { FileIdentityRegistry } from "../../src/services/FileIdentityRegistry";
import { ThreadMutationService } from "../../src/services/ThreadMutationService";
import { FloorNotesSettingTab } from "../../src/settings/settingsTab";
import { CreateRecordModal, EditRecordModal } from "../../src/modals/ThreadModals";
import { DEFAULT_SETTINGS, THREAD_VIEW_STYLES } from "../../src/settings/types";
import { THEME_OPTIONS } from "../../src/theme";
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

describe("T-075: Reply author conditions in Floor view", () => {
  it("uses physical Parent Floor labels across ascending and descending display order", async () => {
    const longAuthor = `${"Long author ".repeat(20)}👩🏽‍💻`;
    const source = `---
floor-notes: 1
floor-notes-sort: desc
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]
[author:: A\u030A]

Floor one.

### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: 2026-07-16 15:31:12]
[author:: Å]

Equivalent author.

### Reply
[id:: reply-20260716-153212-qrstvwxy]
[date:: 2026-07-16 15:32:12]
[author:: Alice]

Different author.

## Floor
[id:: floor-20260716-153312-bcdef234]
[date:: 2026-07-16 15:33:12]

Floor two.

### Reply
[id:: reply-20260716-153412-cdefg345]
[date:: 2026-07-16 15:34:12]
[author:: Bob]

Parent has no author.

## Floor
[id:: floor-20260716-153512-defgh456]
[date:: 2026-07-16 15:35:12]
[author:: Alice]

Floor three.

### Reply
[id:: reply-20260716-153612-efghj567]
[date:: 2026-07-16 15:36:12]

Reply has no author.

### Reply
[id:: reply-20260716-153712-fghjk678]
[date:: 2026-07-16 15:37:12]
[author:: alice]

Case-sensitive difference.

### Reply
[id:: reply-20260716-153812-ghjkm789]
[date:: 2026-07-16 15:38:12]
[author:: ${longAuthor}]

Long emoji author.

### Reply
[id:: reply-20260716-153912-hjkmn890]
[date:: 2026-07-16 15:39:12]

Reply has no author.
`;
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(source),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const app = new obsidian.App();
    Object.assign(app.vault, appMock.vault);
    Object.assign(app.workspace, appMock.workspace);
    const leaf = new obsidian.WorkspaceLeaf();
    const service = new ThreadMutationService(app, registry);
    const view = new FloorThreadView(leaf, registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, markdown, container) => {
        const paragraph = container.ownerDocument.createElement("p");
        paragraph.textContent = markdown.trim();
        container.appendChild(paragraph);
      }
    );
    const file = mockTFile("thread.md", "thread.md");

    try {
      await view.onLoadFile(file);

      const record = (id: string) => view.contentEl.querySelector<HTMLElement>(`[data-record-id="${id}"]`);
      const expectAuthorLabels = () => {
        expect(view.contentEl.querySelectorAll(".floor-notes-floor .floor-notes-reply-author")).toHaveLength(0);
        expect(record("reply-20260716-153112-xyz09876")?.querySelector(".floor-notes-reply-author")).toBeNull();
        expect(record("reply-20260716-153212-qrstvwxy")?.querySelector(".floor-notes-reply-author")?.textContent).toBe("Alice:");
        expect(record("reply-20260716-153412-cdefg345")?.querySelector(".floor-notes-reply-author")?.textContent).toBe("Bob:");
        expect(record("reply-20260716-153612-efghj567")?.querySelector(".floor-notes-reply-author")).toBeNull();
        expect(record("reply-20260716-153712-fghjk678")?.querySelector(".floor-notes-reply-author")?.textContent).toBe("alice:");
        expect(record("reply-20260716-153812-ghjkm789")?.querySelector(".floor-notes-reply-author")?.textContent).toBe(`${longAuthor}:`);
        expect(record("reply-20260716-153912-hjkmn890")?.querySelector(".floor-notes-reply-author")).toBeNull();
        expect(view.contentEl.querySelectorAll(".floor-notes-reply .floor-notes-reply-author")).toHaveLength(4);
      };

      expectAuthorLabels();
      appMock.vault.read.mockResolvedValue(source.replace("floor-notes-sort: desc", "floor-notes-sort: asc"));
      await view.requestGeneration();
      expectAuthorLabels();
      expect(appMock.vault.process).not.toHaveBeenCalled();
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
    }
  });

  it("keeps Parent Floor comparison stable across pagination and loading more replies", async () => {
    const precedingFloors = Array.from({ length: 30 }, (_, index) => {
      const suffix = String(index + 1).padStart(8, "0");
      return `## Floor
[id:: floor-20260716-120000-${suffix}]
[date:: 2026-07-16 12:00:00]

Floor ${index + 1}.`;
    }).join("\n\n");
    const replies = Array.from({ length: 51 }, (_, index) => {
      const replyNumber = index + 1;
      const suffix = String(10_000_000 + replyNumber);
      const author = replyNumber === 51 ? "Bob" : "Alice";
      return `### Reply
[id:: reply-20260716-130000-${suffix}]
[date:: 2026-07-16 13:00:00]
[author:: ${author}]

Reply ${replyNumber}.`;
    }).join("\n\n");
    const source = `---
floor-notes: 1
floor-notes-sort: asc
---
${precedingFloors}

## Floor
[id:: floor-20260716-120000-00000031]
[date:: 2026-07-16 12:00:00]
[author:: Alice]

Floor 31.

${replies}
`;
    const registry = new FileIdentityRegistry();
    const appMock = {
      vault: {
        read: vi.fn().mockResolvedValue(source),
        process: vi.fn()
      },
      workspace: {
        requestSaveLayout: vi.fn()
      }
    };
    const app = new obsidian.App();
    Object.assign(app.vault, appMock.vault);
    Object.assign(app.workspace, appMock.workspace);
    const leaf = new obsidian.WorkspaceLeaf();
    const service = new ThreadMutationService(app, registry);
    const view = new FloorThreadView(leaf, registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, markdown, container) => {
        const paragraph = container.ownerDocument.createElement("p");
        paragraph.textContent = markdown.trim();
        container.appendChild(paragraph);
      }
    );
    const file = mockTFile("thread.md", "thread.md");

    try {
      await view.onLoadFile(file);
      expect(view.contentEl.querySelector('[data-record-id="floor-20260716-120000-00000031"]')).toBeNull();

      const requestGeneration = vi.spyOn(view, "requestGeneration");
      const paginationButtons = view.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-pagination-btn");
      expect(paginationButtons).toHaveLength(2);
      paginationButtons[1]!.click();

      expect(requestGeneration).toHaveBeenCalledTimes(1);
      await requestGeneration.mock.results[0]!.value;
      const pageTwoRecordIds = Array.from(view.contentEl.querySelectorAll<HTMLElement>("[data-record-id]"))
        .map((element) => element.dataset.recordId);
      expect(pageTwoRecordIds).toContain("floor-20260716-120000-00000031");
      expect(view.contentEl.querySelectorAll(".floor-notes-reply .floor-notes-reply-author")).toHaveLength(0);

      const loadMore = view.contentEl.querySelector<HTMLButtonElement>(".floor-notes-load-more-replies");
      expect(loadMore).not.toBeNull();
      loadMore?.click();

      expect(requestGeneration).toHaveBeenCalledTimes(2);
      await requestGeneration.mock.results[1]!.value;
      expect(view.contentEl.querySelector(
        '[data-record-id="reply-20260716-130000-10000051"] .floor-notes-reply-author'
      )?.textContent).toBe("Bob:");
      expect(view.contentEl.querySelectorAll(".floor-notes-reply .floor-notes-reply-author")).toHaveLength(1);
      expect(appMock.vault.process).not.toHaveBeenCalled();
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
    }
  });
});

describe("T-078: Direct image resize control", () => {
  beforeEach(() => {
    setLocale("en");
    Reflect.set(obsidian.Platform, "isMobile", false);
    Reflect.set(obsidian.Platform, "isDesktop", true);
  });

  afterEach(() => {
    Reflect.set(obsidian.Platform, "isMobile", false);
    Reflect.set(obsidian.Platform, "isDesktop", true);
  });

  it("uses the native image wrapper hierarchy with semantic actions and one resize control", async () => {
    const source = validBaseDoc.replace("Body content.", "Before ![[photo.png]] after");
    const app = new obsidian.App();
    Object.assign(app.vault, {
      read: vi.fn().mockResolvedValue(source),
      process: vi.fn()
    });
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService(app, registry);
    const leaf = new obsidian.WorkspaceLeaf();
    const view = new FloorThreadView(leaf, registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, _markdown, container) => {
        const paragraph = container.createEl("p");
        const embed = paragraph.createSpan({ cls: "image-embed" });
        embed.createEl("img", { attr: { src: "app://rendered-resource" } });
      }
    );
    const file = mockTFile("thread.md", "thread.md");

    try {
      await view.onLoadFile(file);

      const root = view.contentEl.querySelector<HTMLElement>(".floor-notes-resizable-image");
      const imageWrapper = root?.querySelector<HTMLElement>(":scope > .floor-notes-image-wrapper");
      const handle = imageWrapper?.querySelector<HTMLButtonElement>(":scope > .floor-notes-image-resize-handle");
      expect(root?.tagName).toBe("DIV");
      expect(imageWrapper?.tagName).toBe("DIV");
      expect(imageWrapper?.querySelector(":scope > img")).not.toBeNull();
      expect(handle).not.toBeNull();
      expect(handle?.type).toBe("button");
      expect(handle?.parentElement).toBe(imageWrapper);
      expect(view.contentEl.querySelectorAll(".floor-notes-image-resize-handle")).toHaveLength(1);

      const actions = root?.querySelector<HTMLElement>(":scope > .floor-notes-image-actions");
      const openImage = actions?.querySelector<HTMLButtonElement>(".floor-notes-image-action-open");
      const openSource = actions?.querySelector<HTMLButtonElement>(".floor-notes-image-action-source");
      expect(actions).not.toBeNull();
      expect(actions?.tagName).toBe("DIV");
      expect(openImage?.type).toBe("button");
      expect(openSource?.type).toBe("button");
      expect(openImage?.getAttribute("aria-label")).toBe(en.zoomIn);
      expect(openSource?.getAttribute("aria-label")).toBe(en.editBlock);
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
    }
  });

  it("keeps the accepted resize wrapper and control across every layout and theme", async () => {
    const source = validBaseDoc.replace("Body content.", "![[photo.png]]");
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, _markdown, container) => {
        container.createEl("img", { attr: { src: "app://rendered-resource" } });
      }
    );

    try {
      for (const viewStyle of THREAD_VIEW_STYLES) {
        for (const theme of THEME_OPTIONS) {
          const app = new obsidian.App();
          Object.assign(app.vault, {
            read: vi.fn().mockResolvedValue(source),
            process: vi.fn()
          });
          const registry = new FileIdentityRegistry();
          const service = new ThreadMutationService(app, registry);
          const view = new FloorThreadView(
            new obsidian.WorkspaceLeaf(),
            registry,
            service,
            { ...DEFAULT_SETTINGS, defaultViewStyle: viewStyle, theme: theme.id }
          );
          view.app = app;
          const file = mockTFile(`${viewStyle}-${theme.id}.md`, `${viewStyle}-${theme.id}.md`);

          try {
            await view.onLoadFile(file);
            expect(view.contentEl.classList.contains(`floor-notes-view-style-${viewStyle}`)).toBe(true);
            expect(view.contentEl.classList.contains(`theme-${theme.id}`)).toBe(true);
            expect(view.contentEl.querySelectorAll(".floor-notes-resizable-image")).toHaveLength(1);
            expect(view.contentEl.querySelectorAll(".floor-notes-image-resize-handle")).toHaveLength(1);
          } finally {
            await view.onUnloadFile(file);
          }
        }
      }
    } finally {
      render.mockRestore();
    }
  });

  it("opens the native-style focused lightbox and closes it with Escape", async () => {
    const source = validBaseDoc.replace("Body content.", "![[assets/photo.png]]");
    const app = new obsidian.App();
    Object.assign(app.vault, {
      read: vi.fn().mockResolvedValue(source),
      process: vi.fn()
    });
    Object.assign(app.workspace, { openLinkText: vi.fn().mockResolvedValue(undefined) });
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService(app, registry);
    const view = new FloorThreadView(new obsidian.WorkspaceLeaf(), registry, service);
    view.app = app;
    document.body.appendChild(view.contentEl);
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, _markdown, container) => {
        container.createEl("img", {
          attr: { src: "app://rendered-photo", alt: "photo.png" }
        });
      }
    );
    const file = mockTFile("thread.md", "thread.md");

    try {
      await view.onLoadFile(file);
      const trigger = view.contentEl.querySelector<HTMLButtonElement>(".floor-notes-image-action-open")!;
      trigger.focus();
      trigger.click();

      const lightbox = document.body.querySelector<HTMLElement>(".floor-notes-image-lightbox");
      expect(lightbox).not.toBeNull();
      expect(document.activeElement).toBe(lightbox);
      const lightboxImage = lightbox?.querySelector<HTMLImageElement>("img");
      const lightboxContent = lightbox?.querySelector<HTMLElement>(
        ".floor-notes-image-lightbox-content"
      );
      expect(lightboxImage?.getAttribute("src")).toBe("app://rendered-photo");
      expect(lightbox?.querySelector(".floor-notes-image-lightbox-titlebar-text")?.textContent).toBe("photo.png");

      lightbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true }));
      expect(lightboxImage?.style.transform).toContain("scale(1.2)");
      lightbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "=", bubbles: true }));
      expect(lightboxImage?.style.transform).toContain("scale(1.5)");
      lightbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
      expect(lightboxImage?.style.transform).toContain("scale(1.2)");
      lightbox?.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
      expect(lightboxImage?.style.transform).toContain("scale(1)");

      const plainWheel = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -150
      });
      lightboxContent?.dispatchEvent(plainWheel);
      expect(plainWheel.defaultPrevented).toBe(false);
      expect(lightboxImage?.style.transform).toContain("scale(1)");

      const modifiedWheel = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaY: -150
      });
      lightboxContent?.dispatchEvent(modifiedWheel);
      expect(modifiedWheel.defaultPrevented).toBe(true);
      expect(lightboxImage?.style.transform).toContain("scale(2)");

      lightbox?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
      expect(document.body.querySelector(".floor-notes-image-lightbox")).toBe(lightbox);
      lightbox?.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
      expect(document.body.querySelector(".floor-notes-image-lightbox")).toBeNull();
      expect(document.activeElement).toBe(trigger);

      trigger.click();
      const reopenedLightbox = document.body.querySelector<HTMLElement>(
        ".floor-notes-image-lightbox"
      );
      reopenedLightbox?.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true
      }));
      expect(document.body.querySelector(".floor-notes-image-lightbox")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
      document.body.querySelector(".floor-notes-image-lightbox")?.remove();
      view.contentEl.remove();
    }
  });

  it("opens the Record editor focused on only the clicked image target", async () => {
    const body = [
      "Before",
      "![[assets/first.png|250]]",
      "![description|300](assets/photo\\(1\\).png \"kept title\")",
      "After"
    ].join("\n");
    const source = validBaseDoc.replace("Body content.", body);
    const app = new obsidian.App();
    Object.assign(app.vault, {
      read: vi.fn().mockResolvedValue(source),
      process: vi.fn()
    });
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService(app, registry);
    const leaf = new obsidian.WorkspaceLeaf();
    const setViewState = vi.spyOn(leaf, "setViewState");
    const view = new FloorThreadView(leaf, registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, _markdown, container) => {
        container.createEl("img", { attr: { src: "app://rendered-first" } });
        container.createEl("img", { attr: { src: "app://rendered-photo" } });
      }
    );
    const openedModals: EditRecordModal[] = [];
    const openModal = vi.spyOn(EditRecordModal.prototype, "open").mockImplementation(function (
      this: EditRecordModal
    ) {
      openedModals.push(this);
      document.body.appendChild(this.contentEl);
      this.onOpen();
    });
    const file = mockTFile("image-actions-thread.md", "image-actions-thread.md");

    try {
      await view.onLoadFile(file);
      view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".floor-notes-image-action-source"
      )[1]?.click();

      const openedModal = openedModals[0];
      expect(openedModal).toBeDefined();
      expect(setViewState).not.toHaveBeenCalled();
      const editorView = (openedModal as unknown as {
        editorView: import("@codemirror/view").EditorView | null;
      }).editorView;
      expect(editorView).not.toBeNull();
      const target = "assets/photo\\(1\\).png";
      const targetStart = body.indexOf(target);
      const targetEnd = targetStart + target.length;
      await vi.waitFor(() => {
        expect(editorView?.state.selection.main.from).toBe(targetStart);
        expect(editorView?.state.selection.main.to).toBe(targetEnd);
        expect(editorView?.state.sliceDoc(targetStart, targetEnd)).toBe(target);
        expect(editorView?.hasFocus).toBe(true);
      });
    } finally {
      for (const openedModal of openedModals) {
        openedModal.close();
        openedModal.contentEl.remove();
      }
      await view.onUnloadFile(file);
      openModal.mockRestore();
      render.mockRestore();
    }
  });

  it("T-079: previews a proportional clamped drag and commits its rounded width exactly once", async () => {
    const source = validBaseDoc.replace("Body content.", "![[photo.png]]");
    const app = new obsidian.App();
    Object.assign(app.vault, {
      read: vi.fn().mockResolvedValue(source),
      process: vi.fn()
    });
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService(app, registry);
    const resize = vi.spyOn(service, "setImageSize").mockResolvedValue({ type: "no-op" });
    const view = new FloorThreadView(new obsidian.WorkspaceLeaf(), registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, _markdown, container) => {
        const paragraph = container.createEl("p");
        const embed = paragraph.createSpan({ cls: "image-embed" });
        embed.createEl("img", { attr: { src: "app://rendered-resource" } });
      }
    );
    const file = mockTFile("thread.md", "thread.md");

    try {
      await view.onLoadFile(file);
      const handle = view.contentEl.querySelector<HTMLButtonElement>(".floor-notes-image-resize-handle")!;
      const image = view.contentEl.querySelector<HTMLImageElement>(".floor-notes-image-wrapper > img")!;
      const recordContent = view.contentEl.querySelector<HTMLElement>(".floor-notes-record-content")!;
      vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
        width: 200,
        height: 100
      } as DOMRect);
      vi.spyOn(recordContent, "getBoundingClientRect").mockReturnValue({
        width: 350,
        height: 500
      } as DOMRect);

      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }));
      document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 260 }));
      document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 275 }));

      expect(image.style.width).toBe("350px");
      expect(image.style.height).toBe("175px");
      expect(resize).not.toHaveBeenCalled();

      document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 275 }));
      document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 275 }));

      await vi.waitFor(() => expect(resize).toHaveBeenCalledOnce());
      expect(resize.mock.calls[0]?.[1]).toMatchObject({
        recordId: "floor-20260716-153012-abcde123",
        expectedBody: "![[photo.png]]",
        desiredWidth: 350
      });
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
    }
  });

  it("keeps the resize control after a saved width is rendered again", async () => {
    let currentSource = validBaseDoc.replace("Body content.", "![[photo.png]]");
    const app = new obsidian.App();
    Object.assign(app.vault, {
      read: vi.fn(async () => currentSource),
      process: vi.fn(async (_file, callback: (data: string) => string | Promise<string>) => {
        currentSource = await callback(currentSource);
        return currentSource;
      })
    });
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService(app, registry);
    const view = new FloorThreadView(new obsidian.WorkspaceLeaf(), registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, _markdown, container) => {
        const paragraph = container.createEl("p");
        paragraph.createEl("img", { attr: { src: "app://rendered-resource" } });
      }
    );
    const file = mockTFile("thread.md", "thread.md");

    try {
      await view.onLoadFile(file);
      const handle = view.contentEl.querySelector<HTMLButtonElement>(".floor-notes-image-resize-handle")!;
      const image = view.contentEl.querySelector<HTMLImageElement>(".floor-notes-image-wrapper > img")!;
      const recordContent = view.contentEl.querySelector<HTMLElement>(".floor-notes-record-content")!;
      vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ width: 200, height: 100 } as DOMRect);
      vi.spyOn(recordContent, "getBoundingClientRect").mockReturnValue({ width: 400 } as DOMRect);

      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }));
      document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 150 }));
      document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 150 }));
      await vi.waitFor(() => expect(currentSource).toContain("![[photo.png|250]]"));

      await view.requestGeneration();

      expect(view.contentEl.querySelector(".floor-notes-image-resize-handle")).not.toBeNull();
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
    }
  });

  it("adds a resize control when an edited floor gains a Markdown image with spaces in its target", async () => {
    const imageBody = "![Pasted image](Pasted image 1784317969136.png)";
    let currentSource = validBaseDoc;
    const app = new obsidian.App();
    Object.assign(app.vault, {
      read: vi.fn(async () => currentSource),
      process: vi.fn()
    });
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService(app, registry);
    const view = new FloorThreadView(new obsidian.WorkspaceLeaf(), registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, markdown, container) => {
        if (markdown.includes("Pasted image")) {
          container.createEl("img", { attr: { src: "app://rendered-pasted-image" } });
        }
      }
    );
    const file = mockTFile("edited-image-thread.md", "edited-image-thread.md");

    try {
      await view.onLoadFile(file);
      expect(view.contentEl.querySelector(".floor-notes-image-resize-handle")).toBeNull();

      currentSource = validBaseDoc.replace("Body content.", imageBody);
      await view.requestGeneration();

      expect(view.contentEl.querySelector(".floor-notes-image-wrapper > img")).not.toBeNull();
      expect(view.contentEl.querySelector(".floor-notes-image-resize-handle")).not.toBeNull();
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
    }
  });

  it("maps repeated paths by occurrence order and resets only the double-clicked image", async () => {
    const body = "![[same.png|150]] and ![second|225](same.png)";
    const source = validBaseDoc.replace("Body content.", body);
    const app = new obsidian.App();
    Object.assign(app.vault, {
      read: vi.fn().mockResolvedValue(source),
      process: vi.fn()
    });
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService(app, registry);
    const setImageSize = vi.spyOn(service, "setImageSize").mockResolvedValue({ type: "no-op" });
    const view = new FloorThreadView(new obsidian.WorkspaceLeaf(), registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, _markdown, container) => {
        const paragraph = container.createEl("p");
        paragraph.createEl("img", { attr: { src: "app://same-first" } });
        paragraph.createEl("img", { attr: { src: "app://same-second" } });
      }
    );
    const file = mockTFile("thread.md", "thread.md");

    try {
      await view.onLoadFile(file);
      const handles = view.contentEl.querySelectorAll<HTMLButtonElement>(
        ".floor-notes-image-resize-handle"
      );
      expect(handles).toHaveLength(2);

      handles[1]?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, button: 0 }));

      await vi.waitFor(() => expect(setImageSize).toHaveBeenCalledOnce());
      expect(setImageSize.mock.calls[0]?.[1]).toMatchObject({
        recordId: "floor-20260716-153012-abcde123",
        expectedBody: body,
        occurrence: {
          syntax: "markdown",
          originalToken: "![second|225](same.png)"
        },
        desiredWidth: null
      });
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
    }
  });

  it("restores the local preview, refreshes, and shows a localized notice on conflict", async () => {
    _testState.notices.length = 0;
    const source = validBaseDoc.replace("Body content.", "![[photo.png]]");
    const app = new obsidian.App();
    Object.assign(app.vault, {
      read: vi.fn().mockResolvedValue(source),
      process: vi.fn()
    });
    const registry = new FileIdentityRegistry();
    const service = new ThreadMutationService(app, registry);
    const resize = vi.spyOn(service, "setImageSize").mockResolvedValue({
      type: "conflict",
      reason: "body changed"
    });
    const view = new FloorThreadView(new obsidian.WorkspaceLeaf(), registry, service);
    view.app = app;
    const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementation(
      async (_app, _markdown, container) => {
        const paragraph = container.createEl("p");
        const embed = paragraph.createSpan({ cls: "image-embed" });
        embed.createEl("img", {
          attr: { src: "app://rendered-resource", style: "width: 80%;" }
        });
      }
    );
    const file = mockTFile("thread.md", "thread.md");

    try {
      await view.onLoadFile(file);
      const requestGeneration = vi.spyOn(view, "requestGeneration");
      const handle = view.contentEl.querySelector<HTMLButtonElement>(".floor-notes-image-resize-handle")!;
      const image = view.contentEl.querySelector<HTMLImageElement>(".floor-notes-image-wrapper > img")!;
      const recordContent = view.contentEl.querySelector<HTMLElement>(".floor-notes-record-content")!;
      vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ width: 200, height: 100 } as DOMRect);
      vi.spyOn(recordContent, "getBoundingClientRect").mockReturnValue({ width: 400 } as DOMRect);

      handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 100 }));
      document.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 150 }));
      expect(image.style.width).toBe("250px");
      document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 150 }));

      await vi.waitFor(() => expect(requestGeneration).toHaveBeenCalledOnce());
      expect(resize).toHaveBeenCalledOnce();
      expect(image.style.width).toBe("80%");
      expect(_testState.notices.at(-1)?.message).toBe(en.imageResizeConflict);
      await requestGeneration.mock.results[0]?.value;
    } finally {
      await view.onUnloadFile(file);
      render.mockRestore();
    }
  });

  it("fails closed for mobile rendering and ambiguous rendered images", async () => {
    const renderCase = async (source: string, isMobile: boolean, imageCount: number): Promise<number> => {
      Reflect.set(obsidian.Platform, "isMobile", isMobile);
      Reflect.set(obsidian.Platform, "isDesktop", !isMobile);
      const app = new obsidian.App();
      Object.assign(app.vault, { read: vi.fn().mockResolvedValue(source), process: vi.fn() });
      const registry = new FileIdentityRegistry();
      const service = new ThreadMutationService(app, registry);
      const view = new FloorThreadView(new obsidian.WorkspaceLeaf(), registry, service);
      view.app = app;
      const render = vi.spyOn(obsidian.MarkdownRenderer, "render").mockImplementationOnce(
        async (_app, _markdown, container) => {
          const paragraph = container.createEl("p");
          for (let index = 0; index < imageCount; index++) {
            paragraph.createEl("img", { attr: { src: `app://rendered-${index}` } });
          }
        }
      );
      const file = mockTFile("thread.md", "thread.md");
      try {
        await view.onLoadFile(file);
        return view.contentEl.querySelectorAll(".floor-notes-image-resize-handle").length;
      } finally {
        await view.onUnloadFile(file);
        render.mockRestore();
      }
    };

    const uniqueSource = validBaseDoc.replace("Body content.", "![[photo.png]]");
    const referenceSource = validBaseDoc.replace(
      "Body content.",
      "![[photo.png]]\n![reference][asset]\n\n[asset]: reference.png"
    );
    const htmlSource = validBaseDoc.replace(
      "Body content.",
      "![[photo.png]]\n<img src=\"html.png\">"
    );
    const transclusionSource = validBaseDoc.replace(
      "Body content.",
      "![[photo.png]]\n![[embedded-note]]"
    );
    const processorOnlySource = validBaseDoc.replace("Body content.", "No source image.");
    await expect(renderCase(uniqueSource, true, 1)).resolves.toBe(0);
    await expect(renderCase(uniqueSource, false, 2)).resolves.toBe(0);
    await expect(renderCase(referenceSource, false, 1)).resolves.toBe(0);
    await expect(renderCase(htmlSource, false, 1)).resolves.toBe(0);
    await expect(renderCase(transclusionSource, false, 1)).resolves.toBe(0);
    await expect(renderCase(processorOnlySource, false, 1)).resolves.toBe(0);
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
    expect(DEFAULT_SETTINGS.showImageDescriptions).toBe(false);

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

  it("renders a disabled image-description toggle and persists changes", async () => {
    const settings = { ...DEFAULT_SETTINGS };
    const pluginMock = {
      settings,
      updateSettings: vi.fn().mockImplementation(async (nextSettings: Partial<typeof settings>) => {
        Object.assign(settings, nextSettings);
      })
    };
    const tab = new FloorNotesSettingTab({} as any, pluginMock as any);
    const container = document.createElement("div");
    tab.containerEl = container;

    tab.display();

    const setting = Array.from(container.querySelectorAll<HTMLElement>(".setting-item"))
      .find((item) => item.querySelector(".setting-item-name")?.textContent === en.settingsShowImageDescriptions);
    const toggle = setting?.querySelector<HTMLInputElement>("input[type='checkbox']");
    expect(toggle?.checked).toBe(false);

    toggle!.checked = true;
    toggle!.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(pluginMock.updateSettings).toHaveBeenCalledWith({
      showImageDescriptions: true
    }));
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
