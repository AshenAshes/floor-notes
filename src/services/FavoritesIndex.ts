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
  private paths = new Map<string, PathInfo>();
  private listeners = new Set<() => void>();

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

    // 1. Initial build: screen candidate files
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (this.isCandidate(file)) {
        void this.processFile(file);
      }
    }

    // 2. Register Vault events
    register(this.app.vault.on("create", (file) => {
      if (file instanceof TFile && this.isCandidate(file)) {
        void this.processFile(file);
      }
    }));

    register(this.app.vault.on("modify", (file) => {
      if (file instanceof TFile) {
        if (this.isCandidate(file)) {
          void this.processFile(file);
        } else if (this.paths.has(file.path)) {
          // Qualification lost
          this.tombstone(file.path);
          this.paths.delete(file.path);
          this.notify();
        }
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
          void this.processFile(file);
        }
        this.notify();
      }
    }));

    // 3. Register MetadataCache events
    register(this.app.metadataCache.on("changed", (file) => {
      if (file instanceof TFile) {
        if (this.isCandidate(file)) {
          void this.processFile(file);
        } else if (this.paths.has(file.path)) {
          // Qualification lost
          this.tombstone(file.path);
          this.paths.delete(file.path);
          this.notify();
        }
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
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (this.isCandidate(file)) {
        void this.processFile(file);
      } else if (this.paths.has(file.path)) {
        this.tombstone(file.path);
        this.paths.delete(file.path);
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
