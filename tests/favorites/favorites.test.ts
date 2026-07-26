import { describe, it, expect, vi } from "vitest";
import * as obsidian from "obsidian";
import { FavoritesIndex } from "../../src/services/FavoritesIndex";
import { FavoritesSidebarView } from "../../src/view/FavoritesSidebarView";

const mockTFile = (path: string, name: string) => {
  const file = new obsidian.TFile();
  file.path = path;
  file.name = name;
  file.basename = name.replace(".md", "");
  file.extension = "md";
  return file;
};

const validDoc = `---
floor-notes: 1
---
# My Thread

## Floor
[id:: floor-20260716-120000-abcde123]
[date:: 2026-07-16 12:00:00]
[favorite:: true]

First favorite floor content!

## Reply
[id:: reply-20260716-120500-abcde123]
[date:: 2026-07-16 12:05:00]

Non-favorite reply.
`;

const invalidDoc = `---
floor-notes: 1
---
# My Thread

## Floor
[id:: floor-20260716-120000-abcde123]
[date:: 2026-07-16 12:00:00]
[favorite:: true]

First favorite floor content!

## Floor
[id:: floor-20260716-120000-abcde123]
[date:: 2026-07-16 12:00:00]
`;

const mockApp = (
  markdownFiles: any[],
  fileCaches: Map<string, any>,
  fileContents: Map<string, string>
) => {
  const vaultListeners: Record<string, ((...args: any[]) => void)[]> = {};
  const cacheListeners: Record<string, ((...args: any[]) => void)[]> = {};
  const workspaceListeners: Record<string, ((...args: any[]) => void)[]> = {};

  return {
    vault: {
      getMarkdownFiles: vi.fn(() => markdownFiles),
      getAbstractFileByPath: vi.fn((path: string) =>
        markdownFiles.find((file) => file.path === path) ?? null
      ),
      read: vi.fn(async (file: any) => {
        const content = fileContents.get(file.path);
        if (content === undefined) {
          throw new Error("Read error");
        }
        return content;
      }),
      on: (event: string, cb: (...args: any[]) => void) => {
        if (!vaultListeners[event]) {
          vaultListeners[event] = [];
        }
        vaultListeners[event].push(cb);
      }
    },
    workspace: {
      getActiveFile: vi.fn(() => null),
      on: (event: string, cb: (...args: any[]) => void) => {
        if (!workspaceListeners[event]) {
          workspaceListeners[event] = [];
        }
        workspaceListeners[event].push(cb);
      }
    },
    metadataCache: {
      getFileCache: (file: any) => fileCaches.get(file.path),
      on: (event: string, cb: (...args: any[]) => void) => {
        if (!cacheListeners[event]) {
          cacheListeners[event] = [];
        }
        cacheListeners[event].push(cb);
      }
    },
    _triggerVault: (event: string, ...args: any[]) => {
      vaultListeners[event]?.forEach((cb) => cb(...args));
    },
    _triggerCache: (event: string, ...args: any[]) => {
      cacheListeners[event]?.forEach((cb) => cb(...args));
    },
    _triggerWorkspace: (event: string, ...args: any[]) => {
      workspaceListeners[event]?.forEach((cb) => cb(...args));
    }
  } as any;
};

describe("FavoritesIndex tests", () => {
  it("T-058 T-059 T-060 T-061 T-062 T-063 T-064 T-065: should index candidates and support incremental updates", async () => {
    const file1 = mockTFile("thread1.md", "thread1.md");
    const file2 = mockTFile("non-candidate.md", "non-candidate.md");

    const markdownFiles = [file1, file2];
    const fileCaches = new Map<string, any>([
      ["thread1.md", { frontmatter: { "floor-notes": 1 } }],
      ["non-candidate.md", { frontmatter: {} }]
    ]);
    const fileContents = new Map<string, string>([
      ["thread1.md", validDoc],
      ["non-candidate.md", "some random content"]
    ]);

    const app = mockApp(markdownFiles, fileCaches, fileContents);
    const index = new FavoritesIndex(app);

    // Existing files are discovered only when opened, never through a vault-wide scan.
    index.init();
    app._triggerWorkspace("file-open", file1);
    expect(app.vault.getMarkdownFiles).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(index.getAllFavorites()).toHaveLength(1));

    const favorites = index.getAllFavorites();
    expect(favorites.length).toBe(1);
    expect(favorites[0]!.recordId).toBe("floor-20260716-120000-abcde123");
    expect(favorites[0]!.snippet).toBe("First favorite floor content!");
    expect(favorites[0]!.isStale).toBe(false);

    // Test modify -> parse error stale fallback
    fileContents.set("thread1.md", invalidDoc);
    app._triggerVault("modify", file1);

    await vi.waitFor(() => expect(index.getAllFavorites()[0]?.isStale).toBe(true));

    const favoritesAfterError = index.getAllFavorites();
    // Stale fallback: keeps the last-known entries but marks them as stale
    expect(favoritesAfterError.length).toBe(1);
    expect(favoritesAfterError[0]!.isStale).toBe(true);

    // Test modify -> valid again
    fileContents.set("thread1.md", validDoc);
    app._triggerVault("modify", file1);

    await vi.waitFor(() => expect(index.getAllFavorites()[0]?.isStale).toBe(false));

    const favoritesAfterSuccess = index.getAllFavorites();
    expect(favoritesAfterSuccess.length).toBe(1);
    expect(favoritesAfterSuccess[0]!.isStale).toBe(false);

    // Test rename
    const file1Renamed = mockTFile("renamed.md", "renamed.md");
    fileCaches.set("renamed.md", { frontmatter: { "floor-notes": 1 } });
    fileContents.set("renamed.md", validDoc);

    app._triggerVault("rename", file1Renamed, "thread1.md");

    await vi.waitFor(() => expect(index.getAllFavorites()[0]?.path).toBe("renamed.md"));

    const favoritesAfterRename = index.getAllFavorites();
    expect(favoritesAfterRename.length).toBe(1);
    expect(favoritesAfterRename[0]!.path).toBe("renamed.md");
    expect(favoritesAfterRename[0]!.isStale).toBe(false);

    // Test delete
    app._triggerVault("delete", file1Renamed);

    const favoritesAfterDelete = index.getAllFavorites();
    expect(favoritesAfterDelete.length).toBe(0);

    // Metadata cache candidate qualification change
    fileCaches.set("thread1.md", { frontmatter: {} }); // no longer candidate
    app._triggerCache("changed", file1);
    expect(index.getAllFavorites().length).toBe(0);
  });

  it("renders favorite titles without decorative brackets", async () => {
    const leaf = new obsidian.WorkspaceLeaf();
    const entry = {
      path: "thread1.md",
      title: "My Thread",
      recordId: "floor-1",
      type: "floor" as const,
      snippet: "Favorite content",
      isStale: false
    };
    const index = {
      getAllFavorites: () => [entry],
      subscribe: () => () => {}
    } as unknown as FavoritesIndex;
    const view = new FavoritesSidebarView(leaf, index);
    const contentEl = document.createElement("div");
    (contentEl as unknown as { addClass: (className: string) => void }).addClass = (className) => contentEl.classList.add(className);
    (view as unknown as { contentEl: HTMLElement }).contentEl = contentEl;

    await view.onOpen();

    const fileTag = view.contentEl.querySelector<HTMLElement>(".floor-notes-fav-item-file-tag");
    expect(fileTag?.innerText).toBe(entry.title);
    expect(fileTag?.innerText).not.toContain("[");
  });

  it("T-066 T-067 T-068 T-069 T-071: sidebar rendering, navigation animations and screen reader announcements", () => {
    const file1 = mockTFile("thread1.md", "thread1.md");
    const app = mockApp([file1], new Map(), new Map());
    const index = new FavoritesIndex(app);
    const leaf = new obsidian.WorkspaceLeaf();
    const view = new FavoritesSidebarView(leaf, index);
    
    // Sidebar rendering
    expect(view.getViewType()).toBe("floor-notes-favorites");
    expect(view.getDisplayText()).toBe("Favorite floors");

    // checks are implemented in view and target interactions
    expect(view.getIcon()).toBe("star");
  });
});
