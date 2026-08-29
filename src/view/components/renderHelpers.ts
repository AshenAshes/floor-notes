import { App, Component, MarkdownRenderer, setIcon } from "obsidian";
import { ParsedThreadDocument, ParsedRecord, Diagnostic } from "../../format/types";
import { normalizeMarkdownImageTargets } from "../../format/imageSizing";
import { t } from "../../util/locale";

function getComparableFileName(value: string): string {
  const path = value.split(/[?#]/, 1)[0]?.replace(/\\/g, "/") ?? "";
  const encodedName = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(encodedName).normalize("NFC").toLocaleLowerCase();
  } catch {
    return encodedName.normalize("NFC").toLocaleLowerCase();
  }
}

function hasAutomaticImageLabel(
  label: string,
  image: HTMLImageElement | null,
  additionalSource?: string | null
): boolean {
  if (!label) {
    return false;
  }

  const labelFileName = getComparableFileName(label);
  const sources = [additionalSource, image?.getAttribute("src")];
  return sources.some((source) => source !== null && source !== undefined
    && getComparableFileName(source) === labelFileName);
}

function getVisibleImageDescription(label: string): string {
  return label.replace(/(?:^|\|)\d+(?:x\d+)?$/, "").trim();
}

function isImageOnlyContentNode(node: ChildNode): boolean {
  if (node.nodeType === 3) {
    return (node.textContent ?? "").trim() === "";
  }
  if (node.nodeType === 8) {
    return true;
  }
  if (node.nodeType !== 1) {
    return false;
  }

  const element = node as Element;
  if (element.matches("img, .image-embed, .floor-notes-image-description")) {
    return true;
  }
  return element.childNodes.length > 0
    && Array.from(element.childNodes).every(isImageOnlyContentNode);
}

function isImageOnlyParagraph(paragraph: Element): boolean {
  return paragraph.children.length > 0
    && Array.from(paragraph.childNodes).every(isImageOnlyContentNode);
}

function normalizeRenderedImages(
  container: HTMLElement,
  showImageDescriptions: boolean,
  showStandardMarkdownDescriptions: boolean
): void {
  for (const embed of Array.from(container.querySelectorAll<HTMLElement>(".image-embed[alt]"))) {
    const label = getVisibleImageDescription(embed.getAttribute("alt")?.trim() ?? "");
    const image = embed.querySelector<HTMLImageElement>("img");
    const shouldShowDescription = showImageDescriptions
      && label !== ""
      && !hasAutomaticImageLabel(label, image, embed.getAttribute("src"));

    embed.removeAttribute("alt");
    if (shouldShowDescription) {
      const description = embed.createSpan({
        cls: "floor-notes-image-description",
        text: label
      });
      description.setAttribute("aria-hidden", "true");
    }
  }

  for (const image of Array.from(container.querySelectorAll<HTMLImageElement>("img"))) {
    if (showStandardMarkdownDescriptions && !image.closest(".image-embed")) {
      const label = getVisibleImageDescription(image.alt.trim());
      const descriptionAnchor = image.closest<HTMLElement>("a") ?? image;
      const descriptionParent = descriptionAnchor.parentElement;
      if (
        label !== ""
        && descriptionParent
        && container.contains(descriptionParent)
        && !hasAutomaticImageLabel(label, image)
      ) {
        const description = descriptionParent.createSpan({
          cls: "floor-notes-image-description",
          text: label
        });
        description.setAttribute("aria-hidden", "true");
        descriptionAnchor.after(description);
      }
    }
    const paragraph = image.closest<HTMLParagraphElement>("p");
    if (paragraph && container.contains(paragraph) && isImageOnlyParagraph(paragraph)) {
      paragraph.classList.add("floor-notes-image-paragraph");
    }
  }
}

function renderReplyAuthorLabel(container: HTMLElement, authorLabel: string): void {
  const firstBlock = container.firstElementChild;
  const isOrdinaryParagraph = firstBlock?.tagName === "P"
    && !isImageOnlyParagraph(firstBlock);
  const label = isOrdinaryParagraph
    ? container.createSpan({ cls: "floor-notes-reply-author" })
    : container.createDiv({
      cls: "floor-notes-reply-author floor-notes-reply-author-lead"
    });
  label.textContent = `${authorLabel}:`;

  if (!isOrdinaryParagraph || !firstBlock) {
    container.prepend(label);
    return;
  }

  firstBlock.prepend(label);
  label.after(" ");
}

export function createA11yButton(
  parent: HTMLElement,
  text: string,
  ariaLabel: string,
  onClick: (button: HTMLButtonElement) => void,
  cls?: string
): HTMLButtonElement {
  const btn = parent.createEl("button", {
    text,
    cls: cls || "floor-notes-btn",
    attr: {
      type: "button",
      "aria-label": ariaLabel,
      "data-tooltip-position": "top"
    }
  });

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    onClick(btn);
  });

  return btn;
}

export function createA11yIconButton(
  parent: HTMLElement,
  iconId: string,
  ariaLabel: string,
  onClick: (button: HTMLButtonElement) => void,
  cls?: string
): HTMLButtonElement {
  const btn = parent.createEl("button", {
    cls: cls || "floor-notes-icon-btn",
    attr: {
      type: "button",
      "aria-label": ariaLabel,
      "data-tooltip-position": "top"
    }
  });
  setIcon(btn, iconId);

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    onClick(btn);
  });

  return btn;
}

interface RenderMarkdownBodyOptions {
  readonly isActive?: () => boolean;
  readonly presentation?: "editor-preview" | "floor-view";
  readonly showImageDescriptions?: boolean;
}

export async function renderMarkdownBody(
  container: HTMLElement,
  bodyText: string,
  app: App,
  sourcePath: string,
  scope: Component,
  options: RenderMarkdownBodyOptions = {}
): Promise<void> {
  const isFloorView = options.presentation === "floor-view";
  await MarkdownRenderer.render(
    app,
    isFloorView ? normalizeMarkdownImageTargets(bodyText) : bodyText,
    container,
    sourcePath,
    scope
  );
  if (options.isActive && !options.isActive()) {
    return;
  }
  const showImageDescriptions = isFloorView && options.showImageDescriptions === true;
  normalizeRenderedImages(container, showImageDescriptions, showImageDescriptions);

  scope.registerDomEvent(container, "click", (event: MouseEvent) => {
    const ownerWindow = container.ownerDocument.defaultView;
    if (!ownerWindow || !(event.target instanceof ownerWindow.HTMLElement)) {
      return;
    }

    const link = event.target.closest<HTMLAnchorElement>("a.internal-link[data-href]");
    const linkText = link?.dataset.href;
    if (!link || !linkText || !container.contains(link)) {
      return;
    }

    event.preventDefault();
    void app.workspace.openLinkText(linkText, sourcePath);
  });
}

export function renderHeader(
  container: HTMLElement,
  doc: ParsedThreadDocument,
  onViewMarkdown: () => void,
  onToggleSort: () => void,
  onAddFloor: () => void,
  onSelectViewStyle: (trigger: HTMLButtonElement) => void
): void {
  const headerEl = container.hasClass("floor-notes-header")
    ? container
    : container.createDiv({ cls: "floor-notes-header" });
  headerEl.empty();
  
  // Title
  headerEl.createEl("h1", { cls: "floor-notes-header-title", text: doc.title || t("settingsTitle") });

  const actionsEl = headerEl.createDiv({ cls: "floor-notes-header-actions" });

  // View as Markdown Icon Button (file-text icon)
  createA11yIconButton(actionsEl, "file-text", t("openAsMarkdown"), onViewMarkdown);

  // Toggle Sort Icon Button (arrow-up-down icon)
  createA11yIconButton(actionsEl, "arrow-up-down", t("toggleSort"), onToggleSort);

  // Select view style icon button (palette icon)
  createA11yIconButton(actionsEl, "palette", t("changeViewStyle"), onSelectViewStyle);

  // Add Floor Icon Button (plus icon)
  createA11yIconButton(actionsEl, "plus", t("addFloor"), onAddFloor);
}

export async function renderRecord(
  container: HTMLElement,
  record: ParsedRecord,
  bodyText: string,
  app: App,
  path: string,
  scope: Component,
  onReply: () => void,
  onEdit: () => void,
  onDelete: () => void,
  onToggleFavorite?: () => void,
  authorLabel?: string,
  showImageDescriptions = false
): Promise<HTMLElement> {
  const isFloor = record.type === "floor";
  const recordEl = container.createEl("article", {
    cls: `floor-notes-record ${isFloor ? "floor-notes-floor" : "floor-notes-reply"}`,
    attr: {
      "data-record-id": record.id,
      "data-record-kind": record.type
    }
  });
  if (isFloor && record.floorNumber !== null) {
    recordEl.dataset.floorLabel = String(record.floorNumber).padStart(2, "0");
  }

  const contentEl = recordEl.createDiv({ cls: "floor-notes-record-content" });
  const bodyEl = contentEl.createDiv({ cls: "floor-notes-body" });
  await renderMarkdownBody(bodyEl, bodyText, app, path, scope, {
    presentation: "floor-view",
    showImageDescriptions
  });
  if (!isFloor && authorLabel !== undefined) {
    renderReplyAuthorLabel(bodyEl, authorLabel);
  }

  const footerEl = recordEl.createEl("footer", { cls: "floor-notes-record-bottom floor-notes-record-footer" });
  const leftInfo = footerEl.createDiv({ cls: "floor-notes-meta-left" });
  if (isFloor) {
    const floorNumberEl = leftInfo.createSpan({ cls: "floor-notes-floor-number", text: `#${record.floorNumber}` });
    if (record.floorNumber !== null) {
      floorNumberEl.dataset.floorLabel = String(record.floorNumber).padStart(2, "0");
    }
  }
  leftInfo.createEl("time", { cls: "floor-notes-date", text: record.date });

  const rightActions = footerEl.createDiv({ cls: "floor-notes-meta-right" });

  if (isFloor && onToggleFavorite) {
    const favLabel = record.favorite ? t("removeFromFavs") : t("addToFavs");
    const favBtn = createA11yIconButton(
      rightActions,
      "star",
      favLabel,
      onToggleFavorite,
      "floor-notes-icon-btn floor-notes-record-action floor-notes-record-action-favorite floor-notes-fav-btn"
    );
    favBtn.setAttribute("aria-pressed", String(record.favorite));
  }

  if (isFloor) {
    createA11yIconButton(
      rightActions,
      "reply",
      t("addReply"),
      onReply,
      "floor-notes-icon-btn floor-notes-record-action floor-notes-record-action-reply"
    );
  }
  createA11yIconButton(
    rightActions,
    "pencil",
    isFloor ? t("editFloor") : t("editReply"),
    onEdit,
    "floor-notes-icon-btn floor-notes-record-action floor-notes-record-action-edit"
  );
  createA11yIconButton(
    rightActions,
    "trash-2",
    isFloor ? t("deleteFloor") : t("deleteReply"),
    onDelete,
    "floor-notes-icon-btn floor-notes-record-action floor-notes-record-action-delete"
  );

  return recordEl;
}

export function renderErrorList(container: HTMLElement, diagnostics: readonly Diagnostic[]): void {
  const errorEl = container.createDiv({ cls: "floor-notes-error-container" });
  errorEl.createEl("h3", { text: t("errorLoadingThread") });
  const listEl = errorEl.createEl("ul");
  for (const diag of diagnostics) {
    const item = listEl.createEl("li");
    item.createSpan({ cls: "floor-notes-error-code", text: `[${diag.code}] ` });
    item.createSpan({ text: t("diagnosticFormatError").replace("{code}", diag.code) });
    if (diag.line !== undefined) {
      item.createSpan({ cls: "floor-notes-error-loc", text: ` (${t("lineLabel")} ${diag.line}, ${t("colLabel")} ${diag.column})` });
    }
  }
}

export function renderEmptyState(container: HTMLElement): void {
  const emptyEl = container.createDiv({ cls: "floor-notes-empty-container" });
  emptyEl.createEl("p", { text: t("emptyConfigError") });
}
