import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { FileIdentityRegistry } from "../../src/services/FileIdentityRegistry";
import {
  FloorViewPosition,
  ViewPositionPersistence,
  VIEW_POSITION_VERSION
} from "../../src/services/ViewPositionStore";
import { DEFAULT_SETTINGS } from "../../src/settings/types";
import { FloorThreadView } from "../../src/view/FloorThreadView";
import { ThreadMutationService } from "../../src/services/ThreadMutationService";

const paginatedRecords = Array.from({ length: 31 }, (_, index) => {
  const floorNumber = index + 1;
  const recordId = `floor-20260716-1530${String(floorNumber).padStart(2, "0")}-${String(floorNumber).padStart(8, "0")}`;
  return `## Floor
[id:: ${recordId}]
[date:: 2026-07-16 15:30:12]

Floor ${floorNumber} body.
`;
}).join("\n");

const paginatedDocument = `---
floor-notes: 1
---
# Thread Title

${paginatedRecords}`;

const firstRecordId = "floor-20260716-153001-00000001";
const lastRecordId = "floor-20260716-153031-00000031";

function makeFile(path = "thread.md"): obsidian.TFile {
  const file = new obsidian.TFile();
  file.path = path;
  file.name = path;
  file.basename = path.replace(/\.md$/, "");
  file.extension = "md";
  return file;
}

function makePosition(anchorRecordId: string, page: number, scrollTop = 0): FloorViewPosition {
  return {
    version: VIEW_POSITION_VERSION,
    page,
    scrollTop,
    anchorOffset: 0,
    updatedAt: 1,
    anchorRecordId,
    floorRecordId: anchorRecordId
  };
}

function createView(
  recentPosition?: FloorViewPosition,
  panePositions?: Map<string, FloorViewPosition>
) {
  const app = {
    vault: {
      read: vi.fn().mockResolvedValue(paginatedDocument),
      process: vi.fn()
    },
    workspace: {
      requestSaveLayout: vi.fn(),
      openLinkText: vi.fn()
    }
  };
  const registry = new FileIdentityRegistry();
  const mutationService = new ThreadMutationService(app as never, registry);
  const setRecent = vi.fn();
  const removeRecent = vi.fn();
  const persistence: ViewPositionPersistence = {
    isEnabled: () => true,
    getRecent: vi.fn(() => recentPosition),
    setRecent,
    removeRecent,
    flush: vi.fn().mockResolvedValue(undefined)
  };
  const view = new FloorThreadView(
    { setViewState: vi.fn() } as never,
    registry,
    mutationService,
    { ...DEFAULT_SETTINGS, restoreLastViewPosition: true },
    persistence,
    panePositions
  );
  view.app = app as never;
  return { app, removeRecent, setRecent, view };
}

function getRenderedRecordIds(view: FloorThreadView): string[] {
  return Array.from(
    view.contentEl.querySelectorAll<HTMLElement>(".floor-notes-record[data-record-id]")
  ).map((element) => element.dataset.recordId ?? "");
}

const openViews: FloorThreadView[] = [];

afterEach(async () => {
  for (const view of openViews.splice(0)) {
    if (view.file) {
      await view.onUnloadFile(view.file);
    }
  }
});

describe("FloorThreadView position restoration", () => {
  it("prefers serialized pane state while a new pane uses the note's recent position", async () => {
    const recent = makePosition(lastRecordId, 2, 240);
    const pane = makePosition(firstRecordId, 1, 40);

    const existing = createView(recent);
    openViews.push(existing.view);
    await existing.view.setState(
      { file: "thread.md", floorNotesPosition: pane },
      {} as never
    );
    await existing.view.onLoadFile(makeFile());

    expect(getRenderedRecordIds(existing.view)).toContain(firstRecordId);
    expect(getRenderedRecordIds(existing.view)).not.toContain(lastRecordId);
    expect(
      existing.view.contentEl.querySelector<HTMLSelectElement>(".floor-notes-page-select")
        ?.selectedIndex
    ).toBe(0);

    const fresh = createView(recent);
    openViews.push(fresh.view);
    await fresh.view.onLoadFile(makeFile());

    expect(getRenderedRecordIds(fresh.view)).toEqual([lastRecordId]);
    expect(
      fresh.view.contentEl.querySelector<HTMLSelectElement>(".floor-notes-page-select")
        ?.selectedIndex
    ).toBe(1);
    const restoredRecord = fresh.view.contentEl.querySelector<HTMLElement>(
      `[data-record-id="${lastRecordId}"]`
    );
    expect(restoredRecord?.hasAttribute("tabindex")).toBe(false);
    expect(restoredRecord?.classList.contains("floor-notes-highlight")).toBe(false);
    expect(fresh.setRecent).not.toHaveBeenCalled();
  });

  it("keeps pane history when the floor view instance is replaced in the same leaf", async () => {
    const sharedPanePositions = new Map<string, FloorViewPosition>();
    const original = createView(undefined, sharedPanePositions);
    openViews.push(original.view);
    const file = makeFile();
    await original.view.onLoadFile(file);
    expect(original.view.getState()).toHaveProperty("floorNotesPosition");
    await original.view.onUnloadFile(file);

    const replacement = createView(
      makePosition(lastRecordId, 2, 240),
      sharedPanePositions
    );
    openViews.push(replacement.view);
    await replacement.view.onLoadFile(makeFile());

    expect(getRenderedRecordIds(replacement.view)).toContain(firstRecordId);
    expect(getRenderedRecordIds(replacement.view)).not.toContain(lastRecordId);
  });

  it("gives an explicit record target priority over pane history", async () => {
    const { setRecent, view } = createView(makePosition(firstRecordId, 1));
    openViews.push(view);
    await view.setState({
      file: "thread.md",
      recordId: lastRecordId,
      floorNotesPosition: makePosition(firstRecordId, 1)
    }, {} as never);
    await view.onLoadFile(makeFile());

    expect(getRenderedRecordIds(view)).toEqual([lastRecordId]);
    expect(
      view.contentEl.querySelector(`[data-record-id="${lastRecordId}"]`)?.getAttribute("tabindex")
    ).toBe("-1");
    expect(setRecent).toHaveBeenCalled();
  });

  it("restores the anchor's viewport offset instead of relying on raw scrollTop", async () => {
    const position: FloorViewPosition = {
      ...makePosition(lastRecordId, 2, 100),
      anchorOffset: 20
    };
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("floor-notes-records-container")) {
          return { top: 0, bottom: 500 } as DOMRect;
        }
        if (this.dataset.recordId === lastRecordId) {
          const scrollTop = this.closest<HTMLElement>(".floor-notes-records-container")
            ?.scrollTop ?? 0;
          return { top: 500 - scrollTop, bottom: 600 - scrollTop } as DOMRect;
        }
        return { top: 600, bottom: 700 } as DOMRect;
      });
    const { view } = createView(position);
    openViews.push(view);
    document.body.append(view.contentEl);

    try {
      await view.onLoadFile(makeFile());
      const records = view.contentEl.querySelector<HTMLElement>(
        ".floor-notes-records-container"
      );
      expect(records?.scrollTop).toBe(480);
    } finally {
      rectSpy.mockRestore();
      view.contentEl.remove();
    }
  });

  it("keeps the semantic anchor while a restored pane has no visible layout", async () => {
    const restored = makePosition(lastRecordId, 2, 240);
    const { view } = createView(restored);
    openViews.push(view);
    document.body.append(view.contentEl);

    try {
      await view.onLoadFile(makeFile());
      const state = view.getState();
      expect((state.floorNotesPosition as FloorViewPosition).anchorRecordId).toBe(lastRecordId);
    } finally {
      view.contentEl.remove();
    }
  });

  it("records trusted browsing intent but not a passive rerender", async () => {
    const { setRecent, view } = createView();
    openViews.push(view);
    const file = makeFile();
    await view.onLoadFile(file);
    const records = view.contentEl.querySelector<HTMLElement>(".floor-notes-records-container")!;

    records.scrollTop = 180;
    records.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    records.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(setRecent).toHaveBeenCalled());
    expect(setRecent.mock.calls.at(-1)?.[1].scrollTop).toBe(180);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 300));

    setRecent.mockClear();
    await view.requestGeneration();
    expect(setRecent).not.toHaveBeenCalled();

    await view.onUnloadFile(file);
    expect(setRecent).not.toHaveBeenCalled();
  });

  it("does not migrate a pane position when the open file is renamed", async () => {
    const { setRecent, view } = createView();
    openViews.push(view);
    const file = makeFile();
    await view.onLoadFile(file);
    const records = view.contentEl.querySelector<HTMLElement>(".floor-notes-records-container")!;
    records.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    records.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(setRecent).toHaveBeenCalled());

    file.path = "renamed.md";
    file.name = "renamed.md";
    file.basename = "renamed";
    view.handleFileRename(file, "thread.md");

    expect(view.getState()).toEqual({ file: "renamed.md" });
    await view.requestGeneration();

    setRecent.mockClear();
    const renamedRecords = view.contentEl.querySelector<HTMLElement>(
      ".floor-notes-records-container"
    )!;
    renamedRecords.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    renamedRecords.dispatchEvent(new Event("scroll"));
    await vi.waitFor(() => expect(setRecent).toHaveBeenCalled());
    expect(setRecent.mock.calls.at(-1)?.[0]).toBe("renamed.md");
    expect(view.getState()).toHaveProperty("floorNotesPosition");
  });

  it("does not reuse the previous file's visible DOM while switching files", async () => {
    const { app, view } = createView();
    openViews.push(view);
    const firstFile = makeFile("first.md");
    const secondFile = makeFile("second.md");
    const secondDocument = paginatedDocument.replaceAll("20260716", "20260717");
    let resolveSecondRead: ((value: string) => void) | undefined;
    vi.mocked(app.vault.read)
      .mockResolvedValueOnce(paginatedDocument)
      .mockResolvedValueOnce(paginatedDocument)
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveSecondRead = resolve;
      }));

    await view.onLoadFile(firstFile);
    await view.requestGeneration(lastRecordId);
    await view.onUnloadFile(firstFile);
    const secondLoad = view.onLoadFile(secondFile);
    await vi.waitFor(() => expect(resolveSecondRead).toBeTypeOf("function"));
    expect(view.getState()).toEqual({ file: "second.md" });
    resolveSecondRead?.(secondDocument);
    await secondLoad;

    expect(getRenderedRecordIds(view)).toHaveLength(30);
    expect(getRenderedRecordIds(view)).not.toContain(
      "floor-20260717-153031-00000031"
    );
    expect(
      view.contentEl.querySelector<HTMLSelectElement>(".floor-notes-page-select")
        ?.selectedIndex
    ).toBe(0);
  });

  it("drops stale recent state instead of giving a reused path an old position", async () => {
    const stalePosition = makePosition("floor-20260101-000000-deadbeef", 2, 400);
    const { removeRecent, view } = createView(stalePosition);
    openViews.push(view);

    await view.onLoadFile(makeFile());

    expect(removeRecent).toHaveBeenCalledWith("thread.md", stalePosition);
    expect(getRenderedRecordIds(view)).toContain(firstRecordId);
    expect(getRenderedRecordIds(view)).not.toContain(lastRecordId);
  });

  it("does not create load-more state when restoring to one of four replies", async () => {
    const floorId = "floor-20260716-120000-00000001";
    const replyIds = Array.from({ length: 4 }, (_, index) =>
      `reply-20260716-130000-${String(10_000_001 + index)}`
    );
    const replies = replyIds.map((replyId, index) => `### Reply
[id:: ${replyId}]
[date:: 2026-07-16 13:00:00]

Reply ${index + 1}.`).join("\n\n");
    const source = `---
floor-notes: 1
---
## Floor
[id:: ${floorId}]
[date:: 2026-07-16 12:00:00]

Floor body.

${replies}
`;
    const recent: FloorViewPosition = {
      ...makePosition(replyIds[1]!, 1),
      floorRecordId: floorId
    };
    const { app, view } = createView(recent);
    openViews.push(view);
    vi.mocked(app.vault.read).mockResolvedValue(source);

    await view.onLoadFile(makeFile());

    expect(view.contentEl.querySelectorAll(".floor-notes-reply")).toHaveLength(4);
    expect(view.contentEl.querySelector(".floor-notes-load-more-replies")).toBeNull();
  });

  it("expands only as many replies as needed to restore a deep reply anchor", async () => {
    const floorId = "floor-20260716-120000-00000001";
    const replyIds = Array.from({ length: 51 }, (_, index) =>
      `reply-20260716-130000-${String(10_000_001 + index)}`
    );
    const replies = replyIds.map((replyId, index) => `### Reply
[id:: ${replyId}]
[date:: 2026-07-16 13:00:00]

Reply ${index + 1}.`).join("\n\n");
    const source = `---
floor-notes: 1
---
## Floor
[id:: ${floorId}]
[date:: 2026-07-16 12:00:00]

Floor body.

${replies}
`;
    const deepReplyId = replyIds.at(-1)!;
    const recent: FloorViewPosition = {
      ...makePosition(deepReplyId, 1),
      floorRecordId: floorId
    };
    const { app, view } = createView(recent);
    openViews.push(view);
    vi.mocked(app.vault.read).mockResolvedValue(source);

    await view.onLoadFile(makeFile());

    expect(view.contentEl.querySelector(`[data-record-id="${deepReplyId}"]`)).not.toBeNull();
    expect(view.contentEl.querySelectorAll(".floor-notes-reply")).toHaveLength(51);
    expect(view.contentEl.querySelector(".floor-notes-load-more-replies")).toBeNull();
  });

  it("keeps explicit load-more expansions when position tracking is enabled", async () => {
    const floorId = "floor-20260716-120000-00000001";
    const replyIds = Array.from({ length: 120 }, (_, index) =>
      `reply-20260716-130000-${String(10_000_001 + index)}`
    );
    const replies = replyIds.map((replyId, index) => `### Reply
[id:: ${replyId}]
[date:: 2026-07-16 13:00:00]

Reply ${index + 1}.`).join("\n\n");
    const source = `---
floor-notes: 1
---
## Floor
[id:: ${floorId}]
[date:: 2026-07-16 12:00:00]

Floor body.

${replies}
`;
    const { app, view } = createView();
    openViews.push(view);
    vi.mocked(app.vault.read).mockResolvedValue(source);
    document.body.append(view.contentEl);

    try {
      await view.onLoadFile(makeFile());
      const records = view.contentEl.querySelector<HTMLElement>(
        ".floor-notes-records-container"
      )!;
      vi.spyOn(records, "getBoundingClientRect").mockReturnValue({
        top: 0,
        bottom: 500
      } as DOMRect);
      const renderedRecords = Array.from(
        records.querySelectorAll<HTMLElement>(".floor-notes-record[data-record-id]")
      );
      renderedRecords.forEach((record) => {
        vi.spyOn(record, "getBoundingClientRect").mockReturnValue(
          record.dataset.recordId === replyIds[24]
            ? { top: -10, bottom: 100 } as DOMRect
            : { top: 600, bottom: 700 } as DOMRect
        );
      });
      expect(view.contentEl.querySelectorAll(".floor-notes-reply")).toHaveLength(50);

      const requestGeneration = vi.spyOn(view, "requestGeneration");
      view.contentEl.querySelector<HTMLButtonElement>(
        ".floor-notes-load-more-replies"
      )?.click();
      expect(requestGeneration).toHaveBeenCalledOnce();
      await requestGeneration.mock.results[0]!.value;

      expect(view.contentEl.querySelectorAll(".floor-notes-reply")).toHaveLength(100);
      const secondLoadMore = view.contentEl.querySelector<HTMLButtonElement>(
        ".floor-notes-load-more-replies"
      );
      expect(secondLoadMore).not.toBeNull();

      secondLoadMore?.click();
      expect(requestGeneration).toHaveBeenCalledTimes(2);
      await requestGeneration.mock.results[1]!.value;

      expect(view.contentEl.querySelectorAll(".floor-notes-reply")).toHaveLength(120);
      expect(view.contentEl.querySelector(".floor-notes-load-more-replies")).toBeNull();
    } finally {
      view.contentEl.remove();
    }
  });

  it("captures an adjacent anchor across a pagination boundary", async () => {
    const { view } = createView();
    openViews.push(view);
    await view.onLoadFile(makeFile());
    const records = view.contentEl.querySelector<HTMLElement>(".floor-notes-records-container")!;
    vi.spyOn(records, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 500
    } as DOMRect);
    const renderedRecords = Array.from(
      records.querySelectorAll<HTMLElement>(".floor-notes-record[data-record-id]")
    );
    renderedRecords.forEach((record, index) => {
      vi.spyOn(record, "getBoundingClientRect").mockReturnValue(index === 29
        ? { top: -10, bottom: 100 } as DOMRect
        : { top: 600, bottom: 700 } as DOMRect);
    });

    const state = view.getState();
    const position = state.floorNotesPosition as FloorViewPosition;
    expect(position.anchorRecordId).toBe("floor-20260716-153030-00000030");
    expect(position.nextRecordId).toBe(lastRecordId);
  });

  it("keeps a pending restore when a newer render supersedes the initial file read", async () => {
    const { app, view } = createView(makePosition(lastRecordId, 2, 240));
    openViews.push(view);
    let resolveInitialRead: ((value: string) => void) | undefined;
    vi.mocked(app.vault.read)
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveInitialRead = resolve;
      }))
      .mockResolvedValueOnce(paginatedDocument);

    const initialLoad = view.onLoadFile(makeFile());
    await vi.waitFor(() => expect(resolveInitialRead).toBeTypeOf("function"));
    await view.requestGeneration();
    resolveInitialRead?.(paginatedDocument);
    await initialLoad;

    expect(getRenderedRecordIds(view)).toEqual([lastRecordId]);
  });
});
