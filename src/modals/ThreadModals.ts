import { App, Modal, Setting, Component, Notice, setIcon } from "obsidian";
import { OperationResult } from "../format/operations";
import { t } from "../util/locale";
import { FloorNotesSettings, DEFAULT_SETTINGS, ThreadViewStyle } from "../settings/types";
import { applyThemeClasses } from "../theme";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { renderMarkdownBody } from "../view/components/renderHelpers";
import { savePastedImageAttachment } from "../services/AttachmentPersistence";

type EditorMode = "write" | "preview";

function escapeKaomojiMarkdown(kaomoji: string): string {
  return kaomoji.replace(/[\\`*_]/g, (character) => `\\${character}`);
}

let editorModalSequence = 0;

export abstract class ThreadEditorModal extends Modal {
  protected bodyText = "";

  protected getDraftKey(): string | null {
    return null;
  }

  protected restoreDraftOnOpen(): boolean {
    return false;
  }

  protected showDraftActions(): boolean {
    return false;
  }
  private renderComponent = new Component();
  private isSubmitting = false;
  private activeMode: EditorMode = "write";
  private previewGeneration = 0;
  private editorSession = 0;
  private previewScope: Component | null = null;
  private writePaneEl: HTMLElement | null = null;
  private previewPaneEl: HTMLElement | null = null;
  private formattingControlsEl: HTMLElement | null = null;
  private editorTabsEl: HTMLElement | null = null;
  private writeTabEl: HTMLButtonElement | null = null;
  private previewTabEl: HTMLButtonElement | null = null;
  protected editorView: EditorView | null = null;

  constructor(
    app: App,
    protected readonly titleText: string,
    protected readonly filePath: string,
    protected readonly onSubmit: (body: string) => Promise<OperationResult>,
    protected readonly onCloseCallback?: () => void,
    protected readonly settings: FloorNotesSettings = DEFAULT_SETTINGS,
    protected readonly viewStyle?: ThreadViewStyle
  ) {
    super(app);
  }

  private activateMode(mode: EditorMode): void {
    if (
      !this.writePaneEl ||
      !this.previewPaneEl ||
      !this.formattingControlsEl ||
      !this.editorTabsEl ||
      !this.writeTabEl ||
      !this.previewTabEl
    ) {
      return;
    }

    this.activeMode = mode;
    this.editorTabsEl.dataset.activeMode = mode;
    const isWriteMode = mode === "write";
    this.writePaneEl.hidden = !isWriteMode;
    this.previewPaneEl.hidden = isWriteMode;
    this.formattingControlsEl.hidden = !isWriteMode;

    this.writeTabEl.setAttribute("aria-selected", String(isWriteMode));
    this.writeTabEl.tabIndex = isWriteMode ? 0 : -1;
    this.previewTabEl.setAttribute("aria-selected", String(!isWriteMode));
    this.previewTabEl.tabIndex = isWriteMode ? -1 : 0;

    if (isWriteMode) {
      this.disposePreview();
      return;
    }

    void this.renderPreview();
  }

  private disposePreview(): void {
    this.previewGeneration += 1;
    this.previewScope?.unload();
    this.previewScope = null;
    this.previewPaneEl?.empty();
  }

  private isCurrentPreview(generation: number, scope: Component): boolean {
    return (
      this.activeMode === "preview" &&
      this.previewGeneration === generation &&
      this.previewScope === scope &&
      this.previewPaneEl !== null
    );
  }

  private async renderPreview(): Promise<void> {
    const previewPane = this.previewPaneEl;
    if (!previewPane || this.activeMode !== "preview") {
      return;
    }

    this.disposePreview();
    const generation = ++this.previewGeneration;
    const scope = new Component();
    scope.load();
    this.previewScope = scope;

    const sourceText = this.bodyText;
    if (sourceText.trim() === "") {
      previewPane.createDiv({ cls: "floor-notes-preview-empty", text: t("previewEmpty") });
      return;
    }

    const loadingEl = previewPane.createDiv({ cls: "floor-notes-preview-loading", text: t("previewLoading") });
    const renderEl = previewPane.createDiv({ cls: "floor-notes-modal-preview markdown-rendered" });
    renderEl.hidden = true;

    try {
      await renderMarkdownBody(
        renderEl,
        sourceText,
        this.app,
        this.filePath,
        scope,
        () => this.isCurrentPreview(generation, scope)
      );
      if (!this.isCurrentPreview(generation, scope)) {
        return;
      }

      loadingEl.remove();
      renderEl.hidden = false;
    } catch {
      if (!this.isCurrentPreview(generation, scope)) {
        return;
      }

      previewPane.empty();
      previewPane.createDiv({ cls: "floor-notes-preview-error", text: t("previewRenderFailed") });
    }
  }

  override onOpen(): void {
    this.editorSession += 1;
    this.disposePreview();
    this.activeMode = "write";
    this.writePaneEl = null;
    this.previewPaneEl = null;
    this.formattingControlsEl = null;
    this.editorTabsEl = null;
    this.writeTabEl = null;
    this.previewTabEl = null;
    this.renderComponent.load();
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Add custom class to modal wrapper for styling
    modalEl.classList.add("floor-notes-editor-modal");

    // Apply custom theme classes so settings tokens are inherited by the modal.
    applyThemeClasses(modalEl, this.settings.theme, this.settings.mode);
    if (this.viewStyle) {
      modalEl.classList.add(`floor-notes-view-style-${this.viewStyle}`);
    }

    // Title
    const headerEl = contentEl.createDiv({ cls: "floor-notes-modal-header" });
    headerEl.createEl("h2", { text: this.titleText, cls: "floor-notes-modal-title" });

    const draftKey = this.getDraftKey();
    const originalBody = this.bodyText;
    const savedDraft: unknown = draftKey === null ? null : this.app.loadLocalStorage(draftKey);
    const showsDraftActions = this.showDraftActions();
    const initialDraft = typeof savedDraft === "string"
      && (showsDraftActions ? savedDraft !== originalBody : savedDraft.trim() !== "")
      ? savedDraft
      : null;
    let hasSavedDraft = initialDraft !== null;
    let draftText = initialDraft ?? "";
    if (this.restoreDraftOnOpen() && initialDraft !== null) {
      this.bodyText = initialDraft;
    }
    let isSynchronizingEditor = false;

    // Editor container
    const editorContainer = contentEl.createDiv({ cls: "floor-notes-modal-editor-container" });

    // Toolbar
    const toolbar = editorContainer.createDiv({ cls: "floor-notes-modal-toolbar" });
    this.formattingControlsEl = toolbar.createDiv({ cls: "floor-notes-modal-formatting-controls" });

    // Create formatting buttons
    const btnBold = this.formattingControlsEl.createEl("button", { text: "B", cls: "floor-notes-toolbar-btn btn-bold" });
    btnBold.type = "button";
    btnBold.setAttribute("aria-label", t("formatBold"));
    const btnItalic = this.formattingControlsEl.createEl("button", { text: "I", cls: "floor-notes-toolbar-btn btn-italic" });
    btnItalic.type = "button";
    btnItalic.setAttribute("aria-label", t("formatItalic"));
    const btnLink = this.formattingControlsEl.createEl("button", { cls: "floor-notes-toolbar-btn btn-link" });
    btnLink.type = "button";
    btnLink.setAttribute("aria-label", t("insertLink"));
    btnLink.setAttribute("data-tooltip-position", "top");
    setIcon(btnLink, "link");

    // Emoji button
    const btnEmoji = this.formattingControlsEl.createEl("button", { text: "😄", cls: "floor-notes-toolbar-btn btn-emoji" });
    btnEmoji.type = "button";
    btnEmoji.setAttribute("aria-label", t("insertEmojiOrKaomoji"));

    const editorInstance = ++editorModalSequence;
    const writeTabId = `floor-notes-editor-write-tab-${editorInstance}`;
    const previewTabId = `floor-notes-editor-preview-tab-${editorInstance}`;
    const writePaneId = `floor-notes-editor-write-pane-${editorInstance}`;
    const previewPaneId = `floor-notes-editor-preview-pane-${editorInstance}`;

    const tabs = toolbar.createDiv({ cls: "floor-notes-editor-tabs" });
    this.editorTabsEl = tabs;
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("editorModeLabel"));

    this.writeTabEl = tabs.createEl("button", { text: t("write"), cls: "floor-notes-editor-tab" });
    this.writeTabEl.type = "button";
    this.writeTabEl.id = writeTabId;
    this.writeTabEl.setAttribute("role", "tab");
    this.writeTabEl.setAttribute("aria-controls", writePaneId);

    this.previewTabEl = tabs.createEl("button", { text: t("preview"), cls: "floor-notes-editor-tab" });
    this.previewTabEl.type = "button";
    this.previewTabEl.id = previewTabId;
    this.previewTabEl.setAttribute("role", "tab");
    this.previewTabEl.setAttribute("aria-controls", previewPaneId);

    this.writePaneEl = editorContainer.createDiv({ cls: "floor-notes-editor-pane floor-notes-editor-pane-write" });
    this.writePaneEl.id = writePaneId;
    this.writePaneEl.setAttribute("role", "tabpanel");
    this.writePaneEl.setAttribute("aria-labelledby", writeTabId);

    this.previewPaneEl = editorContainer.createDiv({ cls: "floor-notes-editor-pane floor-notes-editor-pane-preview" });
    this.previewPaneEl.id = previewPaneId;
    this.previewPaneEl.setAttribute("role", "tabpanel");
    this.previewPaneEl.setAttribute("aria-labelledby", previewTabId);

    const activateAndFocusTab = (mode: EditorMode) => {
      this.activateMode(mode);
      (mode === "write" ? this.writeTabEl : this.previewTabEl)?.focus();
    };

    this.renderComponent.registerDomEvent(this.writeTabEl, "click", () => activateAndFocusTab("write"));
    this.renderComponent.registerDomEvent(this.previewTabEl, "click", () => activateAndFocusTab("preview"));
    this.renderComponent.registerDomEvent(tabs, "keydown", (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        activateAndFocusTab(this.activeMode === "write" ? "preview" : "write");
      } else if (event.key === "Home") {
        event.preventDefault();
        activateAndFocusTab("write");
      } else if (event.key === "End") {
        event.preventDefault();
        activateAndFocusTab("preview");
      }
    });
    this.activateMode("write");

    // Source editor container
    const editorEl = this.writePaneEl.createDiv({
      cls: "floor-notes-wysiwyg-editor"
    });

    // Forward declarations for editor synchronization and the dynamic action bar.
    let draftStatusEl: HTMLDivElement;
    let updateWordCount: () => void;
    let updateActionBar = (): void => {};
    let textarea!: HTMLTextAreaElement;

    const persistDraft = (value: string): void => {
      if (draftKey === null) {
        return;
      }

      if (showsDraftActions) {
        if (value === originalBody) {
          // A user who restores the exact original body has abandoned the draft.
          this.app.saveLocalStorage(draftKey, null);
          draftText = "";
          hasSavedDraft = false;
          draftStatusEl?.empty();
        } else {
          this.app.saveLocalStorage(draftKey, value);
          draftText = value;
          hasSavedDraft = true;
          draftStatusEl?.setText(t("draftSaved"));
        }
        updateActionBar();
        return;
      }

      const hadSavedDraft = hasSavedDraft;
      if (value.trim() === "") {
        this.app.saveLocalStorage(draftKey, null);
        draftText = "";
        hasSavedDraft = false;
        draftStatusEl?.empty();
      } else {
        this.app.saveLocalStorage(draftKey, value);
        draftText = value;
        hasSavedDraft = true;
        draftStatusEl?.setText(t("draftSaved"));
      }
      if (hadSavedDraft !== hasSavedDraft) {
        updateActionBar();
      }
    };

    const onTextChange = (value: string) => {
      this.bodyText = value;
      textarea.value = value;
      persistDraft(value);
      updateWordCount?.();

      // Programmatic synchronization for integrations that use the hidden textarea.
      if (this.editorView && value !== this.editorView.state.doc.toString()) {
        isSynchronizingEditor = true;
        this.editorView.dispatch({
          changes: { from: 0, to: this.editorView.state.doc.length, insert: value }
        });
        isSynchronizingEditor = false;
      }
    };

    // Textarea backing Setting (for backward-compatibility with tests).
    const textareaSetting = new Setting(this.writePaneEl);
    textareaSetting.settingEl.classList.add("floor-notes-modal-textarea-setting");
    textareaSetting.settingEl.classList.add("is-hidden");
    textareaSetting.addTextArea((text) => {
      textarea = text.inputEl;
      textarea.classList.add("floor-notes-modal-textarea");
      textarea.placeholder = t("contentPlaceholder");
      textarea.rows = 8;
      textarea.value = this.bodyText;
      text.setValue(this.bodyText);
      text.onChange(onTextChange);
    });

    // Initialize CodeMirror 6 Editor View
    const editorTheme = EditorView.theme({
      "&": {
        height: "100%",
        minHeight: "160px",
        backgroundColor: "transparent",
      },
      ".cm-scroller": {
        maxHeight: "350px",
        overflowY: "auto",
        fontFamily: "var(--font-text)",
      },
      ".cm-content": {
        padding: "var(--size-4-4)",
        minHeight: "160px",
        color: "var(--text-normal)",
        fontFamily: "var(--font-text)",
        fontSize: "0.95rem",
        lineHeight: "var(--line-height-normal)",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--text-accent)",
      },
      ".cm-selectionBackground": {
        backgroundColor: "var(--text-selection)",
      },
      "&.cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: "var(--text-selection)",
      },
      "::selection": {
        color: "var(--text-normal)",
      },
      ".cm-activeLine": {
        backgroundColor: "transparent",
      }
    });

    const customHighlightStyle = HighlightStyle.define([
      { tag: tags.strong, fontWeight: "bold" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: tags.heading, fontWeight: "bold", color: "var(--text-accent)" },
      { tag: tags.link, color: "var(--link-color)", textDecoration: "underline" },
      { tag: tags.url, color: "var(--link-color)" },
      { tag: tags.strikethrough, textDecoration: "line-through" },
    ]);

    const startState = EditorState.create({
      doc: this.bodyText,
      extensions: [
        history(),
        drawSelection(),
        markdown(),
        syntaxHighlighting(customHighlightStyle),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        editorTheme,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap
        ]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || isSynchronizingEditor) {
            return;
          }

          const value = update.state.doc.toString();
          textarea.value = value;
          this.bodyText = value;
          persistDraft(value);
          updateWordCount?.();
        })
      ]
    });

    this.editorView = new EditorView({
      state: startState,
      parent: editorEl
    });

    // Helper to insert arbitrary text/emoji/kaomoji at cursor
    const insertTextAtCursor = (text: string) => {
      if (!this.editorView) return;
      const state = this.editorView.state;
      const { from, to } = state.selection.main;
      const transaction = state.update({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length }
      });
      this.editorView.dispatch(transaction);
      this.editorView.focus();
    };

    const insertMarkdownLinkAtCursor = () => {
      if (!this.editorView) return;
      const state = this.editorView.state;
      const { from, to } = state.selection.main;
      const selectedText = state.doc.sliceString(from, to);
      const markdownLink = `[${selectedText}]()`;
      const cursorPosition = selectedText === "" ? from + 1 : from + selectedText.length + 3;
      this.editorView.dispatch({
        changes: { from, to, insert: markdownLink },
        selection: { anchor: cursorPosition }
      });
      this.editorView.focus();
    };

    // Clipboard image paste integration
    const editorContentEl = this.editorView.contentDOM;
    this.renderComponent.registerDomEvent(editorContentEl, "paste", (ev: ClipboardEvent) => {
      if (ev.defaultPrevented) return;
      const clipboardData = ev.clipboardData;
      if (!clipboardData) return;

      const imageItem = Array.from(clipboardData.items).find((item) => item.type.startsWith("image/"));
      const file = imageItem?.getAsFile();
      if (!file) return;

      ev.preventDefault();
      const pasteSession = this.editorSession;
      void (async () => {
        try {
          const buffer = await file.arrayBuffer();
          if (this.editorSession !== pasteSession || !this.editorView) return;
          const extension = file.name.split(".").pop() || "png";
          const createdFile = await savePastedImageAttachment(this.app, this.filePath, extension, buffer);
          if (this.editorSession !== pasteSession || !this.editorView) {
            try {
              await this.app.fileManager.trashFile(createdFile);
            } catch (cleanupError) {
              console.error("Failed to remove attachment from a closed editor:", cleanupError);
            }
            return;
          }
          const markdownLink = this.app.fileManager.generateMarkdownLink(createdFile, this.filePath);
          const mdImage = markdownLink.startsWith("!") ? markdownLink : `!${markdownLink}`;
          insertTextAtCursor(mdImage);
        } catch (err) {
          console.error("Paste image failed:", err);
          new Notice(t("pasteImageFailed"));
        }
      })();
    }, true);

    // Formatting button handlers
    const toggleFormatting = (marker: string) => {
      if (!this.editorView) return;
      const state = this.editorView.state;
      const { from, to } = state.selection.main;
      const len = marker.length;
      
      const selectedText = state.doc.sliceString(from, to);
      
      if (
        selectedText.length >= len * 2 &&
        selectedText.startsWith(marker) &&
        selectedText.endsWith(marker)
      ) {
        const unwrapped = selectedText.slice(len, -len);
        this.editorView.dispatch({
          changes: { from, to, insert: unwrapped },
          selection: { anchor: from, head: from + unwrapped.length }
        });
      } else {
        const beforeText = state.doc.sliceString(Math.max(0, from - len), from);
        const afterText = state.doc.sliceString(to, Math.min(state.doc.length, to + len));
        
        if (beforeText === marker && afterText === marker) {
          const unwrapped = selectedText;
          this.editorView.dispatch({
            changes: { from: from - len, to: to + len, insert: unwrapped },
            selection: { anchor: from - len, head: from - len + unwrapped.length }
          });
        } else {
          const wrapped = marker + selectedText + marker;
          this.editorView.dispatch({
            changes: { from, to, insert: wrapped },
            selection: { anchor: from + len, head: from + len + selectedText.length }
          });
        }
      }
      this.editorView.focus();
    };

    this.renderComponent.registerDomEvent(btnLink, "mousedown", (event: MouseEvent) => {
      event.preventDefault();
    });
    this.renderComponent.registerDomEvent(btnLink, "click", () => insertMarkdownLinkAtCursor());

    this.renderComponent.registerDomEvent(btnBold, "mousedown", (event: MouseEvent) => {
      event.preventDefault();
      toggleFormatting("**");
    });

    this.renderComponent.registerDomEvent(btnItalic, "mousedown", (event: MouseEvent) => {
      event.preventDefault();
      toggleFormatting("*");
    });



    // Statusbar
    const statusbar = editorContainer.createDiv({ cls: "floor-notes-modal-statusbar" });
    draftStatusEl = statusbar.createDiv({ cls: "floor-notes-statusbar-draft" });
    const wordCount = statusbar.createDiv({ cls: "floor-notes-statusbar-words" });

    updateWordCount = () => {
      wordCount.setText(t("characterCount").replace("{count}", String(this.bodyText.length)));
    };
    updateWordCount();

    // The panel is a modal-level overlay so the editor container cannot clip it.
    let emojiPanel: HTMLElement | null = null;
    let emojiScope: Component | null = null;
    const closeEmojiPanel = (restoreFocus = false) => {
      emojiScope?.unload();
      emojiScope = null;
      emojiPanel?.remove();
      emojiPanel = null;
      if (restoreFocus) {
        btnEmoji.focus();
      }
    };
    const openEmojiPanel = () => {
      emojiScope = new Component();
      emojiScope.load();
      this.renderComponent.register(() => emojiScope?.unload());
      emojiPanel = contentEl.createDiv({ cls: "floor-notes-emoji-panel" });
      const contentRect = contentEl.getBoundingClientRect();
      const triggerRect = btnEmoji.getBoundingClientRect();
      const gutter = 8;
      const panelWidth = Math.min(320, Math.max(0, contentRect.width - gutter * 2));
      const left = Math.max(gutter, Math.min(
        triggerRect.left - contentRect.left,
        contentRect.width - panelWidth - gutter
      ));
      emojiPanel.style.setProperty("--floor-notes-emoji-top", `${triggerRect.bottom - contentRect.top + 4}px`);
      emojiPanel.style.setProperty("--floor-notes-emoji-left", `${left}px`);

      // Tab headers
      const tabsContainer = emojiPanel.createDiv({ cls: "floor-notes-emoji-tabs" });
      const tabEmoji = tabsContainer.createEl("button", { text: t("emojiTab"), cls: "floor-notes-emoji-tab is-active" });
      tabEmoji.type = "button";
      const tabKaomoji = tabsContainer.createEl("button", { text: t("kaomojiTab"), cls: "floor-notes-emoji-tab" });
      tabKaomoji.type = "button";

      const emojiContent = emojiPanel.createDiv({ cls: "floor-notes-emoji-content" });
      const kaomojiContent = emojiPanel.createDiv({ cls: "floor-notes-emoji-content is-hidden" });

      const emojis = [
        "😄", "😂", "😍", "👍", "🎉", "🔥", "👀", "❤️", "🤔", "👏",
        "🙌", "✨", "😊", "🥳", "😭", "😎", "😅", "😡", "😱", "💩",
        "💖", "🌟"
      ];
      const kaomojis = [
        "(๑•̀ㅂ•́)و✧", "✧*｡٩(ˊᗜˋ*)و✧*｡", 
        "(づ｡◕‿‿◕｡)づ", "ε=ε=(ノ≧∇≦)ノ",
        "O(∩_∩)O", "ヽ(✿ﾟ▽ﾟ)ノ",
        "ヘ( ^o^)ノ", "(*^▽^*)",
        "(>_<)", "(≧▽≦)",
        "o(╥﹏╥)o", "┗( T﹏T )┛",
        "┌(。Д。)┐", "(•̀_•́)",
        "(╯°Д°)╯︵ ┻━┻", "(^_-)☆",
        "(ಥ_ಥ)", "(⊙_⊙)?",
        "(_　_)。゜zｚＺ", "(oﾟvﾟ)ノ",
        "ヾ(≧▽≦*)o", "(*≧︶≦)o",
        "(o゜▽゜)o☆", "o(≧口≦)o",
        "(〃＞｜＜〃)", "(￣m￣)",
        "（*＾-＾*）", "(✿◡‿◡)",
        "(*￣3￣)╭", "(づ￣ 3￣)づ",
        "（づ￣3￣）づ╭❤～", "❤(ˆ‿ˆԅ)",
        "ヾ(•ω•`)o", "(((((*￣▽￣)ノ",
        "(～￣▽￣)～", "o(*￣▽￣*)o",
        "( •̀ ω •́ )✧", "(ง •_•)ง",
        "o(*^＠^*)o", "φ(゜▽゜*)♪",
        "_(:з」∠)_", "o(￣ヘ￣o＃)"
      ];

      // Render Emoji grid
      const emojiGrid = emojiContent.createDiv({ cls: "floor-notes-emoji-grid" });
      emojis.forEach((emoji) => {
        const item = emojiGrid.createEl("button", { text: emoji, cls: "floor-notes-emoji-item" });
        item.type = "button";
        emojiScope?.registerDomEvent(item, "click", (ev: MouseEvent) => {
          ev.preventDefault();
          insertTextAtCursor(emoji);
          closeEmojiPanel();
        });
      });

      // Render Kaomoji grid
      const kaomojiGrid = kaomojiContent.createDiv({ cls: "floor-notes-emoji-grid is-kaomoji" });
      kaomojis.forEach((kaomoji) => {
        const item = kaomojiGrid.createEl("button", { text: kaomoji, cls: "floor-notes-emoji-item" });
        item.type = "button";
        emojiScope?.registerDomEvent(item, "click", (ev: MouseEvent) => {
          ev.preventDefault();
          insertTextAtCursor(escapeKaomojiMarkdown(kaomoji));
          closeEmojiPanel();
        });
      });

      // Tab switching listeners
      emojiScope?.registerDomEvent(tabEmoji, "click", (ev: MouseEvent) => {
        ev.preventDefault();
        tabEmoji.classList.add("is-active");
        tabKaomoji.classList.remove("is-active");
        emojiContent.classList.remove("is-hidden");
        kaomojiContent.classList.add("is-hidden");
      });

      emojiScope?.registerDomEvent(tabKaomoji, "click", (ev: MouseEvent) => {
        ev.preventDefault();
        tabKaomoji.classList.add("is-active");
        tabEmoji.classList.remove("is-active");
        kaomojiContent.classList.remove("is-hidden");
        emojiContent.classList.add("is-hidden");
      });
    };

    this.renderComponent.registerDomEvent(btnEmoji, "click", (event: MouseEvent) => {
      event.preventDefault();
      if (emojiPanel) {
        closeEmojiPanel(true);
      } else {
        openEmojiPanel();
      }
    });

    const ownerDocument = contentEl.ownerDocument;
    const ownerWindow = ownerDocument.defaultView;
    this.renderComponent.registerDomEvent(ownerDocument, "click", (event: MouseEvent) => {
      const target = event.target;
      if (!emojiPanel || !ownerWindow || !(target instanceof ownerWindow.Node)) {
        return;
      }
      if (!btnEmoji.contains(target) && !emojiPanel.contains(target)) {
        closeEmojiPanel();
      }
    });
    this.renderComponent.registerDomEvent(ownerDocument, "keydown", (event: KeyboardEvent) => {
      if (event.key === "Escape" && emojiPanel) {
        event.preventDefault();
        closeEmojiPanel(true);
      }
    });
    if (ownerWindow) {
      this.renderComponent.registerDomEvent(ownerWindow, "resize", () => closeEmojiPanel());
      this.renderComponent.registerDomEvent(ownerWindow, "scroll", () => closeEmojiPanel());
    }

    // Warning container
    const warnEl = contentEl.createDiv({ cls: "floor-notes-modal-warn", text: "" });

    const actionBar = contentEl.createDiv({ cls: "floor-notes-editor-actions" });
    const sourceActions = actionBar.createDiv({ cls: "floor-notes-editor-actions-source" });
    const submitActions = actionBar.createDiv({ cls: "floor-notes-editor-actions-submit" });

    const replaceEditorText = (value: string): void => {
      this.bodyText = value;
      textarea.value = value;
      if (this.editorView && value !== this.editorView.state.doc.toString()) {
        isSynchronizingEditor = true;
        this.editorView.dispatch({
          changes: { from: 0, to: this.editorView.state.doc.length, insert: value },
          selection: { anchor: value.length }
        });
        isSynchronizingEditor = false;
      }
      updateWordCount();
    };

    let actionBarScope: Component | null = null;
    this.renderComponent.register(() => actionBarScope?.unload());
    const createActionButton = (container: HTMLElement, text: string, className: string): HTMLButtonElement => {
      const button = container.createEl("button", { text, cls: className });
      button.type = "button";
      return button;
    };

    updateActionBar = (): void => {
      actionBarScope?.unload();
      actionBarScope = new Component();
      actionBarScope.load();
      sourceActions.empty();
      submitActions.empty();

      const isDraftView = showsDraftActions && this.bodyText !== originalBody;
      if (showsDraftActions && draftKey !== null && (isDraftView || hasSavedDraft)) {
        const sourceButton = createActionButton(
          sourceActions,
          isDraftView ? t("original") : t("draft"),
          "floor-notes-editor-action floor-notes-editor-action-source"
        );
        actionBarScope?.registerDomEvent(sourceButton, "click", () => {
          replaceEditorText(isDraftView ? originalBody : draftText);
          updateActionBar();
        });
      }

      if (showsDraftActions && draftKey !== null && isDraftView) {
        const discardButton = createActionButton(
          submitActions,
          t("discard"),
          "floor-notes-editor-action floor-notes-editor-action-discard mod-warning"
        );
        actionBarScope?.registerDomEvent(discardButton, "click", () => {
          this.clearDraft();
          draftText = "";
          hasSavedDraft = false;
          draftStatusEl.empty();
          replaceEditorText(originalBody);
          updateActionBar();
        });
      }

      const submitButton = createActionButton(
        submitActions,
        t("submit"),
        "floor-notes-editor-action floor-notes-editor-action-submit mod-cta"
      );
      actionBarScope?.registerDomEvent(submitButton, "click", () => {
        void this.submit(submitButton, warnEl);
      });
    };
    updateActionBar();

    // Auto-focus in the same window that owns this modal.
    contentEl.ownerDocument.defaultView?.setTimeout(() => {
      if (this.editorView) {
        this.editorView.focus();
        // Move selection to end of doc
        const len = this.editorView.state.doc.length;
        this.editorView.dispatch({
          selection: { anchor: len, head: len }
        });
      }
    }, 50);
  }

  private async submit(submitButton: HTMLButtonElement, warnEl: HTMLElement): Promise<void> {
    if (this.isSubmitting) {
      return;
    }

    const body = this.bodyText;
    if (body.trim() === "") {
      warnEl.setText(t("errorEmptyBody"));
      return;
    }

    this.isSubmitting = true;
    submitButton.disabled = true;
    warnEl.empty();

    try {
      const result = await this.onSubmit(body);
      if (result.type === "applied" || result.type === "no-op") {
        this.clearDraft();
        this.close();
        return;
      }

      warnEl.setText(this.getSubmissionError(result));
    } catch {
      warnEl.setText(t("errorLoadingThread"));
    } finally {
      this.isSubmitting = false;
      submitButton.disabled = false;
    }
  }

  private getSubmissionError(result: Exclude<OperationResult, { readonly type: "applied" } | { readonly type: "no-op" }>): string {
    if (result.type === "conflict" || result.type === "missing") {
      return t("operationFailed");
    }
    return result.diagnostics.length > 0 ? t("operationFailed") : t("errorLoadingThread");
  }

  protected clearDraft(): void {
    const draftKey = this.getDraftKey();
    if (draftKey !== null) {
      this.app.saveLocalStorage(draftKey, null);
    }
  }

  override onClose(): void {
    this.editorSession += 1;
    this.disposePreview();
    this.writePaneEl = null;
    this.previewPaneEl = null;
    this.formattingControlsEl = null;
    this.editorTabsEl = null;
    this.writeTabEl = null;
    this.previewTabEl = null;
    this.renderComponent.unload();
    const { contentEl } = this;
    contentEl.empty();
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }
}

export class CreateRecordModal extends ThreadEditorModal {
  constructor(
    app: App,
    titleText: string,
    filePath: string,
    private readonly draftId: string,
    onSubmit: (body: string) => Promise<OperationResult>,
    onCloseCallback?: () => void,
    settings?: FloorNotesSettings,
    viewStyle?: ThreadViewStyle
  ) {
    super(app, titleText, filePath, onSubmit, onCloseCallback, settings, viewStyle);
  }

  protected override getDraftKey(): string {
    return `floor-notes-draft-new-${this.filePath}-${this.draftId}`;
  }

  protected override restoreDraftOnOpen(): boolean {
    return true;
  }
}

export class EditRecordModal extends ThreadEditorModal {
  constructor(
    app: App,
    titleText: string,
    filePath: string,
    private readonly recordId: string,
    initialBody: string,
    onSubmit: (body: string) => Promise<OperationResult>,
    onCloseCallback?: () => void,
    settings?: FloorNotesSettings,
    viewStyle?: ThreadViewStyle
  ) {
    super(app, titleText, filePath, onSubmit, onCloseCallback, settings, viewStyle);
    this.bodyText = initialBody;
  }

  protected override getDraftKey(): string {
    return `floor-notes-draft-edit-${this.filePath}-${this.recordId}`;
  }

  protected override showDraftActions(): boolean {
    return true;
  }
}

export class DeleteConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly message: string,
    private readonly onSubmit: () => Promise<OperationResult>,
    private readonly onCloseCallback?: () => void,
    private readonly settings: FloorNotesSettings = DEFAULT_SETTINGS,
    private readonly viewStyle?: ThreadViewStyle
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Add custom class for styling control
    modalEl.classList.add("floor-notes-confirm-modal");

    // Apply custom theme classes so settings tokens are inherited by the modal.
    applyThemeClasses(modalEl, this.settings.theme, this.settings.mode);
    if (this.viewStyle) {
      modalEl.classList.add(`floor-notes-view-style-${this.viewStyle}`);
    }

    this.titleEl.setText(this.titleText);

    contentEl.createEl("p", { text: this.message });
    const warnEl = contentEl.createDiv({ cls: "floor-notes-modal-warn", text: "" });

    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText(t("delete"))
          .setWarning()
          .onClick(() => {
            void this.submit(btn.buttonEl, warnEl);
          });
      })
      .addButton((btn) => {
        btn.setButtonText(t("cancel")).onClick(() => {
          this.close();
        });
      });
  }

  private async submit(deleteButton: HTMLButtonElement, warnEl: HTMLElement): Promise<void> {
    deleteButton.disabled = true;
    warnEl.empty();

    try {
      const result = await this.onSubmit();
      if (result.type === "applied" || result.type === "no-op") {
        this.close();
        return;
      }
      warnEl.setText(result.type === "invalid" && result.diagnostics.length === 0
        ? t("errorLoadingThread")
        : t("operationFailed"));
    } catch {
      warnEl.setText(t("errorLoadingThread"));
    } finally {
      deleteButton.disabled = false;
    }
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly message: string,
    private readonly onConfirm: () => void,
    private readonly settings: FloorNotesSettings = DEFAULT_SETTINGS
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl, modalEl } = this;
    contentEl.empty();

    // Add custom class for styling control
    modalEl.classList.add("floor-notes-confirm-modal");

    // Apply custom theme classes so settings tokens are inherited by the modal.
    applyThemeClasses(modalEl, this.settings.theme, this.settings.mode);

    this.titleEl.setText(this.titleText);
    contentEl.createEl("p", { text: this.message });

    new Setting(contentEl)
      .addButton((btn) => {
        btn
          .setButtonText(t("confirm"))
          .setCta()
          .onClick(() => {
            this.onConfirm();
            this.close();
          });
      })
      .addButton((btn) => {
        btn.setButtonText(t("cancel")).onClick(() => {
          this.close();
        });
      });
  }

  override onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }
}
