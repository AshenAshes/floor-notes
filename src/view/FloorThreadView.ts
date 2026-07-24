import { FileView, WorkspaceLeaf, TFile, Component, Menu, Notice, setIcon } from "obsidian";
import { ParsedThreadDocument, ParsedRecord } from "../format/types";
import { parseThreadDocument } from "../format/parser";
import { FileIdentityRegistry } from "../services/FileIdentityRegistry";
import { ThreadMutationService } from "../services/ThreadMutationService";
import { t } from "../util/locale";
import { FloorNotesSettings, DEFAULT_SETTINGS, THREAD_VIEW_STYLES, ThreadViewStyle } from "../settings/types";
import { applyThemeClasses } from "../theme";
import { enableGlassGridLayout } from "./glassGrid";
import {
  renderHeader,
  renderRecord,
  renderEmptyState
} from "./components/renderHelpers";
import {
  CreateRecordModal,
  EditRecordModal,
  DeleteConfirmModal
} from "../modals/ThreadModals";

export const VIEW_TYPE_THREAD = "floor-notes-thread";

export class FloorThreadView extends FileView {
  private generation = 0;
  private currentRenderScope: Component | null = null;
  private pendingRenderScope: Component | null = null;
  private isDeleted = false;
  private announcerEl: HTMLDivElement | null = null;
  private currentPage = 1;
  private lastFilePath = "";
  private fallbackInProgress = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly registry: FileIdentityRegistry,
    private readonly mutationService: ThreadMutationService,
    private readonly settings: FloorNotesSettings = DEFAULT_SETTINGS
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return VIEW_TYPE_THREAD;
  }

  override getDisplayText(): string {
    if (this.file) {
      return this.file.basename;
    }
    return "Floor thread";
  }

  override getIcon(): string {
    return "sheets-in-box";
  }

  override async onOpen(): Promise<void> {
    this.applyTheme();
    this.registerEvent(
      this.app.workspace.on("css-change", () => {
        this.applyTheme();
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && this.file) {
          const thisToken = this.registry.getOrCreateIdentity(this.file);
          const fileToken = this.registry.getOrCreateIdentity(file);
          if (thisToken === fileToken) {
            this.isDeleted = true;
            this.unloadAllRenderScopes();
            this.renderDeletedState();
          }
        }
      })
    );
  }

  override async onClose(): Promise<void> {
    this.unloadAllRenderScopes();
  }

  private unloadRenderScope(): void {
    this.currentRenderScope = this.unloadScope(this.currentRenderScope);
  }

  private unloadPendingRenderScope(): void {
    this.pendingRenderScope = this.unloadScope(this.pendingRenderScope);
  }

  private unloadAllRenderScopes(): void {
    this.unloadPendingRenderScope();
    this.unloadRenderScope();
  }

  private unloadScope(scope: Component | null): null {
    if (!scope) {
      return null;
    }

    try {
      scope.unload();
    } catch (e) {
      console.error("Failed to unload render scope:", e);
    }
    return null;
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.fallbackInProgress = false;
    this.isDeleted = false;
    if (this.lastFilePath !== file.path) {
      this.currentPage = 1;
      this.lastFilePath = file.path;
    }
    await super.onLoadFile(file);
    await this.requestGeneration();
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.unloadAllRenderScopes();
    await super.onUnloadFile(file);
  }

  public async requestGeneration(focusFloorId?: string, scrollToTop = false): Promise<void> {
    if (this.isDeleted || !this.file) {
      return;
    }

    this.generation++;
    const thisGen = this.generation;
    const file = this.file;
    const sourcePath = file.path;
    const identityToken = this.registry.getOrCreateIdentity(file);
    const identityEpoch = this.registry.getIdentityInfo(identityToken)?.epoch;
    this.unloadPendingRenderScope();

    const existingRecordsEl = this.contentEl.querySelector(".floor-notes-records-container") as HTMLElement;
    const existingHeaderEl = this.contentEl.querySelector(".floor-notes-header") as HTMLElement;
    const isAlreadyRendered = existingRecordsEl && existingHeaderEl;

    if (!isAlreadyRendered) {
      this.applyTheme();
      this.contentEl.empty();
      this.announcerEl = this.contentEl.createDiv({ cls: "floor-notes-announcer" });
      this.announcerEl.setAttribute("aria-live", "polite");
      this.renderLoading();
    }

    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch (err) {
      if (this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
        this.renderGenericError(String(err));
      }
      return;
    }

    if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;

    try {
      const parseRes = parseThreadDocument(content, file.name, {
        defaultSortOrder: this.settings.defaultSortOrder,
        defaultViewStyle: this.settings.defaultViewStyle
      });
      if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;

      if (!parseRes.ok) {
        await this.fallbackToMarkdown(thisGen, file, identityToken, identityEpoch);
        return;
      }

      this.applyViewStyle(parseRes.doc.effectiveViewStyle);
      const scope = new Component();
      scope.load();
      this.pendingRenderScope = scope;

      if (isAlreadyRendered) {
        await this.updateThreadDOM(parseRes.doc, scope, thisGen, file, sourcePath, identityToken, identityEpoch, existingHeaderEl, existingRecordsEl, focusFloorId, scrollToTop);
      } else {
        this.unloadRenderScope();
        this.contentEl.empty();
        this.announcerEl = this.contentEl.createDiv({ cls: "floor-notes-announcer" });
        this.announcerEl.setAttribute("aria-live", "polite");
        await this.renderThread(parseRes.doc, scope, thisGen, file, sourcePath, identityToken, identityEpoch, focusFloorId, scrollToTop);
      }

      if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
        if (this.pendingRenderScope === scope) {
          this.pendingRenderScope = null;
        }
        scope.unload();
        return;
      }

      const previousScope = this.currentRenderScope;
      this.currentRenderScope = scope;
      if (this.pendingRenderScope === scope) {
        this.pendingRenderScope = null;
      }
      if (previousScope && previousScope !== scope) {
        this.unloadScope(previousScope);
      }
    } catch {
      await this.fallbackToMarkdown(thisGen, file, identityToken, identityEpoch);
    }
  }

  private isGenerationCurrent(
    generation: number,
    file: TFile,
    identityToken: string,
    identityEpoch: number | undefined
  ): boolean {
    const info = this.registry.getIdentityInfo(identityToken);
    return this.generation === generation &&
      !this.isDeleted &&
      this.file === file &&
      info?.state === "active" &&
      info.epoch === identityEpoch;
  }

  private renderLoading(): void {
    this.contentEl.createDiv({ cls: "floor-notes-loading", text: t("loadingThread") });
  }

  private renderDeletedState(): void {
    this.contentEl.empty();
    const delEl = this.contentEl.createDiv({ cls: "floor-notes-deleted-container" });
    delEl.createEl("p", { text: t("fileDeletedError") });
  }

  private async fallbackToMarkdown(
    generation: number,
    file: TFile,
    identityToken: string,
    identityEpoch: number | undefined
  ): Promise<void> {
    if (this.fallbackInProgress || !this.isGenerationCurrent(generation, file, identityToken, identityEpoch)) {
      return;
    }

    this.fallbackInProgress = true;
    this.generation++;
    this.unloadAllRenderScopes();
    this.contentEl.empty();
    this.announcerEl = null;
    new Notice(t("floorViewFallbackNotice"));

    try {
      await this.leaf.setViewState({
        type: "markdown",
        state: { file: file.path, bypassThreadView: true }
      });
    } catch (err) {
      this.renderGenericError(String(err));
    }
  }

  private renderGenericError(message: string): void {
    this.unloadAllRenderScopes();
    this.contentEl.empty();
    const errEl = this.contentEl.createDiv({ cls: "floor-notes-error-container" });
    errEl.createEl("h3", { text: t("errorLoadingThread") });
    errEl.createEl("p", { text: message });
  }

  private async renderThread(
    doc: ParsedThreadDocument,
    scope: Component,
    thisGen: number,
    file: TFile,
    sourcePath: string,
    identityToken: string,
    identityEpoch: number | undefined,
    focusFloorId?: string,
    scrollToTop = false
  ): Promise<void> {
    // Check if it has the required floor-notes frontmatter
    if (!doc.records && doc.title === null) {
      renderEmptyState(this.contentEl);
      return;
    }

    // Render Header
    renderHeader(
      this.contentEl,
      doc,
      () => {
        // Open as Markdown
        void this.leaf.setViewState({ type: "markdown", state: { file: sourcePath, bypassThreadView: true } });
      },
      () => {
        // Toggle sort order
        if (this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
          const currentSort = doc.explicitSort || this.settings.defaultSortOrder;
          const newSort = currentSort === "desc" ? "asc" : "desc";
          void this.mutationService.setSortOrder(file, newSort);
        }
      },
      () => {
        // Add Floor
        if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;
        const triggerButton = this.contentEl.ownerDocument.activeElement as HTMLElement;
        const modal = new CreateRecordModal(
          this.app,
          t("addFloor"),
          sourcePath,
          "new-floor",
          async (body) => {
            if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
              return { type: "missing", message: t("fileNotFound") };
            }
            return this.mutationService.addFloor(file, body, new Date());
          },
          () => {
            if (triggerButton) triggerButton.focus();
          },
          this.settings,
          doc.effectiveViewStyle
        );
        modal.open();
      },
      (trigger) => this.openViewStyleMenu(trigger, doc.effectiveViewStyle, thisGen, file, identityToken, identityEpoch)
    );

    // Records Container
    const recordsEl = this.contentEl.createDiv({ cls: "floor-notes-records-container" });
    await this.renderRecordsList(recordsEl, doc, scope, thisGen, file, sourcePath, identityToken, identityEpoch, focusFloorId, scrollToTop);
  }

  private async updateThreadDOM(
    doc: ParsedThreadDocument,
    scope: Component,
    thisGen: number,
    file: TFile,
    sourcePath: string,
    identityToken: string,
    identityEpoch: number | undefined,
    headerEl: HTMLElement,
    recordsEl: HTMLElement,
    focusFloorId?: string,
    scrollToTop = false
  ): Promise<void> {
    renderHeader(
      headerEl,
      doc,
      () => {
        void this.leaf.setViewState({ type: "markdown", state: { file: sourcePath, bypassThreadView: true } });
      },
      () => {
        if (this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
          const currentSort = doc.explicitSort || this.settings.defaultSortOrder;
          const newSort = currentSort === "desc" ? "asc" : "desc";
          void this.mutationService.setSortOrder(file, newSort);
        }
      },
      () => {
        if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;
        const triggerButton = this.contentEl.ownerDocument.activeElement as HTMLElement;
        const modal = new CreateRecordModal(
          this.app,
          t("addFloor"),
          sourcePath,
          "new-floor",
          async (body) => {
            if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
              return { type: "missing", message: t("fileNotFound") };
            }
            return this.mutationService.addFloor(file, body, new Date());
          },
          () => {
            if (triggerButton) triggerButton.focus();
          },
          this.settings,
          doc.effectiveViewStyle
        );
        modal.open();
      },
      (trigger) => this.openViewStyleMenu(trigger, doc.effectiveViewStyle, thisGen, file, identityToken, identityEpoch)
    );

    await this.renderRecordsList(recordsEl, doc, scope, thisGen, file, sourcePath, identityToken, identityEpoch, focusFloorId, scrollToTop);
  }

  private async renderRecordsList(
    recordsEl: HTMLElement,
    doc: ParsedThreadDocument,
    scope: Component,
    thisGen: number,
    file: TFile,
    sourcePath: string,
    identityToken: string,
    identityEpoch: number | undefined,
    focusFloorId?: string,
    scrollToTop = false
  ): Promise<void> {
    const stagingEl = recordsEl.createDiv();
    stagingEl.remove();
    const recordListEl = stagingEl.createDiv({ cls: "floor-notes-record-list" });

    // Extract mutation handlers to keep render loop clean
    const handleReply = (recId: string) => {
      if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;
      const triggerButton = this.contentEl.ownerDocument.activeElement as HTMLElement;
      const modal = new CreateRecordModal(
        this.app,
        t("addReply"),
        sourcePath,
        recId,
        async (body) => {
          if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
            return { type: "missing", message: t("fileNotFound") };
          }
          return this.mutationService.addReply(file, recId, body, new Date());
        },
        () => {
          if (triggerButton) triggerButton.focus();
        },
        this.settings,
        doc.effectiveViewStyle
      );
      modal.open();
    };

    const handleEdit = (record: ParsedRecord, oldBodyText: string) => {
      if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;
      const triggerButton = this.contentEl.ownerDocument.activeElement as HTMLElement;
      const isFloor = record.type === "floor";
      const modal = new EditRecordModal(
        this.app,
        isFloor ? t("editFloor") : t("editReply"),
        sourcePath,
        record.id,
        oldBodyText,
        async (newBody) => {
          if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
            return { type: "missing", message: t("fileNotFound") };
          }
          return isFloor
            ? this.mutationService.editFloor(file, record.id, oldBodyText, newBody)
            : this.mutationService.editReply(file, record.id, oldBodyText, newBody);
        },
        () => {
          if (triggerButton) triggerButton.focus();
        },
        this.settings,
        doc.effectiveViewStyle
      );
      modal.open();
    };

    const handleDelete = (record: ParsedRecord) => {
      if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;
      const triggerButton = this.contentEl.ownerDocument.activeElement as HTMLElement;
      const isFloor = record.type === "floor";

      if (isFloor) {
        // Collect revisions for the entire floor group
        const expectedRevisions: { id: string; revision: string }[] = [];
        const floorIndex = doc.records.indexOf(record);
        if (floorIndex !== -1) {
          expectedRevisions.push({
            id: record.id,
            revision: doc.rawText.substring(record.fullSpan.start, record.fullSpan.end)
          });
          for (let i = floorIndex + 1; i < doc.records.length; i++) {
            const nextRec = doc.records[i]!;
            if (nextRec.type === "floor") {
              break;
            }
            expectedRevisions.push({
              id: nextRec.id,
              revision: doc.rawText.substring(nextRec.fullSpan.start, nextRec.fullSpan.end)
            });
          }
        }

        const modal = new DeleteConfirmModal(
          this.app,
          t("deleteFloor"),
          t("deleteFloorConfirm"),
          async () => {
            if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
              return { type: "missing", message: t("fileNotFound") };
            }
            return this.mutationService.deleteFloor(file, record.id, expectedRevisions);
          },
          () => {
            if (triggerButton) triggerButton.focus();
          },
          this.settings,
          doc.effectiveViewStyle
        );
        modal.open();
      } else {
        const revision = doc.rawText.substring(record.fullSpan.start, record.fullSpan.end);
        const modal = new DeleteConfirmModal(
          this.app,
          t("deleteReply"),
          t("deleteReplyConfirm"),
          async () => {
            if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
              return { type: "missing", message: t("fileNotFound") };
            }
            return this.mutationService.deleteReply(file, record.id, revision);
          },
          () => {
            if (triggerButton) triggerButton.focus();
          },
          this.settings,
          doc.effectiveViewStyle
        );
        modal.open();
      }
    };

    const handleToggleFavorite = (record: ParsedRecord) => {
      if (this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
        void this.mutationService.setFavorite(file, record.id, !record.favorite);
      }
    };

    // Group records into Floors and their nested replies
    interface FloorGroup {
      floor: ParsedRecord;
      replies: ParsedRecord[];
    }

    const groups: FloorGroup[] = [];
    let currentGroup: FloorGroup | null = null;
    for (const record of doc.records) {
      if (record.type === "floor") {
        currentGroup = { floor: record, replies: [] };
        groups.push(currentGroup);
      } else {
        if (currentGroup) {
          currentGroup.replies.push(record);
        }
      }
    }

    // Sort FloorGroups based on effectiveSort
    const sortOrder = doc.effectiveSort;
    if (sortOrder === "desc") {
      groups.sort((a, b) => (b.floor.floorNumber || 0) - (a.floor.floorNumber || 0));
    } else {
      groups.sort((a, b) => (a.floor.floorNumber || 0) - (b.floor.floorNumber || 0));
    }

    // Pagination
    const itemsPerPage = 30;
    const totalGroups = groups.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / itemsPerPage));

    // Focus floor routing: automatically switch to the page containing focusFloorId
    if (focusFloorId) {
      const targetGroupIndex = groups.findIndex(g => 
        g.floor.id === focusFloorId || g.replies.some(r => r.id === focusFloorId)
      );
      if (targetGroupIndex !== -1) {
        this.currentPage = Math.floor(targetGroupIndex / itemsPerPage) + 1;
      }
    }

    // Safeguard bounds
    if (this.currentPage > totalPages) {
      this.currentPage = totalPages;
    }
    if (this.currentPage < 1) {
      this.currentPage = 1;
    }

    const startIndex = (this.currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalGroups);
    const paginatedGroups = groups.slice(startIndex, endIndex);

    // Render sorted floor groups
    for (const group of paginatedGroups) {
      if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;

      const floorGroupEl = recordListEl.createDiv({
        cls: `floor-notes-floor-group${group.replies.length > 0 ? " has-replies" : ""}`,
        attr: { "data-reply-count": String(group.replies.length) }
      });

      // Render floor
      const floorBody = doc.rawText.substring(group.floor.bodySpan.start, group.floor.bodySpan.end);
      await renderRecord(
        floorGroupEl,
        group.floor,
        floorBody,
        this.app,
        sourcePath,
        scope,
        () => handleReply(group.floor.id),
        () => handleEdit(group.floor, floorBody),
        () => handleDelete(group.floor),
        () => handleToggleFavorite(group.floor)
      );

      // Render nested replies
      if (group.replies.length > 0) {
        const repliesEl = floorGroupEl.createDiv({ cls: "floor-notes-replies" });
        for (const reply of group.replies) {
          if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;

          const replyBody = doc.rawText.substring(reply.bodySpan.start, reply.bodySpan.end);
          await renderRecord(
            repliesEl,
            reply,
            replyBody,
            this.app,
            sourcePath,
            scope,
            () => {}, // Replies do not have reply buttons
            () => handleEdit(reply, replyBody),
            () => handleDelete(reply)
          );
        }
      }
    }

    // Render pagination controls if totalPages > 1
    if (totalPages > 1) {
      const paginationEl = stagingEl.createDiv({ cls: "floor-notes-pagination" });
      
      const prevBtn = paginationEl.createEl("button", {
        cls: "floor-notes-pagination-btn",
        attr: { "aria-label": "Previous page" }
      });
      setIcon(prevBtn, "chevron-left");
      if (this.currentPage === 1) {
        prevBtn.setAttribute("disabled", "true");
        prevBtn.classList.add("is-disabled");
      } else {
        prevBtn.addEventListener("click", () => {
          this.currentPage--;
          void this.requestGeneration(undefined, true);
        });
      }

      const selectEl = paginationEl.createEl("select", {
        cls: "floor-notes-page-select"
      });
      for (let i = 1; i <= totalPages; i++) {
        const option = selectEl.createEl("option", {
          value: String(i),
          text: `第 ${i} / ${totalPages} 页`
        });
        if (i === this.currentPage) {
          option.selected = true;
        }
      }
      selectEl.addEventListener("change", () => {
        this.currentPage = parseInt(selectEl.value, 10);
        void this.requestGeneration(undefined, true);
      });

      const nextBtn = paginationEl.createEl("button", {
        cls: "floor-notes-pagination-btn",
        attr: { "aria-label": "Next page" }
      });
      setIcon(nextBtn, "chevron-right");
      if (this.currentPage === totalPages) {
        nextBtn.setAttribute("disabled", "true");
        nextBtn.classList.add("is-disabled");
      } else {
        nextBtn.addEventListener("click", () => {
          this.currentPage++;
          void this.requestGeneration(undefined, true);
        });
      }
    }

    if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
      return;
    }

    recordsEl.replaceChildren(...Array.from(stagingEl.childNodes));
    if (doc.effectiveViewStyle === "glass") {
      enableGlassGridLayout(recordListEl, scope);
    }

    // Scroll to focusFloorId if supplied
    if (focusFloorId) {
      const target = recordsEl.querySelector(`[data-record-id="${focusFloorId}"]`) as HTMLElement;
      if (target) {
        target.setAttribute("tabindex", "-1");

        const targetWindow = target.ownerDocument.defaultView;
        const prefersReduced = targetWindow?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? false;
        target.scrollIntoView({
          behavior: prefersReduced ? "auto" : "smooth",
          block: "start"
        });

        target.focus();

        if (!prefersReduced) {
          target.classList.add("floor-notes-highlight");
          targetWindow?.setTimeout(() => {
            target.classList.remove("floor-notes-highlight");
          }, 2000);
        }

        if (this.announcerEl) {
          this.announcerEl.setText(`Navigated to ${doc.title || file.basename}, floor ${focusFloorId}`);
        }
      }
    } else if (scrollToTop) {
      recordsEl.scrollTop = 0;
    }
  }

  private openViewStyleMenu(
    trigger: HTMLButtonElement,
    currentStyle: ThreadViewStyle,
    generation: number,
    file: TFile,
    identityToken: string,
    identityEpoch: number | undefined
  ): void {
    if (!this.isGenerationCurrent(generation, file, identityToken, identityEpoch)) {
      return;
    }

    const menu = new Menu();
    for (const style of THREAD_VIEW_STYLES) {
      menu.addItem((item) => {
        item
          .setTitle(this.getViewStyleLabel(style))
          .setChecked(style === currentStyle)
          .onClick(() => {
            if (this.isGenerationCurrent(generation, file, identityToken, identityEpoch)) {
              void this.mutationService.setViewStyle(file, style);
            }
          });
      });
    }

    const rect = trigger.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom }, trigger.ownerDocument);
  }

  private getViewStyleLabel(style: ThreadViewStyle): string {
    switch (style) {
      case "bubble":
        return t("bubbleStyle");
      case "glass":
        return t("glassStyle");
      case "paper":
        return t("paperStyle");
      case "timeline":
        return t("timelineStyle");
    }
  }

  private applyViewStyle(style: ThreadViewStyle): void {
    const styleClasses = THREAD_VIEW_STYLES.map((item) => `floor-notes-view-style-${item}`);
    const nextClass = `floor-notes-view-style-${style}`;
    const activeClasses = styleClasses.filter((className) => this.contentEl.classList.contains(className));

    const currentClass = activeClasses[0];
    if (activeClasses.length === 1 && currentClass) {
      if (currentClass === nextClass) return;
      this.contentEl.classList.replace(currentClass, nextClass);
      return;
    }

    this.contentEl.classList.remove(...activeClasses);
    this.contentEl.classList.add(nextClass);
  }

  public applyTheme(): void {
    if (!this.contentEl) return;

    this.contentEl.classList.add("floor-notes-thread-view");
    applyThemeClasses(this.contentEl, this.settings.theme, this.settings.mode);
  }
}
