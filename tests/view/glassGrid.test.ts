import { describe, expect, it, vi } from "vitest";
import { Component } from "obsidian";
import {
  enableGlassGridLayout,
  GLASS_MASONRY_READY_CLASS,
  getGlassGridRowSpan
} from "../../src/view/glassGrid";

describe("Glass grid row spans", () => {
  it("includes the fixed card gap in a one-pixel masonry span", () => {
    expect(getGlassGridRowSpan(80, 1, 24)).toBe(104);
    expect(getGlassGridRowSpan(272, 1, 24)).toBe(296);
  });

  it("safely falls back to a single row for unavailable measurements", () => {
    expect(getGlassGridRowSpan(0, 8, 24)).toBe(1);
    expect(getGlassGridRowSpan(120, 0, 24)).toBe(1);
  });

  it("keeps established masonry layout while its render scope unloads", () => {
    const recordList = document.createElement("div");
    const card = recordList.createDiv();
    const setCssProps = vi.fn();
    card.setCssProps = setCssProps;
    Object.defineProperty(card, "offsetHeight", { configurable: true, value: 80 });
    const scope = new Component();
    const ownerWindow = recordList.ownerDocument.defaultView as Window & {
      ResizeObserver?: unknown;
    };
    const previousResizeObserver = ownerWindow.ResizeObserver;
    const getComputedStyle = vi.spyOn(ownerWindow, "getComputedStyle").mockReturnValue({
      columnGap: "0",
      getPropertyValue: () => "1"
    } as unknown as CSSStyleDeclaration);
    const disconnect = vi.fn();

    class ResizeObserverMock {
      public constructor(_callback: ResizeObserverCallback) {}

      public disconnect = disconnect;

      public observe(): void {}
    }

    Object.defineProperty(ownerWindow, "ResizeObserver", {
      configurable: true,
      value: ResizeObserverMock
    });

    enableGlassGridLayout(recordList, scope);

    expect(recordList.classList.contains(GLASS_MASONRY_READY_CLASS)).toBe(true);
    expect(setCssProps).toHaveBeenCalledWith({ "--floor-notes-glass-row-span": "80" });

    scope.unload();

    expect(disconnect).toHaveBeenCalledOnce();
    expect(recordList.classList.contains(GLASS_MASONRY_READY_CLASS)).toBe(true);
    expect(setCssProps).toHaveBeenCalledOnce();

    Object.defineProperty(ownerWindow, "ResizeObserver", {
      configurable: true,
      value: previousResizeObserver
    });
    getComputedStyle.mockRestore();
  });

  it("keeps the natural CSS grid when ResizeObserver is unavailable", () => {
    const recordList = document.createElement("div");
    const card = recordList.createDiv();
    const scope = new Component();
    const ownerWindow = recordList.ownerDocument.defaultView as Window & {
      ResizeObserver?: unknown;
    };
    const previousResizeObserver = ownerWindow.ResizeObserver;
    Object.defineProperty(ownerWindow, "ResizeObserver", {
      configurable: true,
      value: undefined
    });

    enableGlassGridLayout(recordList, scope);

    expect(recordList.classList.contains(GLASS_MASONRY_READY_CLASS)).toBe(false);
    expect(card.style.gridRowEnd).toBe("");

    Object.defineProperty(ownerWindow, "ResizeObserver", {
      configurable: true,
      value: previousResizeObserver
    });
  });
});
