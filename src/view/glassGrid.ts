import { Component } from "obsidian";

export const GLASS_MASONRY_READY_CLASS = "is-glass-masonry-ready";

export function getGlassGridRowSpan(
  contentHeight: number,
  rowHeight: number,
  cardGap: number
): number {
  if (
    !Number.isFinite(contentHeight) ||
    contentHeight <= 0 ||
    !Number.isFinite(rowHeight) ||
    rowHeight <= 0 ||
    !Number.isFinite(cardGap) ||
    cardGap < 0
  ) {
    return 1;
  }

  return Math.max(1, Math.ceil((contentHeight + cardGap) / rowHeight));
}

export function enableGlassGridLayout(
  recordListEl: HTMLElement,
  scope: Component
): void {
  const ownerWindow = recordListEl.ownerDocument.defaultView;
  if (!ownerWindow || typeof ownerWindow.ResizeObserver !== "function") {
    return;
  }

  let frameId: number | null = null;

  const updateLayout = (): void => {
    frameId = null;
    const computed = ownerWindow.getComputedStyle(recordListEl);
    const rowHeight = Number.parseFloat(
      computed.getPropertyValue("--floor-notes-glass-row-height")
    );
    const cardGap = Number.parseFloat(computed.columnGap) || 0;
    if (!Number.isFinite(rowHeight) || rowHeight <= 0) {
      return;
    }

    const cards = Array.from(recordListEl.children).filter((child): child is HTMLElement =>
      child.instanceOf(ownerWindow.HTMLElement)
    );
    if (cards.length === 0) {
      return;
    }

    for (const card of cards) {
      card.setCssProps({
        "--floor-notes-glass-row-span": String(getGlassGridRowSpan(card.offsetHeight, rowHeight, cardGap))
      });
    }
    recordListEl.classList.add(GLASS_MASONRY_READY_CLASS);
  };

  const scheduleLayout = (): void => {
    if (frameId !== null) {
      ownerWindow.cancelAnimationFrame(frameId);
    }
    frameId = ownerWindow.requestAnimationFrame(updateLayout);
  };

  const observer = new ownerWindow.ResizeObserver(scheduleLayout);
  observer.observe(recordListEl);
  for (const child of Array.from(recordListEl.children)) {
    observer.observe(child);
  }
  updateLayout();

  scope.register(() => {
    observer.disconnect();
    if (frameId !== null) {
      ownerWindow.cancelAnimationFrame(frameId);
    }
  });
}
