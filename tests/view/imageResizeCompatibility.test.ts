import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Component, Platform } from "obsidian";
import {
  attachImageResizeControls,
  type ImageResizeControlOptions
} from "../../src/view/imageResizeControl";

const mounted: Array<{ readonly root: HTMLElement; readonly scope: Component }> = [];

function createResizeHarness(ownerDocument: Document = document, rtl = false) {
  const root = ownerDocument.body.createDiv();
  if (rtl) {
    root.classList.add("mod-rtl");
  }
  const contentEl = root.createDiv({ cls: "floor-notes-record-content" });
  const bodyEl = contentEl.createDiv({ cls: "floor-notes-body" });
  const image = bodyEl.createEl("img", { attr: { src: "app://rendered-photo" } });
  const scope = new Component();
  scope.load();
  const commit = vi.fn().mockResolvedValue({ type: "no-op" });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({ width: 200, height: 100 } as DOMRect);
  vi.spyOn(contentEl, "getBoundingClientRect").mockReturnValue({ width: 400 } as DOMRect);

  const options: ImageResizeControlOptions = {
    recordEl: root,
    recordId: "floor-20260716-153012-abcde123",
    bodyText: "![[photo.png]]",
    scope,
    resizeLabel: "Resize image",
    openImageLabel: "Zoom in",
    closeImageLabel: "Close image viewer",
    openSourceLabel: "Edit block",
    isActive: () => true,
    openSource: vi.fn(),
    commit,
    onRejected: vi.fn().mockResolvedValue(undefined)
  };
  attachImageResizeControls(options);
  mounted.push({ root, scope });

  return {
    root,
    scope,
    contentEl,
    image,
    handle: root.querySelector<HTMLButtonElement>(".floor-notes-image-resize-handle")!,
    commit
  };
}

function dispatchPointer(target: EventTarget, type: string, clientX: number): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX
  }));
}

describe("T-080: Existing pointer resize compatibility", () => {
  beforeEach(() => {
    Reflect.set(Platform, "isDesktop", true);
    Reflect.set(Platform, "isMobile", false);
  });

  afterEach(() => {
    for (const item of mounted.splice(0)) {
      item.scope.unload();
      item.root.remove();
    }
  });

  it("increases an RTL image when dragging its inline-end corner outward", async () => {
    const harness = createResizeHarness(document, true);

    dispatchPointer(harness.handle, "pointerdown", 300);
    dispatchPointer(document, "pointermove", 250);

    expect(harness.image.style.width).toBe("250px");
    expect(harness.image.style.height).toBe("125px");

    dispatchPointer(document, "pointerup", 250);
    await vi.waitFor(() => expect(harness.commit).toHaveBeenCalledOnce());
    expect(harness.commit.mock.calls[0]?.[0]).toMatchObject({ desiredWidth: 250 });
  });

  it("listens only to the rendered image owner document in a popout document", async () => {
    const popoutDocument = document.implementation.createHTMLDocument("popout");
    const harness = createResizeHarness(popoutDocument);

    dispatchPointer(harness.handle, "pointerdown", 100);
    dispatchPointer(document, "pointermove", 150);
    expect(harness.image.style.width).toBe("");

    dispatchPointer(popoutDocument, "pointermove", 150);
    expect(harness.image.style.width).toBe("250px");
    dispatchPointer(popoutDocument, "pointerup", 150);

    await vi.waitFor(() => expect(harness.commit).toHaveBeenCalledOnce());
    expect(harness.handle.ownerDocument).toBe(popoutDocument);
  });

  it("removes owner-document pointer listeners when the render scope unloads", () => {
    const popoutDocument = document.implementation.createHTMLDocument("popout");
    const addEventListener = vi.spyOn(popoutDocument, "addEventListener");
    const removeEventListener = vi.spyOn(popoutDocument, "removeEventListener");
    const harness = createResizeHarness(popoutDocument);
    const pointerListenerTypes = ["pointermove", "pointerup"];

    expect(addEventListener.mock.calls
      .filter(([type]) => pointerListenerTypes.includes(type)))
      .toHaveLength(2);

    dispatchPointer(harness.handle, "pointerdown", 100);
    dispatchPointer(popoutDocument, "pointermove", 150);
    expect(harness.image.style.width).toBe("250px");

    harness.scope.unload();
    dispatchPointer(popoutDocument, "pointermove", 200);
    dispatchPointer(popoutDocument, "pointerup", 200);

    expect(harness.image.style.width).toBe("250px");
    expect(harness.commit).not.toHaveBeenCalled();
    expect(removeEventListener.mock.calls
      .filter(([type]) => pointerListenerTypes.includes(type)))
      .toHaveLength(2);
  });
});
