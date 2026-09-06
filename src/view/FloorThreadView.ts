import { FileView, WorkspaceLeaf, TFile, Component, Menu, Notice, setIcon, ViewStateResult } from "obsidian";
import { ParsedThreadDocument, ParsedRecord } from "../format/types";
import { parseThreadDocument } from "../format/parser";
import { FileIdentityRegistry } from "../services/FileIdentityRegistry";
import { ThreadMutationService } from "../services/ThreadMutationService";
import { t } from "../util/locale";
import { FloorNotesSettings, DEFAULT_SETTINGS, THREAD_VIEW_STYLES, ThreadViewStyle } from "../settings/types";
import { applyThemeClasses } from "../theme";
import { enableGlassGridLayout } from "./glassGrid";
import { attachImageResizeControls } from "./imageResizeControl";
import {
  FloorViewPosition,
  MAX_VIEW_POSITIONS,
  parseFloorViewPosition,
  ViewPositionPersistence,
  VIEW_POSITION_VERSION
} from "../services/ViewPositionStore";
import {
  renderHeader,
  renderRecord,
  renderEmptyState
} from "./components/renderHelpers";
import {
  CreateRecordModal,
  EditRecordModal,
  DeleteConfirmModal,
  type EditorSelectionRange
} from "../modals/ThreadModals";

export const VIEW_TYPE_THREAD = "floor-notes-thread";
const VIEW_POSITION_SCROLL_KEYS = new Set([
  "ArrowDown",
  "ArrowUp",
  "PageDown",
  "PageUp",
  "Home",
  "End",
  " "
]);

type PositionSource = "pane" | "recent" | "rerender";

interface PositionCandidate {
  readonly source: PositionSource;
  readonly position: FloorViewPosition;
}

interface ResolvedPositionRestore {
  readonly source: PositionSource;
  readonly position: FloorViewPosition;
  readonly targetRecordId?: string;
}

interface PendingStatePosition {
  readonly path: string;
  readonly position: FloorViewPosition;
}

interface PendingLoadPositionRestore {
  readonly path: string;
  readonly candidates: readonly PositionCandidate[];
}

export class FloorThreadView extends FileView {
  private generation = 0;
  private currentRenderScope: Component | null = null;
  private pendingRenderScope: Component | null = null;
  private isDeleted = false;
  private announcerEl: HTMLDivElement | null = null;
  private currentPage = 1;
  private lastFilePath = "";
  private renderedFilePath = "";
  private fallbackInProgress = false;
  private pendingFocusRecordId: string | undefined;
  private readonly visibleRepliesByFloor = new Map<string, number>();
  private readonly panePositions: Map<string, FloorViewPosition>;
  private pendingStatePosition: PendingStatePosition | null = null;
  private pendingLoadPositionRestore: PendingLoadPositionRestore | null = null;
  private positionSuppressedPath: string | null = null;
  private userPositionTrackingArmed = false;
  private recentPositionCapturePending = false;
  private lastBrowsingAt = 0;
  private positionInteractionEpoch = 0;
  private positionRestoreToken = 0;
  private suppressPositionScrollEvents = false;
  private renderedRecordOrder: readonly string[] = [];
  private readonly renderedFloorByRecord = new Map<string, string>();
  private static readonly REPLIES_PER_BATCH = 50;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly registry: FileIdentityRegistry,
    private readonly mutationService: ThreadMutationService,
    private readonly settings: FloorNotesSettings = DEFAULT_SETTINGS,
    private readonly positionPersistence?: ViewPositionPersistence,
    panePositions?: Map<string, FloorViewPosition>
  ) {
    super(leaf);
    this.panePositions = panePositions ?? new Map<string, FloorViewPosition>();
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
    if (this.file) {
      this.rememberCurrentPosition(this.file.path, this.recentPositionCapturePending);
    }
    await this.positionPersistence?.flush();
    this.unloadAllRenderScopes();
  }

  override getState(): Record<string, unknown> {
    const state = super.getState();
    if (!this.file || !this.isPositionRestoreEnabled()) {
      return state;
    }

    const path = this.file.path;
    const canCaptureRenderedPosition = this.positionSuppressedPath !== path
      && this.renderedFilePath === path;
    const captured = canCaptureRenderedPosition
      ? this.captureCurrentPosition()
      : this.panePositions.get(path);
    if (!captured) {
      return state;
    }
    this.setPanePosition(path, captured);
    return {
      ...state,
      floorNotesPosition: captured
    };
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

  private restoreTriggerFocus(trigger: HTMLElement | null): void {
    if (trigger?.isConnected) {
      trigger.focus();
    }
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

  override async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const source = state && typeof state === "object" ? state as Record<string, unknown> : {};
    this.pendingFocusRecordId = typeof source.recordId === "string" ? source.recordId : undefined;
    const statePath = typeof source.file === "string" ? source.file : null;
    const restoredPosition = this.isPositionRestoreEnabled()
      ? parseFloorViewPosition(source.floorNotesPosition)
      : null;
    this.pendingStatePosition = statePath && restoredPosition
      ? { path: statePath, position: restoredPosition }
      : null;
    const {
      recordId: _recordId,
      floorNotesPosition: _floorNotesPosition,
      ...fileState
    } = source;
    await super.setState(fileState, result);
  }

  override async onLoadFile(file: TFile): Promise<void> {
    this.fallbackInProgress = false;
    this.isDeleted = false;
    if (this.lastFilePath !== file.path) {
      this.currentPage = 1;
      this.lastFilePath = file.path;
      this.visibleRepliesByFloor.clear();
      this.userPositionTrackingArmed = false;
      this.recentPositionCapturePending = false;
      this.lastBrowsingAt = 0;
      this.positionInteractionEpoch++;
      this.positionRestoreToken++;
      this.suppressPositionScrollEvents = false;
      if (this.positionSuppressedPath !== file.path) {
        this.positionSuppressedPath = null;
      }
    }
    await super.onLoadFile(file);
    const focusRecordId = this.pendingFocusRecordId;
    this.pendingFocusRecordId = undefined;
    const positionCandidates: PositionCandidate[] = [];
    if (!focusRecordId && this.isPositionRestoreEnabled()) {
      const statePosition = this.pendingStatePosition?.path === file.path
        ? this.pendingStatePosition.position
        : undefined;
      const panePosition = statePosition ?? this.panePositions.get(file.path);
      if (panePosition) {
        this.setPanePosition(file.path, panePosition);
        positionCandidates.push({ source: "pane", position: panePosition });
      }
      const recentPosition = this.positionPersistence?.getRecent(file.path);
      if (recentPosition && recentPosition !== panePosition) {
        positionCandidates.push({ source: "recent", position: recentPosition });
      }
    }
    this.pendingStatePosition = null;
    this.pendingLoadPositionRestore = positionCandidates.length > 0
      ? { path: file.path, candidates: positionCandidates }
      : null;
    await this.requestGeneration(
      focusRecordId,
      false,
      focusRecordId !== undefined
    );
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    this.rememberCurrentPosition(file.path, this.recentPositionCapturePending);
    if (this.pendingLoadPositionRestore?.path === file.path) {
      this.pendingLoadPositionRestore = null;
    }
    await this.positionPersistence?.flush();
    this.unloadAllRenderScopes();
    await super.onUnloadFile(file);
  }

  public handleFileRename(file: TFile, oldPath: string): void {
    this.panePositions.delete(oldPath);
    this.panePositions.delete(file.path);
    if (
      this.pendingLoadPositionRestore?.path === oldPath ||
      this.pendingLoadPositionRestore?.path === file.path
    ) {
      this.pendingLoadPositionRestore = null;
    }
    if (this.file !== file) {
      return;
    }

    this.lastFilePath = file.path;
    this.renderedFilePath = file.path;
    this.positionSuppressedPath = file.path;
    this.userPositionTrackingArmed = false;
    this.recentPositionCapturePending = false;
    this.lastBrowsingAt = 0;
    this.positionInteractionEpoch++;
    this.positionRestoreToken++;
    this.suppressPositionScrollEvents = false;
  }

  public clearPositionForPath(path: string): void {
    this.panePositions.delete(path);
    if (this.pendingLoadPositionRestore?.path === path) {
      this.pendingLoadPositionRestore = null;
    }
    if (this.file?.path === path) {
      this.positionSuppressedPath = path;
      this.userPositionTrackingArmed = false;
      this.recentPositionCapturePending = false;
      this.lastBrowsingAt = 0;
    }
  }

  public handlePositionSettingChanged(enabled: boolean): void {
    this.panePositions.clear();
    this.pendingStatePosition = null;
    this.pendingLoadPositionRestore = null;
    this.userPositionTrackingArmed = false;
    this.recentPositionCapturePending = false;
    this.lastBrowsingAt = 0;
    this.positionRestoreToken++;
    this.suppressPositionScrollEvents = false;

    if (!enabled || !this.file) {
      this.positionSuppressedPath = null;
      return;
    }

    this.positionSuppressedPath = null;
    const position = this.captureCurrentPosition();
    if (position) {
      this.setPanePosition(this.file.path, position);
    }
  }

  public async requestGeneration(
    focusFloorId?: string,
    scrollToTop = false,
    markAsBrowsing = focusFloorId !== undefined
  ): Promise<void> {
    if (this.isDeleted || !this.file) {
      return;
    }

    this.generation++;
    const thisGen = this.generation;
    this.contentEl.setAttribute("aria-busy", "true");
    const file = this.file;
    const sourcePath = file.path;
    const identityToken = this.registry.getOrCreateIdentity(file);
    const identityEpoch = this.registry.getIdentityInfo(identityToken)?.epoch;
    this.unloadPendingRenderScope();

    if (focusFloorId || scrollToTop) {
      this.pendingLoadPositionRestore = null;
    }

    if (markAsBrowsing) {
      this.markActualBrowsing(sourcePath);
    }

    const existingRecordsEl = this.contentEl.querySelector(".floor-notes-records-container") as HTMLElement;
    const existingHeaderEl = this.contentEl.querySelector(".floor-notes-header") as HTMLElement;
    const isAlreadyRendered = existingRecordsEl && existingHeaderEl;

    if (scrollToTop && existingRecordsEl) {
      existingRecordsEl.empty();
      const loadingEl = existingRecordsEl.createDiv({
        cls: "floor-notes-page-loading"
      });
      loadingEl.setAttribute("role", "status");
      loadingEl.setAttribute("aria-live", "polite");
      loadingEl.setText(t("loadingPage"));
    }

    if (!isAlreadyRendered) {
      this.applyTheme();
      this.contentEl.empty();
      this.announcerEl = this.contentEl.createDiv({ cls: "floor-notes-announcer" });
      this.announcerEl.setAttribute("aria-live", "polite");
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

      const pendingLoadCandidates = this.pendingLoadPositionRestore?.path === sourcePath
        ? this.pendingLoadPositionRestore.candidates
        : [];
      const positionCandidates = pendingLoadCandidates.length > 0
        ? pendingLoadCandidates
        : this.getRerenderPositionCandidates(focusFloorId, scrollToTop);
      const resolvedPosition = focusFloorId
        ? undefined
        : this.resolvePositionRestore(parseRes.doc, sourcePath, positionCandidates);

      this.applyViewStyle(parseRes.doc.effectiveViewStyle);
      const scope = new Component();
      scope.load();
      this.pendingRenderScope = scope;

      if (isAlreadyRendered) {
        await this.updateThreadDOM(parseRes.doc, scope, thisGen, file, sourcePath, identityToken, identityEpoch, existingHeaderEl, existingRecordsEl, focusFloorId, scrollToTop, resolvedPosition);
      } else {
        this.unloadRenderScope();
        this.contentEl.empty();
        this.announcerEl = this.contentEl.createDiv({ cls: "floor-notes-announcer" });
        this.announcerEl.setAttribute("aria-live", "polite");
        await this.renderThread(parseRes.doc, scope, thisGen, file, sourcePath, identityToken, identityEpoch, focusFloorId, scrollToTop, resolvedPosition);
      }

      if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
        if (this.pendingRenderScope === scope) {
          this.pendingRenderScope = null;
        }
        scope.unload();
        return;
      }

      this.contentEl.removeAttribute("aria-busy");
      const previousScope = this.currentRenderScope;
      this.currentRenderScope = scope;
      if (this.pendingRenderScope === scope) {
        this.pendingRenderScope = null;
      }
      if (previousScope && previousScope !== scope) {
        this.unloadScope(previousScope);
      }
      this.renderedFilePath = sourcePath;
      if (this.pendingLoadPositionRestore?.path === sourcePath) {
        this.pendingLoadPositionRestore = null;
      }
      if (markAsBrowsing) {
        this.rememberCurrentPosition(
          sourcePath,
          true,
          focusFloorId === undefined,
          scrollToTop
        );
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

  private renderDeletedState(): void {
    this.contentEl.removeAttribute("aria-busy");
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
    this.contentEl.removeAttribute("aria-busy");
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
    this.contentEl.removeAttribute("aria-busy");
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
    scrollToTop = false,
    positionRestore?: ResolvedPositionRestore
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
            return this.mutationService.addFloor(file, body, new Date());
          },
          () => {
            this.restoreTriggerFocus(triggerButton);
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
    await this.renderRecordsList(
      recordsEl,
      doc,
      scope,
      thisGen,
      file,
      sourcePath,
      identityToken,
      identityEpoch,
      focusFloorId,
      scrollToTop,
      positionRestore
    );
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
    scrollToTop = false,
    positionRestore?: ResolvedPositionRestore
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
            return this.mutationService.addFloor(file, body, new Date());
          },
          () => {
            this.restoreTriggerFocus(triggerButton);
          },
          this.settings,
          doc.effectiveViewStyle
        );
        modal.open();
      },
      (trigger) => this.openViewStyleMenu(trigger, doc.effectiveViewStyle, thisGen, file, identityToken, identityEpoch)
    );

    const nextRecordsEl = scrollToTop
      ? this.contentEl.createDiv({ cls: "floor-notes-records-container" })
      : recordsEl;
    if (nextRecordsEl !== recordsEl) {
      nextRecordsEl.remove();
    }

    await this.renderRecordsList(
      nextRecordsEl,
      doc,
      scope,
      thisGen,
      file,
      sourcePath,
      identityToken,
      identityEpoch,
      focusFloorId,
      scrollToTop,
      positionRestore
    );
    if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
      nextRecordsEl.remove();
      return;
    }
    if (nextRecordsEl !== recordsEl) {
      recordsEl.replaceWith(nextRecordsEl);
    }
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
    scrollToTop = false,
    positionRestore?: ResolvedPositionRestore
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
          return this.mutationService.addReply(file, recId, body, new Date());
        },
        () => {
          this.restoreTriggerFocus(triggerButton);
        },
        this.settings,
        doc.effectiveViewStyle
      );
      modal.open();
    };

    const handleEdit = (
      record: ParsedRecord,
      oldBodyText: string,
      initialSelection?: EditorSelectionRange
    ) => {
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
          return isFloor
            ? this.mutationService.editFloor(file, record.id, oldBodyText, newBody)
            : this.mutationService.editReply(file, record.id, oldBodyText, newBody);
        },
        () => {
          this.restoreTriggerFocus(triggerButton);
        },
        this.settings,
        doc.effectiveViewStyle,
        initialSelection
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
            return this.mutationService.deleteFloor(file, record.id, expectedRevisions);
          },
          () => {
            this.restoreTriggerFocus(triggerButton);
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
            return this.mutationService.deleteReply(file, record.id, revision);
          },
          () => {
            this.restoreTriggerFocus(triggerButton);
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

    const attachImageResizeControl = (
      recordEl: HTMLElement,
      record: ParsedRecord,
      bodyText: string
    ): void => {
      attachImageResizeControls({
        recordEl,
        recordId: record.id,
        bodyText,
        scope,
        resizeLabel: t("resizeImage"),
        openImageLabel: t("zoomIn"),
        closeImageLabel: t("closeImageViewer"),
        openSourceLabel: t("editBlock"),
        isActive: () => this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch),
        openSource: (selection) => handleEdit(record, bodyText, selection),
        commit: (intent) => this.mutationService.setImageSize(file, intent),
        onRejected: async (kind) => {
          new Notice(t(kind === "conflict" ? "imageResizeConflict" : "operationFailed"));
          await this.requestGeneration();
        }
      });
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
    const nextRenderedRecordOrder: string[] = [];
    const nextRenderedFloorByRecord = new Map<string, string>();
    for (const group of groups) {
      nextRenderedRecordOrder.push(group.floor.id);
      nextRenderedFloorByRecord.set(group.floor.id, group.floor.id);
      for (const reply of group.replies) {
        nextRenderedRecordOrder.push(reply.id);
        nextRenderedFloorByRecord.set(reply.id, group.floor.id);
      }
    }

    // Pagination
    const itemsPerPage = 30;
    const totalGroups = groups.length;
    const totalPages = Math.max(1, Math.ceil(totalGroups / itemsPerPage));

    // Explicit navigation and silent restoration both select the page containing their target.
    const pageTargetRecordId = focusFloorId ?? positionRestore?.targetRecordId;
    if (pageTargetRecordId) {
      const targetGroupIndex = groups.findIndex(g =>
        g.floor.id === pageTargetRecordId || g.replies.some(r => r.id === pageTargetRecordId)
      );
      if (targetGroupIndex !== -1) {
        this.currentPage = Math.floor(targetGroupIndex / itemsPerPage) + 1;
        const targetGroup = groups[targetGroupIndex]!;
        const replyIndex = targetGroup.replies.findIndex((reply) => reply.id === pageTargetRecordId);
        if (replyIndex !== -1) {
          const currentlyVisible = this.visibleRepliesByFloor.get(targetGroup.floor.id)
            ?? FloorThreadView.REPLIES_PER_BATCH;
          this.visibleRepliesByFloor.set(
            targetGroup.floor.id,
            Math.min(
              targetGroup.replies.length,
              Math.max(currentlyVisible, replyIndex + 1)
            )
          );
        }
      }
    } else if (positionRestore) {
      this.currentPage = positionRestore.position.page;
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
      const floorRecordEl = await renderRecord(
        floorGroupEl,
        group.floor,
        floorBody,
        this.app,
        sourcePath,
        scope,
        () => handleReply(group.floor.id),
        () => handleEdit(group.floor, floorBody),
        () => handleDelete(group.floor),
        () => handleToggleFavorite(group.floor),
        undefined,
        this.settings.showImageDescriptions
      );
      attachImageResizeControl(floorRecordEl, group.floor, floorBody);

      // Render nested replies
      if (group.replies.length > 0) {
        const repliesEl = floorGroupEl.createDiv({ cls: "floor-notes-replies" });
        const visibleReplies = this.visibleRepliesByFloor.get(group.floor.id) ?? FloorThreadView.REPLIES_PER_BATCH;
        for (const reply of group.replies.slice(0, visibleReplies)) {
          if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) return;

          const replyBody = doc.rawText.substring(reply.bodySpan.start, reply.bodySpan.end);
          const replyAuthorLabel = reply.authorLabel
            && (!group.floor.authorLabel
              || reply.authorLabel.comparisonValue !== group.floor.authorLabel.comparisonValue)
            ? reply.authorLabel.displayValue
            : undefined;
          const replyRecordEl = await renderRecord(
            repliesEl,
            reply,
            replyBody,
            this.app,
            sourcePath,
            scope,
            () => {}, // Replies do not have reply buttons
            () => handleEdit(reply, replyBody),
            () => handleDelete(reply),
            undefined,
            replyAuthorLabel,
            this.settings.showImageDescriptions
          );
          attachImageResizeControl(replyRecordEl, reply, replyBody);
        }
        if (visibleReplies < group.replies.length) {
          const loadMore = repliesEl.createEl("button", {
            cls: "floor-notes-load-more-replies",
            text: t("loadMoreReplies")
          });
          loadMore.type = "button";
          loadMore.addEventListener("click", () => {
            this.visibleRepliesByFloor.set(
              group.floor.id,
              Math.min(group.replies.length, visibleReplies + FloorThreadView.REPLIES_PER_BATCH)
            );
            void this.requestGeneration(undefined, false, true);
          });
        }
      }
    }

    // Render pagination controls if totalPages > 1
    if (totalPages > 1) {
      const paginationEl = stagingEl.createDiv({ cls: "floor-notes-pagination" });
      
      const prevBtn = paginationEl.createEl("button", {
        cls: "floor-notes-pagination-btn",
        attr: { "aria-label": t("previousPage") }
      });
      setIcon(prevBtn, "chevron-left");
      if (this.currentPage === 1) {
        prevBtn.setAttribute("disabled", "true");
        prevBtn.classList.add("is-disabled");
      } else {
        prevBtn.addEventListener("click", () => {
          this.currentPage--;
          void this.requestGeneration(undefined, true, true);
        });
      }

      const selectEl = paginationEl.createEl("select", {
        cls: "floor-notes-page-select"
      });
      for (let i = 1; i <= totalPages; i++) {
        const option = selectEl.createEl("option", {
          value: String(i),
          text: t("pageOption")
            .replace("{current}", String(i))
            .replace("{total}", String(totalPages))
        });
        if (i === this.currentPage) {
          option.selected = true;
        }
      }
      selectEl.addEventListener("change", () => {
        this.currentPage = parseInt(selectEl.value, 10);
        void this.requestGeneration(undefined, true, true);
      });

      const nextBtn = paginationEl.createEl("button", {
        cls: "floor-notes-pagination-btn",
        attr: { "aria-label": t("nextPage") }
      });
      setIcon(nextBtn, "chevron-right");
      if (this.currentPage === totalPages) {
        nextBtn.setAttribute("disabled", "true");
        nextBtn.classList.add("is-disabled");
      } else {
        nextBtn.addEventListener("click", () => {
          this.currentPage++;
          void this.requestGeneration(undefined, true, true);
        });
      }
    }

    if (!this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)) {
      return;
    }

    let appliedPositionRestore = positionRestore;
    if (positionRestore?.source === "rerender") {
      const latestPosition = this.captureCurrentPosition();
      if (latestPosition) {
        const recordIds = new Set(doc.records.map((record) => record.id));
        const latestTarget = this.findAvailableRestoreRecordId(recordIds, latestPosition);
        appliedPositionRestore = {
          source: "rerender",
          position: latestPosition,
          ...(latestTarget === undefined ? {} : { targetRecordId: latestTarget })
        };
      }
    }

    recordsEl.replaceChildren(...Array.from(stagingEl.childNodes));
    this.renderedRecordOrder = nextRenderedRecordOrder;
    this.renderedFloorByRecord.clear();
    for (const [recordId, floorId] of nextRenderedFloorByRecord) {
      this.renderedFloorByRecord.set(recordId, floorId);
    }
    if (doc.effectiveViewStyle === "glass") {
      enableGlassGridLayout(recordListEl, scope);
    }
    this.attachPositionTracking(recordsEl, scope, sourcePath);

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
        if (targetWindow) {
          const navigationInteractionEpoch = this.positionInteractionEpoch;
          const settleNavigationTimer = targetWindow.setTimeout(() => {
            if (
              this.isGenerationCurrent(thisGen, file, identityToken, identityEpoch)
              && navigationInteractionEpoch === this.positionInteractionEpoch
              && this.recentPositionCapturePending
            ) {
              this.rememberCurrentPosition(sourcePath, true);
            }
          }, 600);
          scope.register(() => {
            targetWindow.clearTimeout(settleNavigationTimer);
            if (
              navigationInteractionEpoch === this.positionInteractionEpoch
              && this.recentPositionCapturePending
            ) {
              this.rememberCurrentPosition(sourcePath, true);
            }
          });
        }

        target.focus();

        if (!prefersReduced) {
          target.classList.add("floor-notes-highlight");
          targetWindow?.setTimeout(() => {
            target.classList.remove("floor-notes-highlight");
          }, 2000);
        }

        if (this.announcerEl) {
          this.announcerEl.setText(
            t("navigatedToFloor")
              .replace("{title}", doc.title || file.basename)
              .replace("{recordId}", focusFloorId)
          );
        }
      }
    } else if (appliedPositionRestore) {
      this.restoreViewPosition(
        recordsEl,
        appliedPositionRestore,
        scope,
        thisGen,
        file,
        identityToken,
        identityEpoch
      );
    } else if (scrollToTop) {
      recordsEl.scrollTop = 0;
    }
  }

  private isPositionRestoreEnabled(): boolean {
    return this.settings.restoreLastViewPosition
      && (this.positionPersistence?.isEnabled() ?? true);
  }

  private getRerenderPositionCandidates(
    focusRecordId: string | undefined,
    scrollToTop: boolean
  ): readonly PositionCandidate[] {
    if (
      focusRecordId ||
      scrollToTop ||
      !this.isPositionRestoreEnabled() ||
      this.renderedFilePath !== this.file?.path
    ) {
      return [];
    }
    const position = this.captureCurrentPosition();
    return position ? [{ source: "rerender", position }] : [];
  }

  private resolvePositionRestore(
    doc: ParsedThreadDocument,
    path: string,
    candidates: readonly PositionCandidate[]
  ): ResolvedPositionRestore | undefined {
    if (!this.isPositionRestoreEnabled() || candidates.length === 0) {
      return undefined;
    }

    const recordIds = new Set(doc.records.map((record) => record.id));
    for (const candidate of candidates) {
      const semanticIds = this.getPositionSemanticIds(candidate.position);
      const targetRecordId = this.findAvailableRestoreRecordId(
        recordIds,
        candidate.position
      );
      if (targetRecordId) {
        return { source: candidate.source, position: candidate.position, targetRecordId };
      }
      if (semanticIds.length === 0 || candidate.source === "rerender") {
        return { source: candidate.source, position: candidate.position };
      }

      if (candidate.source === "pane") {
        if (this.panePositions.get(path) === candidate.position) {
          this.panePositions.delete(path);
        }
      } else if (candidate.source === "recent") {
        this.positionPersistence?.removeRecent(path, candidate.position);
      }
    }

    this.currentPage = 1;
    return undefined;
  }

  private getPositionSemanticIds(position: FloorViewPosition): readonly string[] {
    return [
      position.anchorRecordId,
      position.floorRecordId,
      position.previousRecordId,
      position.nextRecordId
    ].filter((recordId): recordId is string => recordId !== undefined);
  }

  private findAvailableRestoreRecordId(
    recordIds: ReadonlySet<string>,
    position: FloorViewPosition
  ): string | undefined {
    return this.getPositionSemanticIds(position).find((recordId) => recordIds.has(recordId));
  }

  private captureCurrentPosition(
    updatedAt = Date.now(),
    preferredAnchor?: HTMLElement
  ): FloorViewPosition | undefined {
    const recordsEl = this.contentEl.querySelector<HTMLElement>(".floor-notes-records-container");
    if (!recordsEl) {
      return undefined;
    }

    const containerRect = recordsEl.getBoundingClientRect();
    const measuredHeight = Math.max(
      recordsEl.clientHeight,
      Number.isFinite(containerRect.height) ? containerRect.height : 0,
      Number.isFinite(containerRect.bottom - containerRect.top)
        ? containerRect.bottom - containerRect.top
        : 0
    );
    if (recordsEl.isConnected && measuredHeight <= 0) {
      const currentPath = this.file?.path;
      return currentPath ? this.panePositions.get(currentPath) : undefined;
    }
    let anchor = preferredAnchor && recordsEl.contains(preferredAnchor)
      ? preferredAnchor
      : undefined;
    if (!anchor) {
      const recordElements = Array.from(
        recordsEl.querySelectorAll<HTMLElement>(".floor-notes-record[data-record-id]")
      );
      let crossingTop: HTMLElement | undefined;
      let crossingTopValue = Number.NEGATIVE_INFINITY;
      let firstBelowTop: HTMLElement | undefined;
      let firstBelowTopValue = Number.POSITIVE_INFINITY;
      for (const element of recordElements) {
        const rect = element.getBoundingClientRect();
        if (
          rect.top <= containerRect.top &&
          rect.bottom > containerRect.top &&
          rect.top > crossingTopValue
        ) {
          crossingTop = element;
          crossingTopValue = rect.top;
        } else if (
          rect.top > containerRect.top &&
          rect.top < containerRect.bottom &&
          rect.top < firstBelowTopValue
        ) {
          firstBelowTop = element;
          firstBelowTopValue = rect.top;
        }
      }
      anchor = crossingTop ?? firstBelowTop ?? recordElements[0];
    }
    const scrollTop = Number.isFinite(recordsEl.scrollTop)
      ? Math.max(0, recordsEl.scrollTop)
      : 0;

    if (!anchor) {
      return {
        version: VIEW_POSITION_VERSION,
        page: this.currentPage,
        scrollTop,
        anchorOffset: 0,
        updatedAt
      };
    }

    const anchorRecordId = anchor.dataset.recordId;
    if (!anchorRecordId) {
      return undefined;
    }
    const anchorIndex = this.renderedRecordOrder.indexOf(anchorRecordId);
    const previousRecordId = anchorIndex > 0
      ? this.renderedRecordOrder[anchorIndex - 1]
      : undefined;
    const nextRecordId = anchorIndex >= 0
      ? this.renderedRecordOrder[anchorIndex + 1]
      : undefined;
    const floorRecordId = this.renderedFloorByRecord.get(anchorRecordId)
      ?? (anchor.matches(".floor-notes-floor")
        ? anchorRecordId
        : anchor.closest<HTMLElement>(".floor-notes-floor-group")
          ?.querySelector<HTMLElement>(".floor-notes-floor[data-record-id]")
          ?.dataset.recordId);
    const anchorOffset = anchor.getBoundingClientRect().top - containerRect.top;

    return {
      version: VIEW_POSITION_VERSION,
      page: this.currentPage,
      scrollTop,
      anchorOffset: Number.isFinite(anchorOffset) ? anchorOffset : 0,
      updatedAt,
      anchorRecordId,
      ...(floorRecordId === undefined ? {} : { floorRecordId }),
      ...(previousRecordId === undefined ? {} : { previousRecordId }),
      ...(nextRecordId === undefined ? {} : { nextRecordId })
    };
  }

  private setPanePosition(path: string, position: FloorViewPosition): void {
    this.panePositions.delete(path);
    this.panePositions.set(path, position);
    while (this.panePositions.size > MAX_VIEW_POSITIONS) {
      const oldestPath = this.panePositions.keys().next().value;
      if (oldestPath === undefined) {
        break;
      }
      this.panePositions.delete(oldestPath);
    }
  }

  private rememberCurrentPosition(
    path: string,
    updateRecent: boolean,
    settleRecent = true,
    preferPageStart = false
  ): void {
    if (!this.isPositionRestoreEnabled() || this.file?.path !== path) {
      return;
    }
    if (this.positionSuppressedPath === path && !updateRecent) {
      return;
    }

    const preferredAnchor = preferPageStart
      ? this.contentEl.querySelector<HTMLElement>(
        ".floor-notes-records-container .floor-notes-record[data-record-id]"
      ) ?? undefined
      : undefined;
    const position = this.captureCurrentPosition(
      updateRecent && this.lastBrowsingAt > 0 ? this.lastBrowsingAt : Date.now(),
      preferredAnchor
    );
    if (!position) {
      return;
    }
    if (updateRecent) {
      this.positionSuppressedPath = null;
    }
    if (this.positionSuppressedPath === path) {
      return;
    }

    this.setPanePosition(path, position);
    if (updateRecent) {
      const ownerWindow = this.contentEl.ownerDocument.defaultView;
      if (ownerWindow) {
        this.positionPersistence?.setRecent(path, position, ownerWindow);
      }
      if (settleRecent) {
        this.recentPositionCapturePending = false;
      }
    }
  }

  private markActualBrowsing(path: string): void {
    if (!this.isPositionRestoreEnabled() || this.file?.path !== path) {
      return;
    }
    this.positionSuppressedPath = null;
    this.userPositionTrackingArmed = true;
    this.recentPositionCapturePending = true;
    this.lastBrowsingAt = Date.now();
    this.positionInteractionEpoch++;
    this.positionRestoreToken++;
    this.suppressPositionScrollEvents = false;
  }

  private attachPositionTracking(
    recordsEl: HTMLElement,
    scope: Component,
    path: string
  ): void {
    const ownerWindow = recordsEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      return;
    }

    let captureFrame: number | null = null;
    let settleTimer: number | null = null;
    let unsettledPath = path;
    const getTrackedPath = (): string => {
      const currentPath = this.file?.path;
      return currentPath && this.renderedFilePath === currentPath
        ? currentPath
        : path;
    };
    const armTracking = (): void => {
      this.markActualBrowsing(getTrackedPath());
    };
    const armScrollbarTracking = (event: PointerEvent): void => {
      if (event.target === recordsEl) {
        armTracking();
      }
    };
    const armKeyboardTracking = (event: KeyboardEvent): void => {
      if (!VIEW_POSITION_SCROLL_KEYS.has(event.key)) {
        return;
      }
      const target = event.targetNode;
      const targetsThisView = target?.instanceOf(ownerWindow.Node)
        ? this.contentEl.contains(target)
        : false;
      const activeView = this.app.workspace.getActiveViewOfType?.(FloorThreadView);
      if (!targetsThisView && activeView !== this) {
        return;
      }
      if (
        target?.instanceOf(ownerWindow.HTMLElement)
        && target.closest("input, textarea, select, button, [contenteditable='true']")
      ) {
        return;
      }
      armTracking();
    };
    const captureAfterScroll = (): void => {
      const trackedPath = getTrackedPath();
      if (
        !this.userPositionTrackingArmed ||
        !this.recentPositionCapturePending ||
        this.suppressPositionScrollEvents ||
        !this.isPositionRestoreEnabled() ||
        this.file?.path !== trackedPath
      ) {
        return;
      }
      this.lastBrowsingAt = Date.now();
      unsettledPath = trackedPath;
      if (captureFrame !== null) {
        return;
      }
      captureFrame = ownerWindow.requestAnimationFrame(() => {
        captureFrame = null;
        this.rememberCurrentPosition(trackedPath, true, false);
      });
      if (settleTimer !== null) {
        ownerWindow.clearTimeout(settleTimer);
      }
      settleTimer = ownerWindow.setTimeout(() => {
        settleTimer = null;
        if (this.file?.path === unsettledPath) {
          this.recentPositionCapturePending = false;
        }
      }, 250);
    };

    scope.registerDomEvent(recordsEl, "wheel", armTracking, { passive: true });
    scope.registerDomEvent(recordsEl, "touchmove", armTracking, { passive: true });
    scope.registerDomEvent(recordsEl, "pointerdown", armScrollbarTracking);
    scope.registerDomEvent(recordsEl.ownerDocument, "keydown", armKeyboardTracking);
    scope.registerDomEvent(recordsEl, "scroll", captureAfterScroll, { passive: true });
    scope.register(() => {
      if (captureFrame !== null) {
        ownerWindow.cancelAnimationFrame(captureFrame);
      }
      if (settleTimer !== null) {
        ownerWindow.clearTimeout(settleTimer);
      }
    });
  }

  private restoreViewPosition(
    recordsEl: HTMLElement,
    restore: ResolvedPositionRestore,
    scope: Component,
    generation: number,
    file: TFile,
    identityToken: string,
    identityEpoch: number | undefined
  ): void {
    const ownerWindow = recordsEl.ownerDocument.defaultView;
    if (!ownerWindow) {
      return;
    }

    const token = ++this.positionRestoreToken;
    const interactionEpoch = this.positionInteractionEpoch;
    this.suppressPositionScrollEvents = true;
    if (this.positionSuppressedPath !== file.path) {
      this.setPanePosition(file.path, restore.position);
    }
    this.setContainerScrollTop(recordsEl, restore.position.scrollTop);

    const target = restore.targetRecordId
      ? this.findRecordElement(recordsEl, restore.targetRecordId)
      : null;
    const applyAnchor = (): void => {
      if (
        token !== this.positionRestoreToken ||
        interactionEpoch !== this.positionInteractionEpoch ||
        !this.isGenerationCurrent(generation, file, identityToken, identityEpoch)
      ) {
        return;
      }
      if (target?.isConnected) {
        const currentOffset = target.getBoundingClientRect().top
          - recordsEl.getBoundingClientRect().top;
        const desiredScrollTop = recordsEl.scrollTop
          + currentOffset
          - restore.position.anchorOffset;
        this.setContainerScrollTop(recordsEl, desiredScrollTop);
      }
      this.rememberCurrentPosition(file.path, false);
    };
    let animationFrame: number | null = null;
    let finishTimer: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const finishRestoration = (): void => {
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (token === this.positionRestoreToken) {
        this.suppressPositionScrollEvents = false;
      }
    };
    const scheduleFinishWhenVisible = (): void => {
      const containerRect = recordsEl.getBoundingClientRect();
      const measuredHeight = Math.max(
        recordsEl.clientHeight,
        Number.isFinite(containerRect.height) ? containerRect.height : 0,
        Number.isFinite(containerRect.bottom - containerRect.top)
          ? containerRect.bottom - containerRect.top
          : 0
      );
      if (measuredHeight <= 0) {
        return;
      }
      if (finishTimer !== null) {
        ownerWindow.clearTimeout(finishTimer);
      }
      finishTimer = ownerWindow.setTimeout(() => {
        finishTimer = null;
        finishRestoration();
      }, 1000);
    };
    const applyAndScheduleFinish = (): void => {
      applyAnchor();
      scheduleFinishWhenVisible();
    };
    applyAndScheduleFinish();

    let remainingFrames = 2;
    const applyOnFrame = (): void => {
      applyAndScheduleFinish();
      remainingFrames--;
      if (remainingFrames > 0) {
        animationFrame = ownerWindow.requestAnimationFrame(applyOnFrame);
      } else {
        animationFrame = null;
      }
    };
    animationFrame = ownerWindow.requestAnimationFrame(applyOnFrame);

    for (const image of Array.from(recordsEl.querySelectorAll<HTMLImageElement>("img"))) {
      if (!image.complete) {
        scope.registerDomEvent(image, "load", applyAndScheduleFinish, { once: true });
      }
    }

    const recordList = recordsEl.querySelector<HTMLElement>(".floor-notes-record-list");
    if (recordList && typeof ownerWindow.ResizeObserver === "function") {
      resizeObserver = new ownerWindow.ResizeObserver(applyAndScheduleFinish);
      resizeObserver.observe(recordsEl);
      resizeObserver.observe(recordList);
    }

    scope.register(() => {
      if (animationFrame !== null) {
        ownerWindow.cancelAnimationFrame(animationFrame);
      }
      if (finishTimer !== null) {
        ownerWindow.clearTimeout(finishTimer);
      }
      resizeObserver?.disconnect();
      if (token === this.positionRestoreToken) {
        this.suppressPositionScrollEvents = false;
      }
    });
  }

  private findRecordElement(container: HTMLElement, recordId: string): HTMLElement | null {
    return Array.from(
      container.querySelectorAll<HTMLElement>(".floor-notes-record[data-record-id]")
    ).find((element) => element.dataset.recordId === recordId) ?? null;
  }

  private setContainerScrollTop(container: HTMLElement, value: number): void {
    const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    const maximum = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = maximum > 0 ? Math.min(safeValue, maximum) : safeValue;
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
