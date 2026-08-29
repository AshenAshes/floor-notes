import { Component, Platform, setIcon } from "obsidian";
import type { OperationResult } from "../format/operations";
import {
  resolveImageResizeOccurrences,
  type ResizableImageOccurrence,
  type SetImageSizeIntent
} from "../format/imageSizing";
import { openImageLightbox } from "./ImageLightbox";

export interface ImageResizeControlOptions {
  readonly recordEl: HTMLElement;
  readonly recordId: string;
  readonly bodyText: string;
  readonly scope: Component;
  readonly resizeLabel: string;
  readonly openImageLabel: string;
  readonly closeImageLabel: string;
  readonly openSourceLabel: string;
  readonly isActive: () => boolean;
  readonly openSource: (selection: { readonly anchor: number; readonly head: number }) => void;
  readonly commit: (intent: SetImageSizeIntent) => Promise<OperationResult>;
  readonly onRejected: (kind: "conflict" | "failure") => Promise<void>;
}

function restoreImageSize(image: HTMLImageElement, width: string, height: string): void {
  image.style.width = width;
  image.style.height = height;
}

function getResizeDirection(element: HTMLElement): 1 | -1 {
  if (element.closest(".mod-rtl, .is-rtl") || element.ownerDocument.documentElement.dir === "rtl") {
    return -1;
  }
  const ownerWindow = element.ownerDocument.defaultView;
  return ownerWindow?.getComputedStyle(element).direction === "rtl" ? -1 : 1;
}

export function attachImageResizeControls(options: ImageResizeControlOptions): void {
  if (!Platform.isDesktop) {
    return;
  }

  const bodyEl = options.recordEl.querySelector<HTMLElement>(".floor-notes-body");
  const images = bodyEl ? Array.from(bodyEl.querySelectorAll<HTMLImageElement>("img")) : [];
  const occurrences = resolveImageResizeOccurrences(options.bodyText, images.length);
  if (!bodyEl || !occurrences || occurrences.length === 0) {
    return;
  }

  for (let imageIndex = 0; imageIndex < images.length; imageIndex++) {
    attachImageResizeControl(options, images[imageIndex]!, occurrences[imageIndex]!);
  }
}

function attachImageResizeControl(
  options: ImageResizeControlOptions,
  image: HTMLImageElement,
  occurrence: ResizableImageOccurrence
): void {
  const parent = image.parentElement;
  if (!parent) {
    return;
  }

  const wrapper = parent.createDiv({
    cls: "floor-notes-resizable-image"
  });
  wrapper.dataset.imageTarget = occurrence.target;
  parent.insertBefore(wrapper, image);
  const imageWrapper = wrapper.createDiv({ cls: "floor-notes-image-wrapper" });
  imageWrapper.appendChild(image);
  const handle = imageWrapper.createEl("button", {
    cls: "floor-notes-image-resize-handle",
    attr: {
      type: "button",
      "aria-label": options.resizeLabel,
      "data-tooltip-position": "top"
    }
  });
  const actions = wrapper.createDiv({ cls: "floor-notes-image-actions" });
  const openImageButton = actions.createEl("button", {
    cls: "floor-notes-image-action floor-notes-image-action-open",
    attr: {
      type: "button",
      "aria-label": options.openImageLabel,
      "data-tooltip-position": "top"
    }
  });
  setIcon(openImageButton, "zoom-in");
  const openSourceButton = actions.createEl("button", {
    cls: "floor-notes-image-action floor-notes-image-action-source",
    attr: {
      type: "button",
      "aria-label": options.openSourceLabel,
      "data-tooltip-position": "top"
    }
  });
  setIcon(openSourceButton, "code-2");

  options.scope.registerDomEvent(openImageButton, "click", (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (options.isActive()) {
      openImageLightbox({
        selectedImage: image,
        triggerEl: openImageButton,
        ownerScope: options.scope,
        closeLabel: options.closeImageLabel
      });
    }
  });

  options.scope.registerDomEvent(openSourceButton, "click", (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (options.isActive()) {
      options.openSource({
        anchor: occurrence.targetSpan.start,
        head: occurrence.targetSpan.end
      });
    }
  });

  options.scope.registerDomEvent(handle, "click", (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  });

  options.scope.registerDomEvent(handle, "dblclick", (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!options.isActive()) {
      return;
    }
    void (async () => {
      let result: OperationResult;
      try {
        result = await options.commit({
          recordId: options.recordId,
          expectedBody: options.bodyText,
          occurrence,
          desiredWidth: null
        });
      } catch {
        if (options.isActive()) {
          await options.onRejected("failure");
        }
        return;
      }
      if (!options.isActive()) {
        return;
      }
      if (result.type === "conflict") {
        await options.onRejected("conflict");
      } else if (result.type !== "applied" && result.type !== "no-op") {
        await options.onRejected("failure");
      }
    })();
  });

  let isDragging = false;
  let pointerId: number | undefined;
  let startClientX = 0;
  let startWidth = 0;
  let aspectRatio = 1;
  let previewWidth = 0;
  let maximumWidth = 0;
  let resizeDirection: 1 | -1 = 1;
  let originalInlineWidth = "";
  let originalInlineHeight = "";

  options.scope.registerDomEvent(handle, "pointerdown", (event: PointerEvent) => {
    if (event.button !== 0 || !options.isActive()) {
      return;
    }

    const imageRect = image.getBoundingClientRect();
    const contentRect = options.recordEl.querySelector<HTMLElement>(".floor-notes-record-content")
      ?.getBoundingClientRect();
    if (imageRect.width <= 0 || imageRect.height <= 0 || !contentRect || contentRect.width <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    isDragging = true;
    pointerId = event.pointerId;
    startClientX = event.clientX;
    startWidth = imageRect.width;
    aspectRatio = imageRect.width / imageRect.height;
    previewWidth = Math.round(imageRect.width);
    maximumWidth = Math.max(20, Math.round(contentRect.width));
    resizeDirection = getResizeDirection(wrapper);
    originalInlineWidth = image.style.width;
    originalInlineHeight = image.style.height;
    wrapper.classList.add("is-resizing");
  });

  options.scope.registerDomEvent(image.ownerDocument, "pointermove", (event: PointerEvent) => {
    if (!isDragging || (pointerId !== undefined && event.pointerId !== pointerId)) {
      return;
    }

    event.preventDefault();
    previewWidth = Math.min(maximumWidth, Math.max(20, Math.round(
      startWidth + (event.clientX - startClientX) * resizeDirection
    )));
    image.style.width = `${previewWidth}px`;
    image.style.height = `${Math.round(previewWidth / aspectRatio)}px`;
  });

  options.scope.registerDomEvent(image.ownerDocument, "pointerup", (event: PointerEvent) => {
    if (!isDragging || (pointerId !== undefined && event.pointerId !== pointerId)) {
      return;
    }

    isDragging = false;
    pointerId = undefined;
    wrapper.classList.remove("is-resizing");
    const desiredWidth = previewWidth;
    if (desiredWidth === Math.round(startWidth)) {
      restoreImageSize(image, originalInlineWidth, originalInlineHeight);
      return;
    }

    void (async () => {
      if (!options.isActive()) {
        return;
      }

      let result: OperationResult;
      try {
        result = await options.commit({
          recordId: options.recordId,
          expectedBody: options.bodyText,
          occurrence,
          desiredWidth
        });
      } catch {
        if (!options.isActive()) {
          return;
        }
        restoreImageSize(image, originalInlineWidth, originalInlineHeight);
        await options.onRejected("failure");
        return;
      }

      if (!options.isActive()) {
        return;
      }
      if (result.type === "conflict") {
        restoreImageSize(image, originalInlineWidth, originalInlineHeight);
        await options.onRejected("conflict");
      } else if (result.type !== "applied" && result.type !== "no-op") {
        restoreImageSize(image, originalInlineWidth, originalInlineHeight);
        await options.onRejected("failure");
      }
    })();
  });
}
