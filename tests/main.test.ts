import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import FloorNotesPlugin from "../src/main";
import { FloorThreadView, VIEW_TYPE_THREAD } from "../src/view/FloorThreadView";
import { FavoritesSidebarView } from "../src/view/FavoritesSidebarView";

const makeFile = (path: string): obsidian.TFile => {
  const file = new obsidian.TFile();
  file.path = path;
  file.name = path.split("/").pop() ?? path;
  file.basename = file.name.replace(/\.md$/, "");
  file.extension = "md";
  return file;
};

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
      requestGeneration
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
    expect(plugin.registry.getIdentityInfo(token)).toMatchObject({
      epoch: 2,
      state: "tombstoned"
    });
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
