import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import FloorNotesPlugin from "../src/main";
import zhCn from "../src/locales/zh-cn.json";
import { t } from "../src/util/locale";
import { FloorThreadView, VIEW_TYPE_THREAD } from "../src/view/FloorThreadView";
import { FavoritesSidebarView } from "../src/view/FavoritesSidebarView";
import {
  FloorViewPosition,
  ViewPositionPersistence,
  VIEW_POSITION_VERSION
} from "../src/services/ViewPositionStore";

const { _testState } = obsidian as any;

const makeFile = (path: string): obsidian.TFile => {
  const file = new obsidian.TFile();
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  return file;
};

const makeViewPosition = (recordId: string, updatedAt = 1): FloorViewPosition => ({
  version: VIEW_POSITION_VERSION,
  page: 1,
  scrollTop: 120,
  anchorOffset: 0,
  updatedAt,
  anchorRecordId: recordId,
  floorRecordId: recordId
});

const searchableThreadDoc = `---
floor-notes: 1
---
# Searchable thread

## Floor
[id:: floor-20260729-120000-aaaabbbb]
[date:: 2026-07-29 12:00:00]

First floor body.

## Floor
[id:: floor-20260729-120100-ccccdddd]
[date:: 2026-07-29 12:01:00]

Second floor searchable body.
`;

const createAppMock = (options?: {
  readonly fileCache?: (file: obsidian.TFile) => unknown;
  readonly cachedRead?: (file: obsidian.TFile) => Promise<string>;
  readonly leaves?: unknown[];
  readonly mostRecentLeaf?: obsidian.WorkspaceLeaf | null;
  readonly activeFloorView?: FloorThreadView | null;
}) => {
  const vaultHandlers = new Map<string, ((...args: any[]) => void)[]>();
  const metadataHandlers = new Map<string, ((...args: any[]) => void)[]>();
  const workspaceHandlers = new Map<string, ((...args: any[]) => void)[]>();
  const leaves = options?.leaves ?? [];

  const registerHandler = (handlers: Map<string, ((...args: any[]) => void)[]>, name: string, callback: (...args: any[]) => void) => {
    const callbacks = handlers.get(name) ?? [];
    callbacks.push(callback);
    handlers.set(name, callbacks);
    return { name, callback };
  };

  const app = {
    vault: {
      getMarkdownFiles: vi.fn(() => []),
      getAbstractFileByPath: vi.fn((_path: string): unknown => null),
      read: vi.fn(),
      cachedRead: vi.fn(options?.cachedRead ?? (async () => "")),
      on: vi.fn((name: string, callback: (...args: any[]) => void) => registerHandler(vaultHandlers, name, callback))
    },
    metadataCache: {
      getFileCache: vi.fn(options?.fileCache ?? (() => null)),
      on: vi.fn((name: string, callback: (...args: any[]) => void) => registerHandler(metadataHandlers, name, callback))
    },
    workspace: {
      getLeavesOfType: vi.fn(() => leaves),
      iterateAllLeaves: vi.fn((callback: (leaf: unknown) => void) => {
        leaves.forEach(callback);
      }),
      getMostRecentLeaf: vi.fn(() => options?.mostRecentLeaf ?? null),
      getActiveViewOfType: vi.fn((viewType: unknown) => viewType === FloorThreadView
        ? options?.activeFloorView ?? null
        : null),
      requestSaveLayout: vi.fn(),
      on: vi.fn((name: string, callback: (...args: any[]) => void) => registerHandler(workspaceHandlers, name, callback)),
      getActiveFile: vi.fn(() => null)
    },
    fileManager: {
      processFrontMatter: vi.fn()
    }
  };

  return { app, vaultHandlers, metadataHandlers, workspaceHandlers };
};

const plugins: FloorNotesPlugin[] = [];

describe("FloorNotesPlugin vault lifecycle and routing", () => {
  afterEach(() => {
    for (const plugin of plugins.splice(0)) {
      plugin.unload();
    }
  });

  it("keeps identity, layout, and matching views synchronized after rename, modify, and delete", async () => {
    const file = makeFile("thread.md");
    const requestGeneration = vi.fn().mockResolvedValue(undefined);
    const view = Object.create(FloorThreadView.prototype) as FloorThreadView;
    Object.assign(view, {
      file,
      requestGeneration,
      handleFileRename: vi.fn(),
      clearPositionForPath: vi.fn()
    });
    const { app, vaultHandlers } = createAppMock({ leaves: [{ view }] });
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();

    const token = plugin.registry.getOrCreateIdentity(file);
    const modify = vaultHandlers.get("modify")?.at(-1);
    modify?.(file);
    expect(requestGeneration).toHaveBeenCalledOnce();

    file.path = "renamed-thread.md";
    const rename = vaultHandlers.get("rename")?.at(-1);
    rename?.(file, "thread.md");
    expect(plugin.registry.getIdentityInfo(token)).toMatchObject({
      path: "renamed-thread.md",
      epoch: 1,
      state: "active"
    });
    expect(app.workspace.requestSaveLayout).toHaveBeenCalledOnce();
    expect(requestGeneration).toHaveBeenCalledTimes(2);

    const remove = vaultHandlers.get("delete")?.at(-1);
    remove?.(file);
    expect(plugin.registry.getIdentityInfo(token)).toBeUndefined();
  });

  it("clears rather than migrates recent positions when a file is renamed or deleted", async () => {
    const file = makeFile("thread.md");
    const position = makeViewPosition("floor-20260729-120000-aaaabbbb");
    const { app, vaultHandlers } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      restoreLastViewPosition: true,
      viewPositions: {
        version: VIEW_POSITION_VERSION,
        entries: [{ path: "thread.md", position }]
      }
    });
    const saveData = vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);
    await plugin.onload();

    file.path = "renamed.md";
    vaultHandlers.get("rename")?.at(-1)?.(file, "thread.md");
    await vi.waitFor(() => expect(plugin.viewPositions.get("thread.md")).toBeUndefined());
    expect(plugin.viewPositions.get("renamed.md")).toBeUndefined();

    plugin.viewPositions.set("renamed.md", { ...position, updatedAt: 2 });
    vaultHandlers.get("delete")?.at(-1)?.(file);
    await vi.waitFor(() => expect(plugin.viewPositions.get("renamed.md")).toBeUndefined());
    expect(saveData).toHaveBeenCalled();
  });

  it("routes candidates without mutating the caller's ViewState", async () => {
    const file = makeFile("thread.md");
    const leaf = new (obsidian.WorkspaceLeaf as any)();
    const { app } = createAppMock({
      mostRecentLeaf: leaf,
      fileCache: (candidate) => candidate === file ? { frontmatter: { "floor-notes": 1 } } : null
    });
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === file.path ? file : null);
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();

    const state = { type: "markdown", state: { file: file.path, mode: "source" } };
    await leaf.setViewState(state);

    expect(state).toEqual({ type: "markdown", state: { file: file.path, mode: "source" } });
    expect(leaf.setViewStateCalls).toHaveLength(1);
    expect(leaf.setViewStateCalls[0]?.state).toEqual({
      type: VIEW_TYPE_THREAD,
      state: { file: file.path, mode: "source" }
    });
    expect(leaf.setViewStateCalls[0]?.state.state).not.toBe(state.state);
  });

  it("routes an Obsidian search match to the floor containing its source offset", async () => {
    const file = makeFile("thread.md");
    const leaf = new (obsidian.WorkspaceLeaf as any)();
    const matchStart = searchableThreadDoc.indexOf("searchable body");
    const eState = {
      match: {
        score: 1,
        matches: [[matchStart, matchStart + "searchable".length]]
      }
    };
    const { app } = createAppMock({
      mostRecentLeaf: leaf,
      fileCache: (candidate) => candidate === file ? { frontmatter: { "floor-notes": 1 } } : null,
      cachedRead: async () => searchableThreadDoc
    });
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === file.path ? file : null);
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();

    await leaf.setViewState(
      { type: "markdown", state: { file: file.path } },
      eState
    );

    expect(leaf.setViewStateCalls).toEqual([{
      state: {
        type: VIEW_TYPE_THREAD,
        state: {
          file: file.path,
          recordId: "floor-20260729-120100-ccccdddd"
        }
      },
      eState
    }]);
  });

  it("focuses a search line inside the currently open floor view without switching to Markdown", async () => {
    const file = makeFile("thread.md");
    const leaf = new (obsidian.WorkspaceLeaf as any)();
    const requestGeneration = vi.fn().mockResolvedValue(undefined);
    const view = Object.create(FloorThreadView.prototype) as FloorThreadView;
    Object.assign(view, { file, requestGeneration });
    leaf.view = view;
    const secondFloorLine = searchableThreadDoc
      .slice(0, searchableThreadDoc.indexOf("Second floor searchable body."))
      .split("\n").length - 1;
    const { app } = createAppMock({
      mostRecentLeaf: leaf,
      fileCache: (candidate) => candidate === file ? { frontmatter: { "floor-notes": 1 } } : null,
      cachedRead: async () => searchableThreadDoc
    });
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === file.path ? file : null);
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();

    await leaf.setViewState(
      { type: "markdown", state: { file: file.path } },
      { line: secondFloorLine }
    );

    expect(requestGeneration).toHaveBeenCalledWith("floor-20260729-120100-ccccdddd");
    expect(leaf.setViewStateCalls).toHaveLength(0);
  });

  it("does not let an older cached-read probe replace a newer leaf route", async () => {
    const file = makeFile("thread.md");
    const leaf = new (obsidian.WorkspaceLeaf as any)();
    let resolveRead: ((text: string) => void) | undefined;
    const { app } = createAppMock({
      mostRecentLeaf: leaf,
      cachedRead: () => new Promise<string>((resolve) => {
        resolveRead = resolve;
      })
    });
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === file.path ? file : null);
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();

    const olderRoute = leaf.setViewState({ type: "markdown", state: { file: file.path } });
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf("function"));
    await leaf.setViewState({ type: "canvas", state: { file: "board.canvas" } });
    resolveRead?.("---\nfloor-notes: 1\n---\n");
    await olderRoute;

    expect(leaf.setViewStateCalls).toEqual([
      { state: { type: "canvas", state: { file: "board.canvas" } }, eState: undefined }
    ]);
  });

  it("shows exactly one floor view command for the active note configuration", async () => {
    const file = makeFile("thread.md");
    let frontmatter: Record<string, unknown> | undefined = { "floor-notes": 1 };
    const { app } = createAppMock({
      fileCache: (candidate) => candidate === file ? { frontmatter } : null
    });
    app.workspace.getActiveFile.mockReturnValue(file as never);
    app.fileManager.processFrontMatter.mockImplementation(async (_file: obsidian.TFile, update: (fm: Record<string, unknown>) => void) => {
      frontmatter ??= {};
      update(frontmatter);
    });

    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();
    const openFileInThreadView = vi.spyOn(plugin, "openFileInThreadView").mockResolvedValue(undefined);
    const commands = (plugin as any).registeredCommands as {
      id: string;
      checkCallback?: (checking: boolean) => boolean;
    }[];
    const openCommand = commands.find((command) => command.id === "open-as-floor-thread");
    const enableCommand = commands.find((command) => command.id === "enable-for-active-file");

    expect(openCommand?.checkCallback?.(true)).toBe(true);
    expect(enableCommand?.checkCallback?.(true)).toBe(false);
    expect(openCommand?.checkCallback?.(false)).toBe(true);
    expect(openFileInThreadView).toHaveBeenCalledWith(file);

    frontmatter = {};
    expect(openCommand?.checkCallback?.(true)).toBe(false);
    expect(enableCommand?.checkCallback?.(true)).toBe(true);
    expect(enableCommand?.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() => {
      expect(frontmatter?.["floor-notes"]).toBe(1);
      expect(frontmatter?.["floor-notes-view-style"]).toBe("bubble");
    });

    frontmatter = undefined;
    expect(openCommand?.checkCallback?.(true)).toBe(false);
    expect(enableCommand?.checkCallback?.(true)).toBe(true);
    expect(enableCommand?.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() => {
      expect(frontmatter?.["floor-notes"]).toBe(1);
    });
  });

  it("hides floor view commands while the active view already is a floor thread", async () => {
    const file = makeFile("thread.md");
    const activeFloorView = Object.create(FloorThreadView.prototype) as FloorThreadView;
    const { app } = createAppMock({
      activeFloorView,
      fileCache: (candidate) => candidate === file ? { frontmatter: { "floor-notes": 1 } } : null
    });
    app.workspace.getActiveFile.mockReturnValue(file as never);

    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();
    const openFileInThreadView = vi.spyOn(plugin, "openFileInThreadView").mockResolvedValue(undefined);
    const commands = (plugin as any).registeredCommands as {
      id: string;
      checkCallback?: (checking: boolean) => boolean;
    }[];
    const openCommand = commands.find((command) => command.id === "open-as-floor-thread");
    const enableCommand = commands.find((command) => command.id === "enable-for-active-file");

    expect(openCommand?.checkCallback?.(true)).toBe(false);
    expect(openCommand?.checkCallback?.(false)).toBe(false);
    expect(enableCommand?.checkCallback?.(true)).toBe(false);
    expect(enableCommand?.checkCallback?.(false)).toBe(false);
    expect(openFileInThreadView).not.toHaveBeenCalled();
    expect(app.workspace.getActiveViewOfType).toHaveBeenCalledWith(FloorThreadView);
  });

  it("migrates the former reply style setting to the default view style", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    vi.spyOn(plugin, "loadData").mockResolvedValue({ replyStyle: "glass" });

    await plugin.onload();

    expect(plugin.settings.defaultViewStyle).toBe("glass");
    expect((plugin.settings as unknown as Record<string, unknown>).replyStyle).toBeUndefined();
  });

  it("prefers a valid persisted default view style over the legacy reply style", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      defaultViewStyle: "paper",
      replyStyle: "glass"
    });

    await plugin.onload();

    expect(plugin.settings.defaultViewStyle).toBe("paper");
  });

  it("normalizes invalid persisted theme and mode values once", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      theme: "retired-theme",
      mode: "system",
      defaultViewStyle: "bubble"
    });
    const saveData = vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);

    await plugin.onload();

    expect(plugin.settings.theme).toBe("obsidian");
    expect(plugin.settings.mode).toBe("auto");
    expect(saveData).toHaveBeenCalledOnce();
  });

  it("loads image-description visibility only from a persisted boolean", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      showImageDescriptions: true
    });

    await plugin.onload();

    expect(plugin.settings.showImageDescriptions).toBe(true);
  });

  it("loads versioned recent positions without letting a setting update overwrite them", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    const position = makeViewPosition("floor-20260729-120000-aaaabbbb");
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      restoreLastViewPosition: true,
      viewPositions: {
        version: VIEW_POSITION_VERSION,
        entries: [{ path: "thread.md", position }]
      }
    });
    const saveData = vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);

    await plugin.onload();
    expect(plugin.settings.restoreLastViewPosition).toBe(true);
    expect(plugin.viewPositions.get("thread.md")).toEqual(position);

    await plugin.updateSettings({ showImageDescriptions: true });
    expect(saveData).toHaveBeenCalledOnce();
    expect(saveData).toHaveBeenLastCalledWith(expect.objectContaining({
      showImageDescriptions: true,
      viewPositions: {
        version: VIEW_POSITION_VERSION,
        entries: [{ path: "thread.md", position }]
      }
    }));
  });

  it("normalizes an invalid position setting and removes disabled position history", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      restoreLastViewPosition: "yes",
      viewPositions: {
        version: VIEW_POSITION_VERSION,
        entries: [{
          path: "thread.md",
          position: makeViewPosition("floor-20260729-120000-aaaabbbb")
        }]
      }
    });
    const saveData = vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);

    await plugin.onload();

    expect(plugin.settings.restoreLastViewPosition).toBe(false);
    expect(plugin.viewPositions.size).toBe(0);
    expect(saveData).toHaveBeenCalledOnce();
    expect(saveData.mock.calls[0]?.[0]).not.toHaveProperty("viewPositions");
  });

  it("clears pane and recent positions when restoration is disabled", async () => {
    const threadView = Object.create(FloorThreadView.prototype) as FloorThreadView;
    const handlePositionSettingChanged = vi.fn();
    Object.assign(threadView, {
      applyTheme: vi.fn(),
      requestGeneration: vi.fn().mockResolvedValue(undefined),
      handlePositionSettingChanged
    });
    const { app } = createAppMock({ leaves: [{ view: threadView }] });
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    const position = makeViewPosition("floor-20260729-120000-aaaabbbb");
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      restoreLastViewPosition: true,
      viewPositions: {
        version: VIEW_POSITION_VERSION,
        entries: [{ path: "thread.md", position }]
      }
    });
    const saveData = vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);
    await plugin.onload();

    await plugin.updateSettings({ restoreLastViewPosition: false });

    expect(plugin.viewPositions.size).toBe(0);
    expect(handlePositionSettingChanged).toHaveBeenCalledWith(false);
    expect(app.workspace.requestSaveLayout).toHaveBeenCalledOnce();
    expect(saveData).toHaveBeenLastCalledWith(expect.not.objectContaining({
      viewPositions: expect.anything()
    }));
  });

  it("debounces recent-position persistence and saves the newest snapshot", async () => {
    vi.useFakeTimers();
    try {
      const { app } = createAppMock();
      const plugin = new FloorNotesPlugin(app as never, {} as never);
      plugins.push(plugin);
      vi.spyOn(plugin, "loadData").mockResolvedValue({
        restoreLastViewPosition: true
      });
      const saveData = vi.spyOn(plugin, "saveData").mockResolvedValue(undefined);
      await plugin.onload();
      const persistence = (plugin as unknown as {
        positionPersistence: ViewPositionPersistence;
      }).positionPersistence;

      persistence.setRecent(
        "thread.md",
        makeViewPosition("floor-20260729-120000-aaaabbbb", 1),
        window
      );
      const newest = makeViewPosition("floor-20260729-120100-ccccdddd", 2);
      persistence.setRecent("thread.md", newest, window);

      await vi.advanceTimersByTimeAsync(499);
      expect(saveData).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(saveData).toHaveBeenCalledOnce();
      expect(saveData).toHaveBeenCalledWith(expect.objectContaining({
        viewPositions: {
          version: VIEW_POSITION_VERSION,
          entries: [{ path: "thread.md", position: newest }]
        }
      }));
      expect(app.workspace.requestSaveLayout).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not let stale validation delete a position another pane just updated", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    const original = makeViewPosition("floor-20260729-120000-aaaabbbb", 1);
    vi.spyOn(plugin, "loadData").mockResolvedValue({
      restoreLastViewPosition: true,
      viewPositions: {
        version: VIEW_POSITION_VERSION,
        entries: [{ path: "thread.md", position: original }]
      }
    });
    await plugin.onload();
    const loadedOriginal = plugin.viewPositions.get("thread.md")!;
    const newer = makeViewPosition("floor-20260729-120100-ccccdddd", 2);
    plugin.viewPositions.set("thread.md", newer);
    const persistence = (plugin as unknown as {
      positionPersistence: ViewPositionPersistence;
    }).positionPersistence;

    persistence.removeRecent("thread.md", loadedOriginal);

    expect(plugin.viewPositions.get("thread.md")).toEqual(newer);
  });

  it("shares pane history across floor-view instances created for the same leaf", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();
    const registration = (plugin as any).registeredViews.find(
      (candidate: { type: string }) => candidate.type === VIEW_TYPE_THREAD
    ) as { creator: (leaf: obsidian.WorkspaceLeaf) => FloorThreadView };
    const leaf = new obsidian.WorkspaceLeaf();
    const otherLeaf = new obsidian.WorkspaceLeaf();
    const first = registration.creator(leaf);
    const replacement = registration.creator(leaf);
    const otherPane = registration.creator(otherLeaf);
    const getPanePositions = (view: FloorThreadView): unknown =>
      (view as unknown as { panePositions: unknown }).panePositions;

    expect(getPanePositions(replacement)).toBe(getPanePositions(first));
    expect(getPanePositions(otherPane)).not.toBe(getPanePositions(first));
  });

  it("keeps the Obsidian language for auto locale after reload and unrelated setting updates", async () => {
    const { app } = createAppMock();
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    _testState.language = "zh-cn";
    vi.spyOn(plugin, "loadData").mockResolvedValue({ locale: "auto" });

    try {
      await plugin.onload();
      expect(plugin.settings.locale).toBe("auto");
      expect(t("settingsTitle")).toBe(zhCn.settingsTitle);

      await plugin.updateSettings({ showImageDescriptions: true });
      expect(plugin.settings.locale).toBe("auto");
      expect(t("settingsTitle")).toBe(zhCn.settingsTitle);
    } finally {
      _testState.language = "en";
    }
  });

  it("refreshes favorites after a locale change without recreating open thread views", async () => {
    const threadView = Object.create(FloorThreadView.prototype) as FloorThreadView;
    const threadApplyTheme = vi.fn();
    const requestGeneration = vi.fn().mockResolvedValue(undefined);
    Object.assign(threadView, { applyTheme: threadApplyTheme, requestGeneration });

    const favoritesView = Object.create(FavoritesSidebarView.prototype) as FavoritesSidebarView;
    const favoritesApplyTheme = vi.fn();
    const favoritesRefresh = vi.fn();
    Object.assign(favoritesView, { applyTheme: favoritesApplyTheme, refresh: favoritesRefresh });

    const { app } = createAppMock({ leaves: [{ view: threadView }, { view: favoritesView }] });
    const plugin = new FloorNotesPlugin(app as never, {} as never);
    plugins.push(plugin);
    await plugin.onload();

    await plugin.updateSettings({ locale: "zh-cn" });
    expect(threadApplyTheme).toHaveBeenCalledOnce();
    expect(requestGeneration).toHaveBeenCalledOnce();
    expect(favoritesRefresh).toHaveBeenCalledOnce();
    expect(favoritesApplyTheme).not.toHaveBeenCalled();

    await plugin.updateSettings({ theme: "dracula" });
    expect(favoritesRefresh).toHaveBeenCalledOnce();
    expect(favoritesApplyTheme).toHaveBeenCalledOnce();
  });
});
