import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { FavoritesIndex, FavoriteEntry } from "../services/FavoritesIndex";
import { t } from "../util/locale";
import { FloorThreadView, VIEW_TYPE_THREAD } from "./FloorThreadView";
import { parseThreadDocument } from "../format/parser";
import { FloorNotesSettings, DEFAULT_SETTINGS, THREAD_VIEW_STYLES } from "../settings/types";
import { applyThemeClasses } from "../theme";

export const VIEW_TYPE_FAVORITES = "floor-notes-favorites";

export class FavoritesSidebarView extends ItemView {
  private unsubscribe: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly index: FavoritesIndex,
    private readonly settings: FloorNotesSettings = DEFAULT_SETTINGS
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_FAVORITES;
  }

  override getDisplayText(): string {
    return t("favoritesSidebarTitle") || "Favorite floors";
  }

  override getIcon(): string {
    return "star";
  }

  override async onOpen(): Promise<void> {
    this.unsubscribe = this.index.subscribe(() => {
      this.render();
    });
    const cssChangeEvent = this.app?.workspace?.on("css-change", () => {
      this.applyTheme();
    });
    if (cssChangeEvent) {
      this.registerEvent(cssChangeEvent);
    }
    this.render();
  }

  override async onClose(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("floor-notes-favorites-view");

    // Apply theme classes so --text-accent follows plugin theme
    this.applyTheme();

    const favorites = this.index.getAllFavorites();

    // Render Option 1 Header
    const headerEl = contentEl.createDiv({ cls: "floor-notes-fav-header" });
    headerEl.createEl("h3", { text: t("favoritesSidebarTitle") || "Favorite floors", cls: "floor-notes-fav-title" });
    headerEl.createSpan({ text: String(favorites.length), cls: "floor-notes-fav-count-badge" });

    if (favorites.length === 0) {
      contentEl.createDiv({
        cls: "floor-notes-favorites-empty",
        text: t("noFavorites") || "No favorites yet",
        attr: { role: "status" }
      });
      return;
    }

    // List
    const listEl = contentEl.createDiv({ cls: "floor-notes-favorites-list" });

    for (const entry of favorites) {
      const btn = listEl.createEl("button", {
        cls: `floor-notes-favorite-item is-${entry.type}`
      });

      // Top Row (File tag and stale warning)
      const topRow = btn.createDiv({ cls: "floor-notes-fav-item-top" });
      topRow.createSpan({ cls: "floor-notes-fav-item-file-tag", text: entry.title });

      if (entry.isStale) {
        topRow.createDiv({
          cls: "floor-notes-fav-item-stale",
          text: `⚠️ ${t("stale")}`
        });
      }

      // Middle Snippet Row
      btn.createDiv({ cls: "floor-notes-fav-item-snippet", text: entry.snippet });

      btn.addEventListener("click", () => {
        void this.handleNavigation(entry);
      });
    }
  }

  private async handleNavigation(entry: FavoriteEntry): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) {
      new Notice(t("fileNotFound"));
      this.index.forceReindex();
      return;
    }

    // The index is eventually consistent, so always validate a clicked record.
    try {
      const content = await this.app.vault.read(file);
      const parseRes = parseThreadDocument(content, file.name);
      if (parseRes.ok) {
        const rec = parseRes.doc.records.find((record) => record.id === entry.recordId);
        if (rec?.favorite) {
          await this.navigateToFileAndRecord(file, entry.recordId);
          return;
        }
      }
    } catch {
      // Treat unreadable files as an invalid favorite and refresh the index.
    }
    new Notice(t("favInvalid"));
    this.index.forceReindex();
  }

  private async navigateToFileAndRecord(file: TFile, recordId: string): Promise<void> {
    const { workspace } = this.app;
    
    // Find or create leaf
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_THREAD).find((l) => {
      const v = l.view;
      if (v instanceof FloorThreadView) {
        return v.file && v.file.path === file.path;
      }
      return false;
    });

    if (!leaf) {
      leaf = workspace.getLeaf(false);
      await leaf.setViewState({
        type: VIEW_TYPE_THREAD,
        state: { file: file.path, recordId }
      });
      return;
    }

    workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (view instanceof FloorThreadView) {
      await view.requestGeneration(recordId);
    }
  }

  public refresh(): void {
    this.render();
  }

  public applyTheme(): void {
    this.contentEl.classList.remove(...THREAD_VIEW_STYLES.map((style) => `floor-notes-view-style-${style}`));
    this.contentEl.classList.add(`floor-notes-view-style-${this.settings.defaultViewStyle}`);
    applyThemeClasses(this.contentEl, this.settings.theme, this.settings.mode);
  }
}
