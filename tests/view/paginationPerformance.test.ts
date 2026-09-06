import { afterEach, describe, expect, it, vi } from "vitest";
import * as obsidian from "obsidian";
import { FileIdentityRegistry } from "../../src/services/FileIdentityRegistry";
import { ViewPositionPersistence } from "../../src/services/ViewPositionStore";
import { DEFAULT_SETTINGS } from "../../src/settings/types";
import { ThreadMutationService } from "../../src/services/ThreadMutationService";
import { FloorThreadView } from "../../src/view/FloorThreadView";

function makeFloor(floorNumber: number, replyCount: number): string {
  const floorId = `floor-20260906-120000-${String(floorNumber).padStart(8, "0")}`;
  const replies = Array.from({ length: replyCount }, (_, index) => `### Reply
[id:: reply-20260906-130000-${String(floorNumber * 1000 + index).padStart(8, "0")}]
[date:: 2026-09-06 13:00:00]

Reply ${index + 1}.`).join("\n\n");
  return `## Floor
[id:: ${floorId}]
[date:: 2026-09-06 12:00:00]

Floor ${floorNumber}.
${replies ? `\n${replies}` : ""}`;
}

const performanceDocument = `---
floor-notes: 1
---
${Array.from({ length: 60 }, (_, index) =>
  makeFloor(index + 1, index === 30 ? 45 : 0)
).join("\n\n")}
`;

function makeFile(): obsidian.TFile {
  const file = new obsidian.TFile();
  file.path = "performance.md";
  file.name = "performance.md";
  file.basename = "performance";
  file.extension = "md";
  return file;
}

function createPerformanceView(
  restoreLastViewPosition: boolean,
  source = performanceDocument
): { app: { vault: { read: ReturnType<typeof vi.fn> } }; view: FloorThreadView } {
  const app = {
    vault: {
      read: vi.fn().mockResolvedValue(source),
      process: vi.fn()
    },
    workspace: {
      requestSaveLayout: vi.fn(),
      openLinkText: vi.fn()
    }
  };
  const registry = new FileIdentityRegistry();
  const mutationService = new ThreadMutationService(app as never, registry);
  const persistence: ViewPositionPersistence = {
    isEnabled: () => restoreLastViewPosition,
    getRecent: vi.fn(),
    setRecent: vi.fn(),
    removeRecent: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined)
  };
  const view = new FloorThreadView(
    { setViewState: vi.fn() } as never,
    registry,
    mutationService,
    { ...DEFAULT_SETTINGS, restoreLastViewPosition },
    persistence
  );
  view.app = app as never;
  document.body.append(view.contentEl);
  return { app, view };
}

function spyOnLayoutReads() {
  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("floor-notes-records-container")
        ? { top: 0, bottom: 600, height: 600 } as DOMRect
        : { top: 0, bottom: 100, height: 100 } as DOMRect;
    });
}

describe("floor pagination performance", () => {
  const openViews: FloorThreadView[] = [];

  afterEach(async () => {
    for (const view of openViews.splice(0)) {
      if (view.file) {
        await view.onUnloadFile(view.file);
      }
      view.contentEl.remove();
    }
    vi.restoreAllMocks();
  });

  it("does not scan every rendered record's layout when moving to a page top", async () => {
    const { view } = createPerformanceView(true);
    openViews.push(view);
    const layoutSpy = spyOnLayoutReads();
    const markdownRender = vi.spyOn(obsidian.MarkdownRenderer, "render");

    await view.onLoadFile(makeFile());
    layoutSpy.mockClear();
    markdownRender.mockClear();
    const requestGeneration = vi.spyOn(view, "requestGeneration");
    const startedAt = performance.now();

    view.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-pagination-btn")[1]?.click();
    expect(requestGeneration).toHaveBeenCalledOnce();
    await requestGeneration.mock.results[0]!.value;

    const elapsedMs = performance.now() - startedAt;
    const renderedRecords = view.contentEl.querySelectorAll(".floor-notes-record").length;
    const markdownRenderCount = markdownRender.mock.calls.length;
    expect(renderedRecords).toBe(75);
    expect(markdownRenderCount).toBe(75);
    expect(
      layoutSpy.mock.calls.length,
      `page turn took ${elapsedMs.toFixed(1)} ms and performed ${layoutSpy.mock.calls.length} layout reads`
    ).toBeLessThanOrEqual(4);
  });

  it("performs no position-related layout reads when restoration is disabled", async () => {
    const { view } = createPerformanceView(false);
    openViews.push(view);
    const layoutSpy = spyOnLayoutReads();
    const markdownRender = vi.spyOn(obsidian.MarkdownRenderer, "render");
    await view.onLoadFile(makeFile());
    layoutSpy.mockClear();
    markdownRender.mockClear();
    const requestGeneration = vi.spyOn(view, "requestGeneration");

    view.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-pagination-btn")[1]?.click();
    await requestGeneration.mock.results[0]!.value;

    expect(view.contentEl.querySelectorAll(".floor-notes-record")).toHaveLength(75);
    expect(markdownRender).toHaveBeenCalledTimes(75);
    expect(layoutSpy).not.toHaveBeenCalled();
  });

  it("does not expose page 14 records while the final page is loading", async () => {
    const longDocument = `---
floor-notes: 1
---
${Array.from({ length: 442 }, (_, index) => makeFloor(index + 1, 0)).join("\n\n")}
`;
    const { app, view } = createPerformanceView(true, longDocument);
    openViews.push(view);
    await view.onLoadFile(makeFile());
    (view as unknown as { currentPage: number }).currentPage = 14;
    await view.requestGeneration(undefined, true, true);
    const records = view.contentEl.querySelector<HTMLElement>(
      ".floor-notes-records-container"
    )!;
    const previousList = records.querySelector<HTMLElement>(".floor-notes-record-list");
    expect(records.querySelector('[data-floor-label="408"]')).not.toBeNull();

    let resolveFinalPage: ((value: string) => void) | undefined;
    vi.mocked(app.vault.read).mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveFinalPage = resolve;
    }));
    const requestGeneration = vi.spyOn(view, "requestGeneration");
    view.contentEl.querySelectorAll<HTMLButtonElement>(".floor-notes-pagination-btn")[1]?.click();
    await vi.waitFor(() => expect(resolveFinalPage).toBeTypeOf("function"));

    expect(previousList?.isConnected).toBe(false);
    expect(records.querySelector('[data-floor-label="408"]')).toBeNull();
    const loading = records.querySelector<HTMLElement>(".floor-notes-page-loading");
    expect(loading?.getAttribute("role")).toBe("status");

    resolveFinalPage?.(longDocument);
    await requestGeneration.mock.results[0]!.value;
    const finalRecords = view.contentEl.querySelector<HTMLElement>(
      ".floor-notes-records-container"
    )!;
    expect(finalRecords).not.toBe(records);
    expect(records.isConnected).toBe(false);
    const floorLabels = Array.from(
      finalRecords.querySelectorAll<HTMLElement>(".floor-notes-floor[data-floor-label]")
    ).map((element) => element.dataset.floorLabel);
    expect(floorLabels).toEqual(
      Array.from({ length: 22 }, (_, index) => String(421 + index).padStart(2, "0"))
    );
    expect(floorLabels).toContain("440");
    expect(floorLabels).not.toContain("408");
    expect(finalRecords.querySelector(".floor-notes-page-loading")).toBeNull();
  });
});
