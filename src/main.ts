import { Plugin, WorkspaceLeaf, TFile, Notice, ViewState, FileView } from "obsidian";
import { parsePhysicalLines } from "./format/physicalLines";
import { parseFrontmatter } from "./format/frontmatter";
import { parseThreadDocument } from "./format/parser";
import {
  FloorNotesSettings,
  DEFAULT_SETTINGS,
  isDefaultSortOrder,
  isLocale,
  isPreferredNewline,
  isThreadViewStyle
} from "./settings/types";
import { isFloorNotesMode, isFloorNotesTheme } from "./theme";
import { FloorNotesSettingTab } from "./settings/settingsTab";
import { setLocale, t } from "./util/locale";
import { FileIdentityRegistry } from "./services/FileIdentityRegistry";
import { ThreadMutationService } from "./services/ThreadMutationService";
import { FloorThreadView, VIEW_TYPE_THREAD } from "./view/FloorThreadView";
import { FavoritesIndex } from "./services/FavoritesIndex";
import { FavoritesSidebarView, VIEW_TYPE_FAVORITES } from "./view/FavoritesSidebarView";
import {
  hasSourceNavigationState,
  resolveRecordIdFromNavigationState
} from "./view/sourceNavigation";
import {
  FloorViewPosition,
  ViewPositionPersistence,
  ViewPositionStore
} from "./services/ViewPositionStore";


export default class FloorNotesPlugin extends Plugin {
  public settings!: FloorNotesSettings;
  public registry!: FileIdentityRegistry;
  public mutationService!: ThreadMutationService;
  public favoritesIndex!: FavoritesIndex;
  public viewPositions!: ViewPositionStore;
  private positionPersistence!: ViewPositionPersistence;
  private persistTail: Promise<void> = Promise.resolve();
  private positionSaveTimer: number | null = null;
  private positionSaveWindow: Window | null = null;
  private viewPositionsDirty = false;
  private readonly panePositionsByLeaf = new WeakMap<WorkspaceLeaf, Map<string, FloorViewPosition>>();

  override async onload(): Promise<void> {
    // 1. Synchronously initialize all fields to avoid race conditions during async loadData yielding
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.registry = new FileIdentityRegistry();
    this.mutationService = new ThreadMutationService(
      this.app,
      this.registry,
      () => this.settings.preferredNewline
    );
    this.favoritesIndex = new FavoritesIndex(this.app, this);
    this.favoritesIndex.init();
    this.viewPositions = new ViewPositionStore();
    this.positionPersistence = {
      isEnabled: () => this.settings.restoreLastViewPosition,
      getRecent: (path) => this.viewPositions.get(path),
      setRecent: (path, position, ownerWindow) => {
        this.recordRecentPosition(path, position, ownerWindow);
      },
      removeRecent: (path, expectedPosition) => {
        this.removeRecentPosition(path, expectedPosition);
      },
      flush: async () => {
        await this.flushViewPositions();
      }
    };

    // 2. Load settings from the untrusted persistence boundary and retain only valid fields.
    const loadedData = (await this.loadData()) as Record<string, unknown> | null;
    const source = loadedData && typeof loadedData === "object" ? loadedData : {};
    const resolvedTheme = isFloorNotesTheme(source.theme) ? source.theme : DEFAULT_SETTINGS.theme;
    const resolvedMode = isFloorNotesMode(source.mode) ? source.mode : DEFAULT_SETTINGS.mode;
    const resolvedViewStyle = isThreadViewStyle(source.defaultViewStyle)
      ? source.defaultViewStyle
      : isThreadViewStyle(source.replyStyle)
        ? source.replyStyle
        : DEFAULT_SETTINGS.defaultViewStyle;
    const normalizedSettings: FloorNotesSettings = {
      preferredNewline: isPreferredNewline(source.preferredNewline)
        ? source.preferredNewline
        : DEFAULT_SETTINGS.preferredNewline,
      defaultSortOrder: isDefaultSortOrder(source.defaultSortOrder)
        ? source.defaultSortOrder
        : DEFAULT_SETTINGS.defaultSortOrder,
      locale: isLocale(source.locale) ? source.locale : DEFAULT_SETTINGS.locale,
      theme: resolvedTheme,
      mode: resolvedMode,
      autoOpenThreadView: typeof source.autoOpenThreadView === "boolean"
        ? source.autoOpenThreadView
        : DEFAULT_SETTINGS.autoOpenThreadView,
      restoreLastViewPosition: typeof source.restoreLastViewPosition === "boolean"
        ? source.restoreLastViewPosition
        : DEFAULT_SETTINGS.restoreLastViewPosition,
      showImageDescriptions: typeof source.showImageDescriptions === "boolean"
        ? source.showImageDescriptions
        : DEFAULT_SETTINGS.showImageDescriptions,
      defaultViewStyle: resolvedViewStyle
    };
    const settingKeys = [
      "preferredNewline", "defaultSortOrder", "locale", "theme", "mode", "autoOpenThreadView",
      "restoreLastViewPosition", "showImageDescriptions", "defaultViewStyle"
    ];
    const persistedKeys = [...settingKeys, "viewPositions"];
    const shouldNormalizeViewPositions = this.viewPositions.load(source.viewPositions);
    const discardedDisabledViewPositions = !normalizedSettings.restoreLastViewPosition
      && (this.viewPositions.clear() || source.viewPositions !== undefined);
    const shouldPersistNormalizedSettings =
      source.replyStyle !== undefined ||
      Object.keys(source).some((key) => !persistedKeys.includes(key)) ||
      settingKeys.some((key) =>
        Object.prototype.hasOwnProperty.call(source, key) &&
        source[key] !== normalizedSettings[key as keyof FloorNotesSettings]
      ) ||
      shouldNormalizeViewPositions ||
      discardedDisabledViewPositions;

    Object.assign(this.settings, normalizedSettings);
    setLocale(this.settings.locale);
    if (shouldPersistNormalizedSettings) {
      await this.persistData();
    }


    // 3. Register views
    this.registerView(
      VIEW_TYPE_THREAD,
      (leaf: WorkspaceLeaf) => new FloorThreadView(
        leaf,
        this.registry,
        this.mutationService,
        this.settings,
        this.positionPersistence,
        this.getPanePositions(leaf)
      )
    );

    this.registerView(
      VIEW_TYPE_FAVORITES,
      (leaf: WorkspaceLeaf) => new FavoritesSidebarView(leaf, this.favoritesIndex, this.settings)
    );

    // 4. Hook mutation updates to reload views
    this.mutationService.addAppliedListener((token) => {
      this.app.workspace.getLeavesOfType(VIEW_TYPE_THREAD).forEach((leaf) => {
        if (leaf.view instanceof FloorThreadView && leaf.view.file) {
          const viewToken = this.registry.getOrCreateIdentity(leaf.view.file);
          if (viewToken === token) {
            void leaf.view.requestGeneration();
          }
        }
      });
    });

    // 5. Keep file identities and open thread views synchronized with Vault changes.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile) {
          this.registry.handleRename(file, oldPath);
          this.removeRecentPosition(oldPath);
          this.removeRecentPosition(file.path);
          this.clearPanePositionsForPath(oldPath);
          this.clearPanePositionsForPath(file.path);
          this.app.workspace.getLeavesOfType(VIEW_TYPE_THREAD).forEach((leaf) => {
            if (leaf.view instanceof FloorThreadView) {
              leaf.view.handleFileRename(file, oldPath);
            }
          });
          this.app.workspace.requestSaveLayout();
          this.requestGenerationForFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.removeRecentPosition(file.path);
          this.clearPanePositionsForPath(file.path);
          this.app.workspace.getLeavesOfType(VIEW_TYPE_THREAD).forEach((leaf) => {
            if (leaf.view instanceof FloorThreadView) {
              leaf.view.clearPositionForPath(file.path);
            }
          });
          this.registry.handleDelete(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile) {
          this.requestGenerationForFile(file);
        }
      })
    );

    // 6. Register Settings Tab
    this.addSettingTab(new FloorNotesSettingTab(this.app, this));

    // 6. Register Commands
    this.addCommand({
      id: "open-as-floor-thread",
      name: t("openAsFloorThreadCommand"),
      checkCallback: (checking) => {
        const activeFile = this.getActiveFloorViewFile();
        if (!activeFile || !activeFile.configured || this.app.workspace.getActiveViewOfType(FloorThreadView)) {
          return false;
        }
        if (!checking) {
          void this.openFileInThreadView(activeFile.file);
        }
        return true;
      }
    });

    this.addCommand({
      id: "open-favorites-sidebar",
      name: t("openFavoritesSidebarCommand"),
      callback: () => {
        void this.openFavoritesSidebar();
      }
    });

    this.addCommand({
      id: "enable-for-active-file",
      name: t("enableFloorNotes"),
      checkCallback: (checking) => {
        const activeFile = this.getActiveFloorViewFile();
        if (!activeFile || activeFile.configured) {
          return false;
        }
        if (!checking) {
          void this.enableFloorView(activeFile.file);
        }
        return true;
      }
    });

    // 7. Register ribbon icons and file menu context handlers
    this.addRibbonIcon("sheets-in-box", t("openFloorThreadTitle"), () => {
      const file = this.app.workspace.getActiveFile();
      if (file) {
        void this.openFileInThreadView(file);
      }
    });

    this.addRibbonIcon("star", t("openFavoritesSidebarCommand"), () => {
      void this.openFavoritesSidebar();
    });

    // Monkey-patch setViewState to intercept opening candidate files.
    /* eslint-disable @typescript-eslint/unbound-method -- Intercepting prototype method */
    const originalSetViewState = WorkspaceLeaf.prototype.setViewState;
    const setViewStateRequests = new WeakMap<WorkspaceLeaf, number>();
    let nextSetViewStateRequest = 0;
    /* eslint-disable-next-line @typescript-eslint/no-this-alias -- Keep plugin instance context inside monkey patch */
    const plugin = this;

    const patchedSetViewState = async function (
      this: WorkspaceLeaf,
      state: ViewState,
      eState?: unknown
    ): Promise<void> {
      const requestId = ++nextSetViewStateRequest;
      setViewStateRequests.set(this, requestId);

      if (!plugin.settings.autoOpenThreadView) {
        return originalSetViewState.apply(this, [state, eState]);
      }

      const stateData = state.state;
      const filePath = state.type === "markdown" && typeof stateData?.file === "string"
        ? stateData.file
        : null;
      const currentFile = this.view instanceof FileView ? this.view.file : null;
      const isSameFile = currentFile !== null && currentFile.path === filePath;

      if (
        filePath === null ||
        !filePath.endsWith(".md") ||
        stateData?.bypassThreadView === true
      ) {
        return originalSetViewState.apply(this, [state, eState]);
      }

      const file = plugin.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) {
        return originalSetViewState.apply(this, [state, eState]);
      }

      let isCandidate = plugin.app.metadataCache.getFileCache(file)?.frontmatter?.["floor-notes"] === 1;
      const hasSourceNavigation = hasSourceNavigationState(eState);
      let content: string | null = null;

      if (!isCandidate || hasSourceNavigation) {
        try {
          content = await plugin.app.vault.cachedRead(file);
          if (!isCandidate) {
            const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(content);
            isCandidate = parseFrontmatter(content, bomSpan, lines, terminalEolSpan).frontmatter?.version === 1;
          }
        } catch {
          // A failed read leaves the file on the regular Markdown route.
        }
      }

      // An older async probe must never route a leaf after a newer request has superseded it.
      if (setViewStateRequests.get(this) !== requestId) {
        return;
      }

      if (!isCandidate || plugin.app.vault.getAbstractFileByPath(filePath) !== file) {
        return originalSetViewState.apply(this, [state, eState]);
      }

      let recordId: string | undefined;
      if (hasSourceNavigation && content !== null) {
        const parseResult = parseThreadDocument(content, file.name, {
          defaultSortOrder: plugin.settings.defaultSortOrder,
          defaultViewStyle: plugin.settings.defaultViewStyle
        });
        if (parseResult.ok) {
          recordId = resolveRecordIdFromNavigationState(parseResult.doc, eState);
        }
      }

      if (isSameFile && this.view instanceof FloorThreadView) {
        if (recordId) {
          await this.view.requestGeneration(recordId);
          return;
        }
        return originalSetViewState.apply(this, [state, eState]);
      }

      const threadState: ViewState = {
        ...state,
        type: VIEW_TYPE_THREAD,
        state: {
          ...stateData,
          ...(recordId ? { recordId } : {})
        }
      };
      return originalSetViewState.apply(this, [threadState, eState]);
    };

    WorkspaceLeaf.prototype.setViewState = patchedSetViewState;
    this.register(() => {
      if (WorkspaceLeaf.prototype.setViewState === patchedSetViewState) {
        WorkspaceLeaf.prototype.setViewState = originalSetViewState;
      }
    });
    /* eslint-enable @typescript-eslint/unbound-method -- Re-enable after monkey patch */

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof TFile && file.extension === "md") {
          menu.addItem((item) => {
            item
              .setTitle(t("openAsFloorThreadCommand"))
              .setIcon("sheets-in-box")
              .onClick(() => {
                void this.openFileInThreadView(file);
              });
          });
        }
      })
    );
  }

  override onunload(): void {
    this.cancelPositionSaveTimer();
    void this.flushViewPositions();
    // Obsidian automatically cleans up registered views, commands, and events.
  }

  public async updateSettings(settings: Partial<FloorNotesSettings>): Promise<void> {
    const localeChanged = settings.locale !== undefined && settings.locale !== this.settings.locale;
    const positionSettingChanged = settings.restoreLastViewPosition !== undefined
      && settings.restoreLastViewPosition !== this.settings.restoreLastViewPosition;
    Object.assign(this.settings, settings);
    setLocale(this.settings.locale);

    if (positionSettingChanged && !this.settings.restoreLastViewPosition) {
      this.cancelPositionSaveTimer();
      this.viewPositionsDirty = false;
      this.viewPositions.clear();
      this.clearAllPanePositions();
    }

    await this.persistData();

    if (positionSettingChanged) {
      this.app.workspace.getLeavesOfType(VIEW_TYPE_THREAD).forEach((leaf) => {
        if (leaf.view instanceof FloorThreadView) {
          leaf.view.handlePositionSettingChanged(this.settings.restoreLastViewPosition);
        }
      });
      this.app.workspace.requestSaveLayout();
    }

    // Apply settings changes dynamically to open views
    this.app.workspace.getLeavesOfType(VIEW_TYPE_THREAD).forEach((leaf) => {
      if (leaf.view instanceof FloorThreadView) {
        leaf.view.applyTheme();
        void leaf.view.requestGeneration();
      }
    });

    // Also refresh the favorites sidebar when its localized text changes.
    this.app.workspace.getLeavesOfType(VIEW_TYPE_FAVORITES).forEach((leaf) => {
      if (leaf.view instanceof FavoritesSidebarView) {
        if (localeChanged) {
          leaf.view.refresh();
        } else {
          leaf.view.applyTheme();
        }
      }
    });
  }

  public async openFileInThreadView(file: TFile, recordId?: string): Promise<void> {
    const leaf = this.app.workspace.getMostRecentLeaf();
    if (!leaf) {
      return;
    }

    await leaf.setViewState({
      type: VIEW_TYPE_THREAD,
      state: { file: file.path, recordId }
    });
  }

  private getActiveFloorViewFile(): { file: TFile; configured: boolean } | null {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      return null;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};

    return {
      file,
      configured: Object.prototype.hasOwnProperty.call(frontmatter, "floor-notes")
    };
  }

  private async enableFloorView(file: TFile): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, "floor-notes")) {
          frontmatter["floor-notes"] = 1;
        }
        if (!Object.prototype.hasOwnProperty.call(frontmatter, "floor-notes-view-style")) {
          frontmatter["floor-notes-view-style"] = this.settings.defaultViewStyle;
        }
      });
      await this.openFileInThreadView(file);
    } catch {
      new Notice(t("enableFloorViewFailed"));
    }
  }

  private requestGenerationForFile(file: TFile): void {
    const token = this.registry.getOrCreateIdentity(file);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_THREAD)) {
      if (leaf.view instanceof FloorThreadView && leaf.view.file) {
        const viewToken = this.registry.getOrCreateIdentity(leaf.view.file);
        if (viewToken === token) {
          void leaf.view.requestGeneration();
        }
      }
    }
  }

  private buildPersistedData(): Record<string, unknown> {
    return {
      ...this.settings,
      ...(this.settings.restoreLastViewPosition && this.viewPositions.size > 0
        ? { viewPositions: this.viewPositions.serialize() }
        : {})
    };
  }

  private getPanePositions(leaf: WorkspaceLeaf): Map<string, FloorViewPosition> {
    let positions = this.panePositionsByLeaf.get(leaf);
    if (!positions) {
      positions = new Map<string, FloorViewPosition>();
      this.panePositionsByLeaf.set(leaf, positions);
    }
    return positions;
  }

  private clearPanePositionsForPath(path: string): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.panePositionsByLeaf.get(leaf)?.delete(path);
    });
  }

  private clearAllPanePositions(): void {
    this.app.workspace.iterateAllLeaves((leaf) => {
      this.panePositionsByLeaf.get(leaf)?.clear();
    });
  }

  private persistData(): Promise<void> {
    const snapshot = this.buildPersistedData();
    const operation = this.persistTail.then(
      async () => this.saveData(snapshot),
      async () => this.saveData(snapshot)
    );
    this.persistTail = operation.catch(() => undefined);
    return operation;
  }

  private recordRecentPosition(
    path: string,
    position: FloorViewPosition,
    ownerWindow: Window
  ): void {
    if (!this.settings.restoreLastViewPosition) {
      return;
    }
    if (!this.viewPositions.set(path, position)) {
      return;
    }
    this.viewPositionsDirty = true;
    this.schedulePositionSave(ownerWindow);
  }

  private removeRecentPosition(
    path: string,
    expectedPosition?: FloorViewPosition
  ): void {
    if (expectedPosition && this.viewPositions.get(path) !== expectedPosition) {
      return;
    }
    if (!this.viewPositions.delete(path)) {
      return;
    }
    this.viewPositionsDirty = true;
    void this.flushViewPositions();
  }

  private schedulePositionSave(ownerWindow: Window): void {
    this.cancelPositionSaveTimer();
    this.positionSaveWindow = ownerWindow;
    this.positionSaveTimer = ownerWindow.setTimeout(() => {
      this.positionSaveTimer = null;
      this.positionSaveWindow = null;
      void this.flushViewPositions();
    }, 500);
  }

  private cancelPositionSaveTimer(): void {
    if (this.positionSaveTimer !== null && this.positionSaveWindow) {
      this.positionSaveWindow.clearTimeout(this.positionSaveTimer);
    }
    this.positionSaveTimer = null;
    this.positionSaveWindow = null;
  }

  private async flushViewPositions(): Promise<void> {
    this.cancelPositionSaveTimer();
    if (!this.viewPositionsDirty) {
      await this.persistTail;
      return;
    }

    this.viewPositionsDirty = false;
    this.app.workspace.requestSaveLayout();
    try {
      await this.persistData();
    } catch {
      this.viewPositionsDirty = true;
    }
  }

  private async openFavoritesSidebar(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_FAVORITES)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (rightLeaf) {
        leaf = rightLeaf;
        await leaf.setViewState({ type: VIEW_TYPE_FAVORITES });
      }
    }
    if (leaf) {
      void workspace.revealLeaf(leaf);
    }
  }
}
