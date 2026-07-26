import { App, TFile, Plugin, EventRef } from "obsidian";
import { parseThreadDocument } from "../format/parser";

export interface FavoriteEntry {
  path: string;
  recordId: string;
  title: string;
  snippet: string;
  isStale: boolean;
  type: "floor" | "reply";
}

interface PathInfo {
  pathInfoPlaceholder?: boolean; // placeholder or dummy
  generation: number;
  state: "active" | "tombstoned";
  entries: FavoriteEntry[];
}

export class FavoritesIndex {
  private static readonly MAX_CONCURRENT_PROCESSES = 4;
  private paths = new Map<string, PathInfo>();
  private listeners = new Set<() => void>();
  private pending = new Map<string, TFile>();
  private processing = new Set<string>();
  private activeWorkers = 0;

  constructor(
    private readonly app: App,
    private readonly plugin?: Plugin
  ) {}

  public init(): void {
    const register = (eventRef: EventRef) => {
      if (this.plugin) {
        this.plugin.registerEvent(eventRef);
      }
    };

    // Index only files that Obsidian presents to the plugin. There is no initial
    // vault-wide scan, so enabling the plugin never exposes every vault path.
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile instanceof TFile) {
      this.observeFile(activeFile);
    }

    // Register Vault events
    register(this.app.vault.on("create", (file) => {
      if (file instanceof TFile) {
        this.observeFile(file);
      }
    }));

    register(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile) {
        this.observeFile(file);
      }
    }));

    register(this.app.vault.on("delete", (file) => {
      if (file instanceof TFile) {
        this.tombstone(file.path);
        this.paths.delete(file.path);
        this.notify();
      }
    }));

    register(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile) {
        const oldInfo = this.paths.get(oldPath);
        const oldEntries = oldInfo ? oldInfo.entries : [];
        this.tombstone(oldPath);
        this.paths.delete(oldPath);

        if (this.isCandidate(file)) {
          // Migrate old entries temporarily for fast display
          const migratedEntries = oldEntries.map((e) => ({
            ...e,
            path: file.path
          }));
          this.paths.set(file.path, {
            generation: 0,
            state: "active",
            entries: migratedEntries
          });
          this.scheduleProcess(file);
        }
        this.notify();
      }
    }));

    // Metadata cache changes can qualify a file without a vault modify event.
    register(this.app.metadataCache.on("changed", (file) => {
      if (file instanceof TFile) {
        this.observeFile(file);
      }
    }));

    // Open files are the primary discovery path for notes that already existed
    // before the plugin was enabled. This event exposes only the opened file.
    register(this.app.workspace.on("file-open", (file) => {
      if (file instanceof TFile) {
        this.observeFile(file);
      }
    }));
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getAllFavorites(): FavoriteEntry[] {
    const list: FavoriteEntry[] = [];
    for (const info of this.paths.values()) {
      if (info.state === "active") {
        list.push(...info.entries);
      }
    }
    return list;
  }

  public forceReindex(): void {
    // Reconcile only paths previously observed by this index. A complete vault
    // scan would disclose every file path and is intentionally not performed.
    const knownPaths = new Set([...this.paths.keys(), ...this.pending.keys()]);
    for (const path of knownPaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile && this.isCandidate(file)) {
        this.scheduleProcess(file);
      } else {
        this.tombstone(path);
        this.paths.delete(path);
      }
    }
    this.notify();
  }

  private isCandidate(file: TFile): boolean {
    if (file.extension !== "md") return false;
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return true;
    const val: unknown = cache.frontmatter?.["floor-notes"];
    return typeof val === "number" && Number.isInteger(val) && val > 0;
  }

  private observeFile(file: TFile): void {
    if (this.isCandidate(file)) {
      this.scheduleProcess(file);
      return;
    }

    if (this.paths.has(file.path) || this.pending.has(file.path)) {
      this.tombstone(file.path);
      this.paths.delete(file.path);
      this.notify();
    }
  }

  private scheduleProcess(file: TFile): void {
    this.pending.set(file.path, file);
    this.drainProcessQueue();
  }

  private drainProcessQueue(): void {
    while (this.activeWorkers < FavoritesIndex.MAX_CONCURRENT_PROCESSES && this.pending.size > 0) {
      const next = this.pending.entries().next().value;
      if (!next) return;
      const [path, file] = next;
      this.pending.delete(path);
      if (this.processing.has(path)) {
        continue;
      }
      this.processing.add(path);
      this.activeWorkers++;
      void this.processFile(file).finally(() => {
        this.processing.delete(path);
        this.activeWorkers--;
        this.drainProcessQueue();
      });
    }
  }

  private async processFile(file: TFile): Promise<void> {
    const path = file.path;
    let pathInfo = this.paths.get(path);
    if (!pathInfo) {
      pathInfo = { generation: 0, state: "active", entries: [] };
      this.paths.set(path, pathInfo);
    }
    pathInfo.generation++;
    pathInfo.state = "active";
    const thisGen = pathInfo.generation;

    try {
      const content = await this.app.vault.read(file);
      if (pathInfo.generation !== thisGen || (pathInfo.state as string) === "tombstoned") {
        return;
      }
      const parseRes = parseThreadDocument(content, file.name);
      if (pathInfo.generation !== thisGen || (pathInfo.state as string) === "tombstoned") {
        return;
      }

      if (!parseRes.ok) {
        // Parse error: mark current entries as stale
        for (const entry of pathInfo.entries) {
          entry.isStale = true;
        }
      } else {
        // Success: rebuild favorites
        const title = parseRes.doc.title || file.basename;
        const newEntries: FavoriteEntry[] = [];
        for (const record of parseRes.doc.records) {
          if (record.favorite) {
            const bodySpan = record.bodySpan;
            const rawBody = content.substring(bodySpan.start, bodySpan.end);
            const firstLine = rawBody.split(/\r?\n/)[0]?.trim() || "";
            newEntries.push({
              path,
              recordId: record.id,
              title,
              snippet: firstLine,
              isStale: false,
              type: record.type
            });
          }
        }
        pathInfo.entries = newEntries;
      }
      this.notify();
    } catch {
      if (pathInfo.generation !== thisGen || (pathInfo.state as string) === "tombstoned") {
        return;
      }
      // Read failure: mark as stale
      for (const entry of pathInfo.entries) {
        entry.isStale = true;
      }
      this.notify();
    }
  }

  private tombstone(path: string): void {
    this.pending.delete(path);
    const pathInfo = this.paths.get(path);
    if (pathInfo) {
      pathInfo.generation++;
      pathInfo.state = "tombstoned";
      pathInfo.entries = [];
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error("Error notifying FavoritesIndex listener:", e);
      }
    }
  }
}
