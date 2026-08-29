import { Component, Platform, setIcon } from "obsidian";

interface LightboxMedia {
  readonly sourceImage: HTMLImageElement;
  readonly src: string;
  readonly alt: string;
  readonly title: string;
}

export interface OpenImageLightboxOptions {
  readonly selectedImage: HTMLImageElement;
  readonly triggerEl: HTMLElement;
  readonly ownerScope: Component;
  readonly closeLabel: string;
}

function imageTitle(image: HTMLImageElement): string {
  const wrapper = image.closest<HTMLElement>(".floor-notes-resizable-image");
  const target = wrapper?.dataset.imageTarget || image.alt;
  const normalized = target.replaceAll("\\", "/");
  return normalized.substring(normalized.lastIndexOf("/") + 1);
}

function collectMedia(selectedImage: HTMLImageElement): LightboxMedia[] {
  const viewEl = selectedImage.closest<HTMLElement>(".floor-notes-thread-view");
  const queryRoot: ParentNode = viewEl ?? selectedImage.ownerDocument;
  const images = Array.from(queryRoot.querySelectorAll<HTMLImageElement>(
    ".floor-notes-resizable-image .floor-notes-image-wrapper > img"
  ));
  const media = images.map((image) => ({
    sourceImage: image,
    src: image.currentSrc || image.src,
    alt: image.alt,
    title: imageTitle(image)
  }));
  return media.some((item) => item.sourceImage === selectedImage)
    ? media
    : [{
      sourceImage: selectedImage,
      src: selectedImage.currentSrc || selectedImage.src,
      alt: selectedImage.alt,
      title: imageTitle(selectedImage)
    }];
}

export function openImageLightbox(options: OpenImageLightboxOptions): void {
  const media = collectMedia(options.selectedImage);
  let activeIndex = Math.max(0, media.findIndex((item) => item.sourceImage === options.selectedImage));
  const ownerDocument = options.selectedImage.ownerDocument;
  const scope = new Component();
  scope.load();

  const rootEl = ownerDocument.body.createDiv({
    cls: "floor-notes-image-lightbox",
    attr: {
      tabindex: "-1",
      role: "dialog",
      "aria-modal": "true"
    }
  });
  rootEl.createDiv({ cls: "floor-notes-image-lightbox-bg" });
  const contentEl = rootEl.createDiv({ cls: "floor-notes-image-lightbox-content" });
  const mediaEl = contentEl.createDiv({ cls: "floor-notes-image-lightbox-media" });
  contentEl.createDiv({ cls: "floor-notes-image-lightbox-controls" });
  const titlebarEl = rootEl.createDiv({ cls: "floor-notes-image-lightbox-titlebar" });
  const titleEl = titlebarEl.createDiv({ cls: "floor-notes-image-lightbox-titlebar-text" });
  const closeButton = rootEl.createEl("button", {
    cls: "floor-notes-image-lightbox-close",
    attr: {
      type: "button",
      "aria-label": options.closeLabel,
      "data-tooltip-position": "left"
    }
  });
  setIcon(closeButton, "x");

  let activeImage: HTMLImageElement | null = null;
  let zoomLevel = 1;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let pointerId: number | null = null;
  let pointerX = 0;
  let pointerY = 0;
  let isSpaceKeyHeld = false;
  let isClosed = false;
  const openedAt = Date.now();

  const applyTransform = (): void => {
    if (!activeImage) {
      return;
    }
    rootEl.classList.toggle("is-zoomed", zoomLevel > 1);
    activeImage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  };

  const renderActiveMedia = (): void => {
    const item = media[activeIndex]!;
    mediaEl.empty();
    const mediaWrapper = mediaEl.createDiv({ cls: "floor-notes-image-lightbox-media-wrapper" });
    activeImage = mediaWrapper.createEl("img", {
      cls: "floor-notes-image-lightbox-image",
      attr: {
        src: item.src,
        alt: item.alt,
        draggable: "false",
        decoding: "async"
      }
    });
    titleEl.setText(item.title);
    rootEl.setAttribute("aria-label", item.title || options.closeLabel);
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyTransform();
  };

  const close = (restoreFocus = true): void => {
    if (isClosed) {
      return;
    }
    isClosed = true;
    rootEl.remove();
    scope.unload();
    if (restoreFocus && options.triggerEl.isConnected) {
      options.triggerEl.focus();
    }
  };

  const applyZoom = (nextZoom: number, clientX?: number, clientY?: number): void => {
    const previousZoom = zoomLevel;
    const clampedZoom = Math.min(10, Math.max(1, nextZoom));
    if (clampedZoom === previousZoom) {
      return;
    }

    if (clampedZoom === 1) {
      panX = 0;
      panY = 0;
    } else if (clientX !== undefined && clientY !== undefined) {
      const mediaRect = mediaEl.getBoundingClientRect();
      const pointX = clientX - mediaRect.left - mediaRect.width / 2;
      const pointY = clientY - mediaRect.top - mediaRect.height / 2;
      const zoomRatio = clampedZoom / previousZoom;
      panX = pointX - (pointX - panX) * zoomRatio;
      panY = pointY - (pointY - panY) * zoomRatio;
    }

    zoomLevel = clampedZoom;
    applyTransform();
  };

  const changeZoom = (direction: 1 | -1): void => {
    const factor = direction > 0 ? 1.2 : 1 / 1.2;
    const multiplied = Number((zoomLevel * factor).toFixed(2));
    const quantize = direction > 0 ? Math.ceil : Math.floor;
    applyZoom(quantize(multiplied * 10) / 10);
  };

  const navigate = (direction: 1 | -1): void => {
    if (media.length < 2) {
      return;
    }
    activeIndex = (activeIndex + direction + media.length) % media.length;
    renderActiveMedia();
  };

  scope.registerDomEvent(closeButton, "click", () => close());
  scope.registerDomEvent(mediaEl, "click", (event: MouseEvent) => {
    if (event.target !== activeImage) {
      close();
    }
  });
  scope.registerDomEvent(rootEl, "keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "=") {
      event.preventDefault();
      changeZoom(1);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(-1);
    } else if (event.key === " ") {
      event.preventDefault();
      if (!event.repeat) {
        isSpaceKeyHeld = true;
      }
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigate(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigate(-1);
    }
  });
  scope.registerDomEvent(rootEl, "keyup", (event: KeyboardEvent) => {
    if (event.key === " " && isSpaceKeyHeld) {
      isSpaceKeyHeld = false;
      close();
    }
  });
  scope.registerDomEvent(contentEl, "wheel", (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      let zoomDelta = -event.deltaY / 150;
      if (Platform.isMacOS && !Number.isInteger(event.deltaY)) {
        zoomDelta *= 2;
      }
      applyZoom(zoomLevel + zoomDelta, event.clientX, event.clientY);
    } else if (zoomLevel > 1) {
      event.preventDefault();
      panX -= 1.5 * event.deltaX;
      panY -= 1.5 * event.deltaY;
      applyTransform();
    }
  }, { passive: false });
  scope.registerDomEvent(mediaEl, "dblclick", (event: MouseEvent) => {
    if (event.target === activeImage && Date.now() - openedAt >= 300) {
      applyZoom(zoomLevel > 1 ? 1 : 2.5, event.clientX, event.clientY);
    }
  });
  scope.registerDomEvent(mediaEl, "pointerdown", (event: PointerEvent) => {
    if (event.button !== 0 || event.target !== activeImage || zoomLevel <= 1) {
      return;
    }
    event.preventDefault();
    isPanning = true;
    pointerId = event.pointerId;
    pointerX = event.clientX;
    pointerY = event.clientY;
    mediaEl.setPointerCapture?.(event.pointerId);
  });
  scope.registerDomEvent(mediaEl, "pointermove", (event: PointerEvent) => {
    if (!isPanning || pointerId !== event.pointerId) {
      return;
    }
    panX += event.clientX - pointerX;
    panY += event.clientY - pointerY;
    pointerX = event.clientX;
    pointerY = event.clientY;
    applyTransform();
  });
  const endPan = (event: PointerEvent): void => {
    if (!isPanning || pointerId !== event.pointerId) {
      return;
    }
    isPanning = false;
    mediaEl.releasePointerCapture?.(event.pointerId);
    pointerId = null;
  };
  scope.registerDomEvent(mediaEl, "pointerup", endPan);
  scope.registerDomEvent(mediaEl, "pointercancel", endPan);

  options.ownerScope.register(() => close(false));
  renderActiveMedia();
  rootEl.focus({ preventScroll: true });
}
