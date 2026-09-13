import { type App, type HeadingCache, type Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { parseThreadDocument } from "../format/parser";
import { FloorThreadView } from "./FloorThreadView";
import { buildOutlineSummaries, type OutlineRecordSummary } from "./outlineSummary";

interface OutlineItem {
  heading: HeadingCache;
  headingText: string;
  innerEl: HTMLElement;
  onSelfClick: (event: MouseEvent) => void;
}

/** Private core-plugin boundary, verified against Obsidian 1.13.7. */
interface NativeOutline {
  file: TFile | null;
  cachedHeadingDom: OutlineItem[];
  prevQuery: string;
  filterSearchResults: () => void;
}

function asOutline(value: unknown): NativeOutline | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NativeOutline>;
  return Array.isArray(candidate.cachedHeadingDom)
    && typeof candidate.filterSearchResults === "function"
    && typeof candidate.prevQuery === "string"
    ? candidate as NativeOutline : null;
}

function isOutlineItem(value: unknown): value is OutlineItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<OutlineItem>;
  return typeof item.headingText === "string"
    && typeof item.heading?.position?.start?.line === "number"
    && typeof item.innerEl?.setText === "function"
    && typeof item.onSelfClick === "function";
}

/** Keep native nodes, headings, hierarchy and collapse state; decorate only the search/render boundary. */
export function enhanceOutline(
  outline: NativeOutline,
  summaries: () => ReadonlyMap<number, OutlineRecordSummary> | null,
  navigate: (id: string | null) => void
): () => void {
  const originalFilter = outline.filterSearchResults;
  const originals = new Map<OutlineItem, { text: string; click: OutlineItem["onSelfClick"]; wrapped: OutlineItem["onSelfClick"] }>();
  const restoreItem = (item: OutlineItem): void => {
    const saved = originals.get(item);
    if (!saved) return;
    item.headingText = saved.text;
    item.innerEl.setText(saved.text);
    item.innerEl.classList.remove("floor-notes-outline-summary");
    if (item.onSelfClick === saved.wrapped) item.onSelfClick = saved.click;
    originals.delete(item);
  };
  const filter = (): void => {
    const entries = summaries();
    const items = outline.cachedHeadingDom.filter(isOutlineItem);
    const live = new Set(items);
    for (const item of originals.keys()) if (!live.has(item)) restoreItem(item);
    const replaced: Array<[OutlineItem, HeadingCache]> = [];
    for (const item of items) {
      const summary = entries?.get(item.heading.position.start.line);
      if (!summary && !(entries && item.heading.level === 1)) {
        restoreItem(item);
        continue;
      }
      if (!originals.has(item)) {
        const click = item.onSelfClick;
        const wrapped = (event: MouseEvent): void => {
          const currentEntries = summaries();
          if (currentEntries && item.heading.level === 1) {
            event.preventDefault();
            navigate(null);
            return;
          }
          const target = currentEntries?.get(item.heading.position.start.line);
          if (!target) return click.call(item, event);
          event.preventDefault();
          navigate(target.id);
        };
        originals.set(item, { text: item.headingText, click, wrapped });
        item.onSelfClick = wrapped;
      }
      if (!summary) continue;
      item.headingText = summary.text;
      item.innerEl.setText(summary.text);
      item.innerEl.classList.add("floor-notes-outline-summary");
      replaced.push([item, item.heading]);
      // The native search matcher reads heading.heading. A private copy is visible
      // only during its synchronous filter call; shared metadata is never mutated.
      item.heading = { ...item.heading, heading: summary.text };
    }
    outline.prevQuery = "\u0000floor-notes-refresh";
    try {
      originalFilter.call(outline);
    } finally {
      for (const [item, heading] of replaced) item.heading = heading;
    }
  };
  outline.filterSearchResults = filter;
  filter();
  return () => {
    for (const item of originals.keys()) restoreItem(item);
    if (outline.filterSearchResults === filter) outline.filterSearchResults = originalFilter;
    outline.prevQuery = "\u0000floor-notes-refresh";
    originalFilter.call(outline);
  };
}

export function installNativeOutlineEnhancement(app: App, plugin: Plugin): void {
  let owner: WorkspaceLeaf | null = null;
  let revision = 0;
  let stopped = false;
  let currentFile: TFile | null = null;
  let summaries: ReadonlyMap<number, OutlineRecordSummary> | null = null;
  const adapters = new Map<NativeOutline, () => void>();

  const sync = (): void => {
    const live = new Set<NativeOutline>();
    for (const leaf of app.workspace.getLeavesOfType("outline")) {
      const outline = asOutline(leaf.view);
      if (!outline) continue;
      live.add(outline);
      if (!adapters.has(outline)) {
        adapters.set(outline, enhanceOutline(outline, () =>
          owner?.view instanceof FloorThreadView && owner.view.file === currentFile
            && outline.file === currentFile
            ? summaries : null,
        (id) => {
          const targetLeaf = owner;
          const view = targetLeaf?.view;
          if (targetLeaf && view instanceof FloorThreadView && view.file === outline.file) {
            app.workspace.setActiveLeaf(targetLeaf, { focus: true });
            if (id === null) void view.navigateToStart();
            else void view.requestGeneration(id);
          }
        }));
      } else outline.filterSearchResults();
    }
    for (const [outline, dispose] of adapters) {
      if (!live.has(outline)) {
        dispose();
        adapters.delete(outline);
      }
    }
  };
  const refresh = async (): Promise<void> => {
    const request = ++revision;
    const view = owner?.view;
    const file = view instanceof FloorThreadView ? view.file : null;
    if (!file) {
      currentFile = null;
      summaries = null;
      sync();
      return;
    }
    try {
      const content = await app.vault.cachedRead(file);
      if (stopped || request !== revision) return;
      const result = parseThreadDocument(content, file.name);
      currentFile = file;
      summaries = result.ok ? buildOutlineSummaries(result.doc) : null;
    } catch {
      if (stopped || request !== revision) return;
      currentFile = null;
      summaries = null;
    }
    sync();
  };
  const selectOwner = (leaf: WorkspaceLeaf | null): void => {
    if (leaf?.view.getViewType() === "outline") return;
    owner = leaf;
    void refresh();
  };
  plugin.registerEvent(app.workspace.on("active-leaf-change", selectOwner));
  plugin.registerEvent(app.workspace.on("layout-change", () => { void refresh(); }));
  plugin.registerEvent(app.metadataCache.on("changed", (file) => {
    if (file === currentFile || (owner?.view instanceof FloorThreadView && owner.view.file === file)) {
      void refresh();
    }
  }));
  app.workspace.onLayoutReady(() => {
    if (stopped) return;
    const view = app.workspace.getActiveViewOfType(FloorThreadView);
    owner = view?.leaf ?? null;
    void refresh();
  });
  plugin.register(() => {
    stopped = true;
    revision++;
    for (const dispose of adapters.values()) dispose();
    adapters.clear();
  });
}
