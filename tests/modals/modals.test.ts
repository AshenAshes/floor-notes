import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";
import * as obsidian from "obsidian";
import { CreateRecordModal, DeleteConfirmModal, EditRecordModal } from "../../src/modals/ThreadModals";
import { DEFAULT_SETTINGS } from "../../src/settings/types";

const { _testState } = obsidian as any;
const noOp = { type: "no-op" } as const;

function getSubmitButton(modal: { contentEl: HTMLElement }): HTMLButtonElement {
  const button = modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-submit");
  if (!button) {
    throw new Error("Expected the editor submit button to be present.");
  }
  return button;
}

interface MarkdownRendererMock {
  mock: { calls: unknown[][] };
  mockImplementationOnce(
    implementation: (
      app: obsidian.App,
      markdown: string,
      container: HTMLElement,
      sourcePath: string,
      scope: obsidian.Component
    ) => Promise<void>
  ): void;
  mockRejectedValueOnce(error: Error): void;
}

interface MockFunction {
  mockResolvedValue(value: unknown): void;
  mockRejectedValueOnce(value: unknown): void;
  mockReturnValue(value: unknown): void;
}

function getMarkdownRendererMock(): MarkdownRendererMock {
  return Reflect.get(obsidian.MarkdownRenderer, "render") as unknown as MarkdownRendererMock;
}

function getMarkdownRenderCalls(): unknown[][] {
  return getMarkdownRendererMock().mock.calls;
}

describe("CreateRecordModal and EditRecordModal validation and actions", () => {
  beforeEach(() => {
    _testState.registeredButtons.clear();
    _testState.registeredTextAreas.clear();
    _testState.loadedComponents.clear();
    _testState.unloadedComponents.clear();
    _testState.notices.length = 0;
    _testState.mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  it("T-039 T-040 T-041: validates empty input and closes after a successful create", async () => {
    const app = new obsidian.App();
    const onSubmit = vi.fn().mockResolvedValue(noOp);
    const onClose = vi.fn();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "new-floor", onSubmit, onClose);

    modal.open();

    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    let saveBtn = getSubmitButton(modal);
    textarea._onChange("   ");
    saveBtn = getSubmitButton(modal);
    saveBtn.click();

    expect(onSubmit).not.toHaveBeenCalled();
    const warnEl = modal.contentEl.querySelector(".floor-notes-modal-warn") as HTMLElement;
    expect(warnEl.textContent).not.toBe("");

    textarea._onChange("My valid floor content");
    saveBtn = getSubmitButton(modal);
    saveBtn.click();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith("My valid floor content"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(app.loadLocalStorage("floor-notes-draft-new-test-file.md-new-floor")).toBeNull();
  });

  it("T-042 T-043 T-044: closes after a successful floor edit", async () => {
    const app = new obsidian.App();
    const onSubmit = vi.fn().mockResolvedValue(noOp);
    const onClose = vi.fn();
    const modal = new EditRecordModal(app, "Edit floor", "test-file.md", "floor-123", "Initial content", onSubmit, onClose);

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Updated content");
    const saveBtn = getSubmitButton(modal);
    saveBtn.click();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Updated content"));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("T-045 T-046 T-047: retains a reply draft and focus context on a conflict", async () => {
    const app = new obsidian.App();
    const onSubmit = vi.fn().mockResolvedValue({ type: "conflict", reason: "The reply changed elsewhere." });
    const onClose = vi.fn();
    const modal = new EditRecordModal(app, "Edit reply", "test-file.md", "reply-123", "Initial reply content", onSubmit, onClose);

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Updated reply");
    const saveBtn = getSubmitButton(modal);
    saveBtn.click();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Updated reply"));
    const warnEl = modal.contentEl.querySelector(".floor-notes-modal-warn") as HTMLElement;
    await vi.waitFor(() => expect(warnEl.textContent).toBe("The requested change could not be applied."));
    expect(onClose).not.toHaveBeenCalled();
    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    expect(editorView?.state.doc.toString()).toBe("Updated reply");
  });

  it("keeps the editor open for invalid and missing mutation results", async () => {
    const app = new obsidian.App();
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({ type: "invalid", diagnostics: [{ message: "Invalid record." }] })
      .mockResolvedValueOnce({ type: "missing", message: "File no longer exists." });
    const onClose = vi.fn();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "new-floor-failure", onSubmit, onClose);

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    const warnEl = modal.contentEl.querySelector(".floor-notes-modal-warn") as HTMLElement;
    textarea._onChange("Draft that must remain");
    const saveBtn = getSubmitButton(modal);

    saveBtn.click();
    await vi.waitFor(() => expect(warnEl.textContent).toBe("The requested change could not be applied."));
    saveBtn.click();
    await vi.waitFor(() => expect(warnEl.textContent).toBe("The requested change could not be applied."));

    expect(onClose).not.toHaveBeenCalled();
    expect(app.loadLocalStorage("floor-notes-draft-new-test-file.md-new-floor-failure")).toBe("Draft that must remain");
  });

  it("prevents duplicate editor submits while a request is pending", async () => {
    const app = new obsidian.App();
    let resolveSubmit: ((result: typeof noOp) => void) | undefined;
    const onSubmit = vi.fn(() => new Promise<typeof noOp>((resolve) => {
      resolveSubmit = resolve;
    }));
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "new-floor-pending", onSubmit);

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("One request only");
    const saveBtn = getSubmitButton(modal);
    saveBtn.click();
    saveBtn.click();

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(saveBtn.disabled).toBe(true);
    resolveSubmit?.(noOp);
    await vi.waitFor(() => expect(saveBtn.disabled).toBe(false));
  });

  it("persists and restores a new floor draft without exposing draft actions", () => {
    const app = new obsidian.App();
    const draftKey = "floor-notes-draft-new-test-file.md-new-with-draft";
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "new-with-draft", vi.fn().mockResolvedValue(noOp));

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("New content");

    expect(app.loadLocalStorage(draftKey)).toBe("New content");
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-source")).toBeNull();
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-discard")).toBeNull();
    expect(modal.contentEl.querySelectorAll(".floor-notes-editor-action-submit")).toHaveLength(1);
    modal.close();

    const reopenedModal = new CreateRecordModal(app, "Create floor", "test-file.md", "new-with-draft", vi.fn().mockResolvedValue(noOp));
    reopenedModal.open();
    const editorView = (reopenedModal as unknown as { editorView: EditorView | null }).editorView;
    expect(editorView?.state.doc.toString()).toBe("New content");
    expect(reopenedModal.contentEl.querySelector(".floor-notes-editor-action-source")).toBeNull();
  });

  it("shows only submit when an existing record has no usable draft", () => {
    const app = new obsidian.App();
    app.saveLocalStorage("floor-notes-draft-edit-test-file.md-floor-without-draft", "Original content");
    const modal = new EditRecordModal(
      app,
      "Edit floor",
      "test-file.md",
      "floor-without-draft",
      "Original content",
      vi.fn().mockResolvedValue(noOp)
    );

    modal.open();
    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    expect(editorView?.state.doc.toString()).toBe("Original content");
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-source")).toBeNull();
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-discard")).toBeNull();
    expect(modal.contentEl.querySelectorAll(".floor-notes-editor-action-submit")).toHaveLength(1);
  });

  it("automatically enters draft view when the original content changes", () => {
    const app = new obsidian.App();
    const draftKey = "floor-notes-draft-edit-test-file.md-floor-original-change";
    const modal = new EditRecordModal(
      app,
      "Edit floor",
      "test-file.md",
      "floor-original-change",
      "Original content",
      vi.fn().mockResolvedValue(noOp)
    );

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Changed original content");

    expect(app.loadLocalStorage(draftKey)).toBe("Changed original content");
    expect(modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.innerText).toBe("Original");
    expect(modal.contentEl.querySelectorAll(".floor-notes-editor-action-discard")).toHaveLength(1);
    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.click();
    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    expect(editorView?.state.doc.toString()).toBe("Original content");
    expect(modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.innerText).toBe("Draft");
  });

  it("returns to the original view and clears the draft after an exact content match", () => {
    const app = new obsidian.App();
    const draftKey = "floor-notes-draft-edit-test-file.md-floor-restore-original";
    const modal = new EditRecordModal(
      app,
      "Edit floor",
      "test-file.md",
      "floor-restore-original",
      "Original content",
      vi.fn().mockResolvedValue(noOp)
    );

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Changed content");
    textarea._onChange("Original content");

    expect(app.loadLocalStorage(draftKey)).toBeNull();
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-source")).toBeNull();
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-discard")).toBeNull();
  });

  it("treats whitespace changes and empty content as editable drafts", () => {
    const app = new obsidian.App();
    const draftKey = "floor-notes-draft-edit-test-file.md-floor-strict-comparison";
    const originalBody = "Original content\n";
    const modal = new EditRecordModal(
      app,
      "Edit floor",
      "test-file.md",
      "floor-strict-comparison",
      originalBody,
      vi.fn().mockResolvedValue(noOp)
    );

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Original content");
    expect(app.loadLocalStorage(draftKey)).toBe("Original content");
    expect(modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.innerText).toBe("Original");
    expect(modal.contentEl.querySelectorAll(".floor-notes-editor-action-discard")).toHaveLength(1);

    textarea._onChange("");
    expect(app.loadLocalStorage(draftKey)).toBe("");
    expect(modal.contentEl.querySelectorAll(".floor-notes-editor-action-discard")).toHaveLength(1);
    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-discard")?.click();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    expect(editorView?.state.doc.toString()).toBe(originalBody);
    expect(app.loadLocalStorage(draftKey)).toBeNull();
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-source")).toBeNull();
  });

  it("persists direct CodeMirror changes and keeps submit last in draft view", () => {
    const app = new obsidian.App();
    const draftKey = "floor-notes-draft-edit-test-file.md-floor-codemirror-change";
    app.saveLocalStorage(draftKey, "Saved draft");
    const modal = new EditRecordModal(
      app,
      "Edit floor",
      "test-file.md",
      "floor-codemirror-change",
      "Original content",
      vi.fn().mockResolvedValue(noOp)
    );

    modal.open();
    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    if (!editorView) {
      throw new Error("Expected the CodeMirror editor to be present.");
    }
    editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: "Changed in CodeMirror" } });
    expect(app.loadLocalStorage(draftKey)).toBe("Changed in CodeMirror");
    expect(modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.innerText).toBe("Original");

    const submitActions = modal.contentEl.querySelector<HTMLElement>(".floor-notes-editor-actions-submit");
    expect(Array.from(submitActions?.children ?? []).map((child) => child.className)).toEqual([
      expect.stringContaining("floor-notes-editor-action-discard"),
      expect.stringContaining("floor-notes-editor-action-submit")
    ]);
    expect(getSubmitButton(modal).innerText).toBe("Submit");

    editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: "Original content" } });
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-source")).toBeNull();
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-discard")).toBeNull();
    expect(app.loadLocalStorage(draftKey)).toBeNull();
  });

  it("keeps the original body visible until an existing draft is selected", () => {
    const app = new obsidian.App();
    const draftKey = "floor-notes-draft-edit-test-file.md-floor-with-draft";
    app.saveLocalStorage(draftKey, "Saved draft");
    const modal = new EditRecordModal(
      app,
      "Edit floor",
      "test-file.md",
      "floor-with-draft",
      "Original content",
      vi.fn().mockResolvedValue(noOp)
    );

    modal.open();
    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    expect(editorView?.state.doc.toString()).toBe("Original content");
    const draftButton = modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source");
    expect(draftButton?.innerText).toBe("Draft");
    draftButton?.click();

    expect(editorView?.state.doc.toString()).toBe("Saved draft");
    expect(modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.innerText).toBe("Original");
    expect(modal.contentEl.querySelectorAll(".floor-notes-editor-action-discard")).toHaveLength(1);
  });

  it("persists selected draft edits, restores the original, and discards without closing", () => {
    const app = new obsidian.App();
    const draftKey = "floor-notes-draft-edit-test-file.md-floor-draft-actions";
    app.saveLocalStorage(draftKey, "Saved draft");
    const onClose = vi.fn();
    const modal = new EditRecordModal(
      app,
      "Edit floor",
      "test-file.md",
      "floor-draft-actions",
      "Original content",
      vi.fn().mockResolvedValue(noOp),
      onClose
    );

    modal.open();
    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.click();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Revised draft");
    expect(app.loadLocalStorage(draftKey)).toBe("Revised draft");

    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.click();
    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    expect(editorView?.state.doc.toString()).toBe("Original content");
    expect(modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.innerText).toBe("Draft");
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-discard")).toBeNull();

    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.click();
    expect(editorView?.state.doc.toString()).toBe("Revised draft");
    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-discard")?.click();

    expect(app.loadLocalStorage(draftKey)).toBeNull();
    expect(editorView?.state.doc.toString()).toBe("Original content");
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-source")).toBeNull();
    expect(modal.contentEl.querySelector(".floor-notes-editor-action-discard")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clears the selected edit draft after a successful save", async () => {
    const app = new obsidian.App();
    const draftKey = "floor-notes-draft-edit-test-file.md-floor-submit-draft";
    app.saveLocalStorage(draftKey, "Saved draft");
    const onSubmit = vi.fn().mockResolvedValue(noOp);
    const modal = new EditRecordModal(app, "Edit floor", "test-file.md", "floor-submit-draft", "Original content", onSubmit);

    modal.open();
    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-action-source")?.click();
    getSubmitButton(modal).click();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Saved draft"));
    await vi.waitFor(() => expect(app.loadLocalStorage(draftKey)).toBeNull());
  });

  it("defaults to the write panel and exposes accessible editor mode tabs", () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "editor-tabs", vi.fn().mockResolvedValue(noOp));

    modal.open();

    const tabs = modal.contentEl.querySelector<HTMLElement>(".floor-notes-editor-tabs");
    const writeTab = modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(1)");
    const previewTab = modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(2)");
    const writePane = modal.contentEl.querySelector<HTMLElement>(".floor-notes-editor-pane-write");
    const previewPane = modal.contentEl.querySelector<HTMLElement>(".floor-notes-editor-pane-preview");

    expect(tabs?.dataset.activeMode).toBe("write");
    expect(writeTab?.getAttribute("role")).toBe("tab");
    expect(previewTab?.getAttribute("role")).toBe("tab");
    expect(writeTab?.getAttribute("aria-selected")).toBe("true");
    expect(previewTab?.getAttribute("aria-selected")).toBe("false");
    expect(writeTab?.getAttribute("aria-controls")).toBe(writePane?.id);
    expect(previewTab?.getAttribute("aria-controls")).toBe(previewPane?.id);
    expect(writePane?.hidden).toBe(false);
    expect(previewPane?.hidden).toBe(true);

    modal.close();
  });

  it("renders the canonical Markdown text in preview and routes internal links from its source path", async () => {
    const app = new obsidian.App();
    const openLinkText = vi.fn().mockResolvedValue(undefined);
    Object.assign(app, { workspace: { openLinkText } });
    const modal = new CreateRecordModal(app, "Create floor", "folder/source.md", "preview-render", vi.fn().mockResolvedValue(noOp));

    modal.open();
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("[[folder/target#heading|Readable label]]");
    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(2)")?.click();

    await vi.waitFor(() => expect(getMarkdownRenderCalls()).toContainEqual([
      app,
      "[[folder/target#heading|Readable label]]",
      expect.any(HTMLElement),
      "folder/source.md",
      expect.any(obsidian.Component)
    ]));

    await vi.waitFor(() => expect(
      modal.contentEl.querySelector<HTMLElement>(".floor-notes-modal-preview")?.hidden
    ).toBe(false));
    const link = modal.contentEl.querySelector<HTMLAnchorElement>(".floor-notes-editor-pane-preview a.internal-link[data-href]");
    link?.click();
    expect(openLinkText).toHaveBeenCalledWith("folder/target#heading", "folder/source.md");

    modal.close();
  });

  it("switches preview tabs with keyboard controls and unloads each preview scope", async () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "preview-lifecycle", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Previewable content");
    const tabs = modal.contentEl.querySelector<HTMLElement>(".floor-notes-editor-tabs");
    const writeTab = modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(1)");
    const previewTab = modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(2)");
    const focusPreview = vi.spyOn(previewTab!, "focus");
    const focusWrite = vi.spyOn(writeTab!, "focus");
    const initialScope = Array.from(_testState.loadedComponents)[0];
    tabs?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    await vi.waitFor(() => expect(getMarkdownRenderCalls()).toHaveLength(1));
    const previewScope = Array.from(_testState.loadedComponents).find((scope) => scope !== initialScope);
    expect(tabs?.dataset.activeMode).toBe("preview");
    expect(previewTab?.getAttribute("aria-selected")).toBe("true");
    expect(focusPreview).toHaveBeenCalledOnce();

    tabs?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(tabs?.dataset.activeMode).toBe("write");
    expect(writeTab?.getAttribute("aria-selected")).toBe("true");
    expect(focusWrite).toHaveBeenCalledOnce();
    expect(_testState.unloadedComponents.has(previewScope)).toBe(true);

    tabs?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await vi.waitFor(() => expect(getMarkdownRenderCalls()).toHaveLength(2));
    expect(tabs?.dataset.activeMode).toBe("preview");
    const finalPreviewScope = Array.from(_testState.loadedComponents).at(-1);
    modal.close();
    expect(_testState.unloadedComponents.has(finalPreviewScope)).toBe(true);
  });

  it("shows an empty state without invoking the Markdown renderer", () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "empty-preview", vi.fn().mockResolvedValue(noOp));
    modal.open();

    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(2)")?.click();

    expect(modal.contentEl.querySelector<HTMLElement>(".floor-notes-preview-empty")?.innerText).toBe("Nothing to preview.");
    expect(getMarkdownRenderCalls()).toHaveLength(0);
    modal.close();
  });

  it("shows an error state when preview rendering fails", async () => {
    getMarkdownRendererMock().mockRejectedValueOnce(new Error("Renderer unavailable"));
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "preview-error", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Previewable content");
    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(2)")?.click();

    await vi.waitFor(() => expect(
      modal.contentEl.querySelector<HTMLElement>(".floor-notes-preview-error")?.innerText
    ).toBe("Unable to render preview."));
    modal.close();
  });

  it("keeps the CodeMirror selection when returning from preview", async () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "preview-selection", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    expect(editorView).not.toBeNull();
    editorView?.dispatch({
      changes: { from: 0, to: 0, insert: "Selected Markdown" },
      selection: { anchor: 0, head: 8 }
    });

    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(2)")?.click();
    await vi.waitFor(() => expect(getMarkdownRenderCalls()).toHaveLength(1));
    modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(1)")?.click();

    expect(editorView?.state.selection.main.from).toBe(0);
    expect(editorView?.state.selection.main.to).toBe(8);
    modal.close();
  });

  it("keeps selected editor text readable in dark mode", () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(
      app,
      "Create floor",
      "test-file.md",
      "dark-selection-contrast",
      vi.fn().mockResolvedValue(noOp),
      undefined,
      { ...DEFAULT_SETTINGS, theme: "obsidian", mode: "dark" }
    );
    modal.open();

    const codeMirrorStyles = Array.from(modal.modalEl.ownerDocument.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");
    const focusedSelectionRules = Array.from(codeMirrorStyles.matchAll(
      /\.cm-editor\.cm-focused\s*>\s*\.cm-scroller\s*>\s*\.cm-selectionLayer\s+\.cm-selectionBackground[^{]*\{([^}]*)\}/g
    ));

    expect(focusedSelectionRules.some(([, declarations]) =>
      /background-color:\s*var\(--text-selection\)/.test(declarations ?? "")
    )).toBe(true);
    modal.close();
  });

  it("ignores a stale preview render after returning to write mode", async () => {
    let resolveRender: (() => void) | undefined;
    const renderGate = new Promise<void>((resolve) => {
      resolveRender = resolve;
    });
    let staleLink: HTMLAnchorElement | null = null;
    getMarkdownRendererMock().mockImplementationOnce(async (_app, _markdown, container) => {
      await renderGate;
      staleLink = container.createEl("a", {
        cls: "internal-link",
        attr: { "data-href": "stale-target" }
      });
    });

    const app = new obsidian.App();
    const openLinkText = vi.fn().mockResolvedValue(undefined);
    Object.assign(app, { workspace: { openLinkText } });
    const modal = new CreateRecordModal(app, "Create floor", "folder/source.md", "stale-preview", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange("Pending preview");
    const writeTab = modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(1)");
    const previewTab = modal.contentEl.querySelector<HTMLButtonElement>(".floor-notes-editor-tab:nth-child(2)");
    const previewPane = modal.contentEl.querySelector<HTMLElement>(".floor-notes-editor-pane-preview");
    previewTab?.click();
    await vi.waitFor(() => expect(getMarkdownRenderCalls()).toHaveLength(1));

    writeTab?.click();
    resolveRender?.();
    await vi.waitFor(() => expect(staleLink).not.toBeNull());
    await Promise.resolve();

    const renderedStaleLink = staleLink as HTMLAnchorElement | null;
    renderedStaleLink?.click();
    expect(openLinkText).not.toHaveBeenCalled();
    expect(previewPane?.childElementCount).toBe(0);
    modal.close();
  });

  it("only unwraps formatting when the selection contains both marker copies", () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "format-marker-boundary", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    if (!editorView) {
      throw new Error("Expected the CodeMirror editor to be present.");
    }
    const boldButton = modal.contentEl.querySelector<HTMLButtonElement>(".btn-bold");
    editorView.dispatch({
      changes: { from: 0, to: 0, insert: "**" },
      selection: { anchor: 0, head: 2 }
    });
    boldButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(editorView?.state.doc.toString()).toBe("******");

    editorView?.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: "**bold**" },
      selection: { anchor: 0, head: 8 }
    });
    boldButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(editorView?.state.doc.toString()).toBe("bold");
    modal.close();
  });

  it("preserves meaningful leading, trailing, and indented Markdown when submitting", async () => {
    const app = new obsidian.App();
    const onSubmit = vi.fn().mockResolvedValue(noOp);
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "raw-body", onSubmit);
    modal.open();

    const body = "\n  **Keep this indentation**\n\n";
    const textarea = Array.from(_testState.registeredTextAreas)[0] as any;
    textarea._onChange(body);
    const saveBtn = getSubmitButton(modal);
    saveBtn.click();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith(body));
  });

  it("renders the emoji panel outside the clipping editor and closes it through its owner window", () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "emoji-overlay", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorContainer = modal.contentEl.querySelector<HTMLElement>(".floor-notes-modal-editor-container");
    const emojiButton = modal.contentEl.querySelector<HTMLButtonElement>(".btn-emoji");
    expect(editorContainer).not.toBeNull();
    expect(emojiButton).not.toBeNull();

    const focus = vi.spyOn(emojiButton!, "focus");
    emojiButton?.click();
    let panel = modal.contentEl.querySelector<HTMLElement>(".floor-notes-emoji-panel");
    expect(panel).not.toBeNull();
    expect(panel?.parentElement).toBe(modal.contentEl);
    expect(editorContainer?.contains(panel)).toBe(false);

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(modal.contentEl.querySelector(".floor-notes-emoji-panel")).toBeNull();

    emojiButton?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(modal.contentEl.querySelector(".floor-notes-emoji-panel")).toBeNull();
    expect(focus).toHaveBeenCalledOnce();

    emojiButton?.click();
    panel = modal.contentEl.querySelector<HTMLElement>(".floor-notes-emoji-panel");
    expect(panel).not.toBeNull();
    window.dispatchEvent(new Event("resize"));
    expect(modal.contentEl.querySelector(".floor-notes-emoji-panel")).toBeNull();

    modal.close();
  });

  it("escapes Markdown-sensitive kaomoji characters while leaving emoji unchanged", () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "kaomoji-escape", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    const emojiButton = modal.contentEl.querySelector<HTMLButtonElement>(".btn-emoji");
    emojiButton?.click();
    const kaomojiTab = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-emoji-tab"))
      .find((tab) => tab.innerText === "颜文字");
    kaomojiTab?.click();
    const sleepingKaomoji = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-emoji-item"))
      .find((item) => item.innerText === "_(:з」∠)_");
    sleepingKaomoji?.click();

    expect(editorView?.state.doc.toString()).toBe("\\_(:з」∠)\\_");

    emojiButton?.click();
    const emoji = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-emoji-item"))
      .find((item) => item.innerText === "😄");
    emoji?.click();
    expect(editorView?.state.doc.toString()).toBe("\\_(:з」∠)\\_😄");

    emojiButton?.click();
    const kaomojiTabAgain = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-emoji-tab"))
      .find((tab) => tab.innerText === "颜文字");
    kaomojiTabAgain?.click();
    const fullWidthHashKaomoji = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-emoji-item"))
      .find((item) => item.innerText === "o(￣ヘ￣o＃)");
    fullWidthHashKaomoji?.click();
    expect(editorView?.state.doc.toString()).toBe("\\_(:з」∠)\\_😄o(￣ヘ￣o＃)");

    modal.close();
  });

  it("inserts Markdown link syntax without losing the editor selection", () => {
    const app = new obsidian.App();
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "insert-link", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    if (!editorView) {
      throw new Error("Expected CodeMirror editor");
    }
    const formattingButtons = Array.from(modal.contentEl.querySelectorAll<HTMLButtonElement>(
      ".floor-notes-modal-formatting-controls button"
    ));
    const italicIndex = formattingButtons.findIndex((button) => button.classList.contains("btn-italic"));
    const linkIndex = formattingButtons.findIndex((button) => button.classList.contains("btn-link"));
    const emojiIndex = formattingButtons.findIndex((button) => button.classList.contains("btn-emoji"));
    const linkButton = formattingButtons[linkIndex];

    expect(italicIndex).toBeLessThan(linkIndex);
    expect(linkIndex).toBeLessThan(emojiIndex);
    expect(linkButton?.type).toBe("button");
    expect(linkButton?.getAttribute("aria-label")).toBe("Insert link");
    expect(linkButton?.getAttribute("data-tooltip-position")).toBe("top");

    linkButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    linkButton?.click();
    expect(editorView?.state.doc.toString()).toBe("[]()");
    expect(editorView?.state.selection.main.anchor).toBe(1);

    editorView?.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: "Example" },
      selection: { anchor: 0, head: 7 }
    });
    linkButton?.click();
    expect(editorView?.state.doc.toString()).toBe("[Example]()");
    expect(editorView?.state.selection.main.anchor).toBe(10);
    expect(editorView?.state.selection.main.head).toBe(10);
    modal.close();
  });

  it("saves a pasted image to the vault and inserts its Markdown link", async () => {
    const app = new obsidian.App();
    const getAvailablePathForAttachment = Reflect.get(app.fileManager, "getAvailablePathForAttachment") as unknown as MockFunction;
    const generateMarkdownLink = Reflect.get(app.fileManager, "generateMarkdownLink") as unknown as MockFunction;
    const createBinary = Reflect.get(app.vault, "createBinary") as unknown as MockFunction;
    getAvailablePathForAttachment.mockResolvedValue("attachments/pasted.png");
    generateMarkdownLink.mockReturnValue("[[attachments/pasted.png]]");
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "paste-image", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    const file = {
      name: "clipboard.png",
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4))
    } as unknown as File;
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { items: [{ type: "image/png", getAsFile: () => file }] }
    });
    editorView?.contentDOM.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(createBinary).toHaveBeenCalledWith("attachments/pasted.png", expect.any(ArrayBuffer)));
    expect(getAvailablePathForAttachment).toHaveBeenCalledWith(expect.stringMatching(/^Pasted image \d{14}\.png$/), "test-file.md");
    expect(generateMarkdownLink).toHaveBeenCalledOnce();
    expect(editorView?.state.doc.toString()).toBe("![[attachments/pasted.png]]");
    modal.close();
  });

  it("uses a matching active file's private attachment saver before the public fallback", async () => {
    const app = new obsidian.App();
    const getActiveFile = Reflect.get(app.workspace, "getActiveFile") as unknown as MockFunction;
    const getAvailablePathForAttachment = Reflect.get(app.fileManager, "getAvailablePathForAttachment") as unknown as MockFunction;
    const createBinary = Reflect.get(app.vault, "createBinary") as unknown as MockFunction;
    const generateMarkdownLink = Reflect.get(app.fileManager, "generateMarkdownLink") as unknown as MockFunction;
    const activeFile = new obsidian.TFile();
    activeFile.path = "test-file.md";
    activeFile.name = "test-file.md";
    const savedFile = new obsidian.TFile();
    savedFile.path = "cal-assets/pasted.png";
    savedFile.name = "pasted.png";
    getActiveFile.mockReturnValue(activeFile);
    generateMarkdownLink.mockReturnValue("[[cal-assets/pasted.png]]");
    const saveAttachment = vi.fn().mockResolvedValue(savedFile);
    Reflect.set(app, "saveAttachment", saveAttachment);
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "private-paste", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [{
          type: "image/png",
          getAsFile: () => ({ name: "clipboard.png", arrayBuffer: async () => new ArrayBuffer(4) })
        }]
      }
    });
    editorView?.contentDOM.dispatchEvent(event);

    await vi.waitFor(() => expect(saveAttachment).toHaveBeenCalledOnce());
    expect(saveAttachment).toHaveBeenCalledWith(expect.stringMatching(/^Pasted image \d{14}$/), "png", expect.any(ArrayBuffer));
    expect(getAvailablePathForAttachment).not.toHaveBeenCalled();
    expect(createBinary).not.toHaveBeenCalled();
    expect(generateMarkdownLink).toHaveBeenCalledWith(savedFile, "test-file.md");
    expect(editorView?.state.doc.toString()).toBe("![[cal-assets/pasted.png]]");
    modal.close();
  });

  it("uses the public attachment path when the active file does not match the modal", async () => {
    const app = new obsidian.App();
    const getActiveFile = Reflect.get(app.workspace, "getActiveFile") as unknown as MockFunction;
    const getAvailablePathForAttachment = Reflect.get(app.fileManager, "getAvailablePathForAttachment") as unknown as MockFunction;
    const createBinary = Reflect.get(app.vault, "createBinary") as unknown as MockFunction;
    const activeFile = new obsidian.TFile();
    activeFile.path = "other-file.md";
    activeFile.name = "other-file.md";
    getActiveFile.mockReturnValue(activeFile);
    const saveAttachment = vi.fn();
    Reflect.set(app, "saveAttachment", saveAttachment);
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "mismatched-paste", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [{
          type: "image/png",
          getAsFile: () => ({ name: "clipboard.png", arrayBuffer: async () => new ArrayBuffer(4) })
        }]
      }
    });
    editorView?.contentDOM.dispatchEvent(event);

    await vi.waitFor(() => expect(createBinary).toHaveBeenCalledOnce());
    expect(saveAttachment).not.toHaveBeenCalled();
    expect(getAvailablePathForAttachment).toHaveBeenCalledWith(expect.stringMatching(/^Pasted image \d{14}\.png$/), "test-file.md");
    modal.close();
  });

  it("falls back to the public attachment path when the private saver fails", async () => {
    const app = new obsidian.App();
    const getActiveFile = Reflect.get(app.workspace, "getActiveFile") as unknown as MockFunction;
    const createBinary = Reflect.get(app.vault, "createBinary") as unknown as MockFunction;
    const activeFile = new obsidian.TFile();
    activeFile.path = "test-file.md";
    activeFile.name = "test-file.md";
    getActiveFile.mockReturnValue(activeFile);
    const saveAttachment = vi.fn().mockRejectedValue(new Error("CAL unavailable"));
    Reflect.set(app, "saveAttachment", saveAttachment);
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "private-paste-failure", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [{
          type: "image/png",
          getAsFile: () => ({ name: "clipboard.png", arrayBuffer: async () => new ArrayBuffer(4) })
        }]
      }
    });
    editorView?.contentDOM.dispatchEvent(event);

    await vi.waitFor(() => expect(createBinary).toHaveBeenCalledOnce());
    expect(saveAttachment).toHaveBeenCalledOnce();
    expect(editorView?.state.doc.toString()).toMatch(/^!\[\[attachments\/Pasted image \d{14}\.png\]\]$/);
    modal.close();
  });

  it("leaves non-image paste events to CodeMirror and removes the image handler on close", () => {
    const app = new obsidian.App();
    const createBinary = Reflect.get(app.vault, "createBinary") as unknown as MockFunction;
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "paste-cleanup", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    const textEvent = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(textEvent, "clipboardData", {
      value: {
        items: [{ type: "text/plain", getAsFile: () => null }],
        getData: (type: string) => type === "text/plain" ? "ordinary text" : ""
      }
    });
    editorView?.contentDOM.dispatchEvent(textEvent);
    expect(editorView?.state.doc.toString()).toBe("ordinary text");
    expect(createBinary).not.toHaveBeenCalled();

    modal.close();
    const imageEvent = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(imageEvent, "clipboardData", {
      value: {
        items: [{ type: "image/png", getAsFile: () => ({ name: "after-close.png" }) }],
        getData: () => ""
      }
    });
    editorView?.contentDOM.dispatchEvent(imageEvent);
    expect(createBinary).not.toHaveBeenCalled();
  });

  it("does not insert a link when saving a pasted image fails", async () => {
    const app = new obsidian.App();
    const createBinary = Reflect.get(app.vault, "createBinary") as unknown as MockFunction;
    createBinary.mockRejectedValueOnce(new Error("Vault unavailable"));
    const modal = new CreateRecordModal(app, "Create floor", "test-file.md", "paste-failure", vi.fn().mockResolvedValue(noOp));
    modal.open();

    const editorView = (modal as unknown as { editorView: EditorView | null }).editorView;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: {
        items: [{
          type: "image/png",
          getAsFile: () => ({ name: "broken.png", arrayBuffer: async () => new ArrayBuffer(0) })
        }]
      }
    });
    editorView?.contentDOM.dispatchEvent(event);

    await vi.waitFor(() => expect(_testState.notices.at(-1)?.message).toBe("Failed to paste image"));
    expect(editorView?.state.doc.toString()).toBe("");
    consoleError.mockRestore();
    modal.close();
  });

  it("T-048 T-049 T-050: closes delete confirmation only after a successful result", async () => {
    const app = new obsidian.App();
    const onSubmit = vi.fn().mockResolvedValue(noOp);
    const onClose = vi.fn();
    const modal = new DeleteConfirmModal(app, "Delete floor", "Delete confirmation warning", onSubmit, onClose);

    modal.open();
    const deleteBtn = Array.from(_testState.registeredButtons)[0] as any;
    deleteBtn._onClick();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it("retains delete confirmation on a conflict", async () => {
    const app = new obsidian.App();
    const onSubmit = vi.fn().mockResolvedValue({ type: "conflict", reason: "The floor changed elsewhere." });
    const onClose = vi.fn();
    const modal = new DeleteConfirmModal(app, "Delete reply", "Delete confirmation warning", onSubmit, onClose);

    modal.open();
    const deleteBtn = Array.from(_testState.registeredButtons)[0] as any;
    deleteBtn._onClick();

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const warnEl = modal.contentEl.querySelector(".floor-notes-modal-warn") as HTMLElement;
    await vi.waitFor(() => expect(warnEl.textContent).toBe("The requested change could not be applied."));
    expect(onClose).not.toHaveBeenCalled();
  });
});
