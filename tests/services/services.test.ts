import { describe, it, expect, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { FileIdentityRegistry } from "../../src/services/FileIdentityRegistry";
import { SerialTaskQueue } from "../../src/services/SerialTaskQueue";
import { ThreadMutationService } from "../../src/services/ThreadMutationService";

const mockTFile = (path: string, name: string): TFile => {
  return {
    path,
    name,
  } as unknown as TFile;
};

const mockVault = (initialContent: string) => {
  let content = initialContent;
  return {
    process: vi.fn(async (_file: TFile, callback: (data: string) => string | Promise<string>) => {
      content = await callback(content);
      return content;
    }),
    getContent: () => content
  };
};

const baseDoc = `---
floor-notes: 1
---
# Title

## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Body.
`;

describe("T-035: FileIdentityRegistry state changes", () => {
  it("should assign stable identities and release deleted metadata", () => {
    const registry = new FileIdentityRegistry();
    const file = mockTFile("notes/my-thread.md", "my-thread.md");

    const token = registry.getOrCreateIdentity(file);
    expect(token).toBeDefined();

    // Rename
    file.path = "notes/renamed-thread.md";
    registry.handleRename(file, "notes/my-thread.md");
    
    const info = registry.getIdentityInfo(token);
    expect(info).toBeDefined();
    expect(info!.path).toBe("notes/renamed-thread.md");
    expect(info!.epoch).toBe(1);
    expect(info!.state).toBe("active");

    // Delete
    registry.handleDelete(file);
    expect(registry.getIdentityInfo(token)).toBeUndefined();
    expect(registry.getIdentityByPath("notes/renamed-thread.md")).toBeUndefined();
  });
});

describe("SerialTaskQueue sequential execution", () => {
  it("should execute tasks sequentially", async () => {
    const queue = new SerialTaskQueue();
    const results: number[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted = false;

    const p1 = queue.add(async () => {
      firstStarted = true;
      await firstGate;
      results.push(1);
      return 1;
    });

    const p2 = queue.add(async () => {
      results.push(2);
      return 2;
    });

    await vi.waitFor(() => expect(firstStarted).toBe(true));
    expect(results).toEqual([]);
    releaseFirst();

    await Promise.all([p1, p2]);
    expect(results).toEqual([1, 2]);
  });
});

describe("ThreadMutationService Vault processes", () => {
  it("should execute enqueued mutations in order and notify listeners", async () => {
    const registry = new FileIdentityRegistry();
    const vault = mockVault(baseDoc);
    const app = { vault } as unknown as App;
    const service = new ThreadMutationService(app, registry);

    const file = mockTFile("notes/my-thread.md", "my-thread.md");

    const listener = vi.fn();
    service.addAppliedListener(listener);

    const date = new Date(2026, 6, 16, 15, 33, 12);
    const result = await service.addFloor(file, "Second Floor Content", date);

    expect(result.type).toBe("applied");
    if (result.type === "applied") {
      expect(result.newDoc.records.length).toBe(2);
      expect(vault.getContent()).toContain("Second Floor Content");
    }

    expect(listener).toHaveBeenCalledTimes(1);
    const queues = (service as unknown as { queues: Map<string, SerialTaskQueue> }).queues;
    await vi.waitFor(() => expect(queues.size).toBe(0));
  });

  it("keeps a queue while consecutive mutations are pending and removes it once idle", async () => {
    const registry = new FileIdentityRegistry();
    let content = baseDoc;
    let processCount = 0;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let firstStarted = false;
    let secondStarted = false;
    const vault = {
      process: vi.fn(async (_file: TFile, callback: (data: string) => string | Promise<string>) => {
        if (processCount++ === 0) {
          firstStarted = true;
          await firstGate;
        } else {
          secondStarted = true;
          await secondGate;
        }
        content = await callback(content);
        return content;
      })
    };
    const app = { vault } as unknown as App;
    const service = new ThreadMutationService(app, registry);
    const file = mockTFile("notes/my-thread.md", "my-thread.md");
    const token = registry.getOrCreateIdentity(file);
    const queues = (service as unknown as { queues: Map<string, SerialTaskQueue> }).queues;

    const first = service.addFloor(file, "First queued floor", new Date());
    await vi.waitFor(() => expect(firstStarted).toBe(true));
    const activeQueue = queues.get(token);
    expect(activeQueue).toBeDefined();

    const second = service.addFloor(file, "Second queued floor", new Date());
    expect(queues.get(token)).toBe(activeQueue);

    releaseFirst();
    await vi.waitFor(() => expect(secondStarted).toBe(true));
    expect(queues.get(token)).toBe(activeQueue);

    releaseSecond();
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(queues.size).toBe(0));
  });

  it("persists a view style through the queued mutation path", async () => {
    const registry = new FileIdentityRegistry();
    const vault = mockVault(baseDoc);
    const app = { vault } as unknown as App;
    const service = new ThreadMutationService(app, registry);
    const file = mockTFile("notes/my-thread.md", "my-thread.md");

    const result = await service.setViewStyle(file, "timeline");

    expect(result.type).toBe("applied");
    expect(vault.getContent()).toContain("floor-notes-view-style: timeline");
  });

  it("should reject mutations on deleted/tombstoned files", async () => {
    const registry = new FileIdentityRegistry();
    const vault = mockVault(baseDoc);
    const app = { vault } as unknown as App;
    const service = new ThreadMutationService(app, registry);

    const file = mockTFile("notes/my-thread.md", "my-thread.md");
    registry.getOrCreateIdentity(file);

    // Delete before calling mutation
    registry.handleDelete(file);

    const result = await service.addFloor(file, "Content", new Date());
    expect(result.type).toBe("missing");
  });

  it("does not run a queued mutation after its file is tombstoned", async () => {
    const registry = new FileIdentityRegistry();
    let releaseFirstProcess: (() => void) | undefined;
    const vault = {
      process: vi.fn(async (_file: TFile, callback: (data: string) => string | Promise<string>) => {
        await new Promise<void>((resolve) => {
          releaseFirstProcess = resolve;
        });
        return callback(baseDoc);
      })
    };
    const app = { vault } as unknown as App;
    const service = new ThreadMutationService(app, registry);
    const file = mockTFile("notes/my-thread.md", "my-thread.md");
    registry.getOrCreateIdentity(file);

    const first = service.addFloor(file, "First queued floor", new Date());
    await vi.waitFor(() => expect(releaseFirstProcess).toBeTypeOf("function"));
    const second = service.addFloor(file, "Second queued floor", new Date());

    registry.handleDelete(file);
    releaseFirstProcess?.();

    await expect(first).resolves.toMatchObject({ type: "missing" });
    await expect(second).resolves.toMatchObject({ type: "missing" });
    expect(vault.process).toHaveBeenCalledOnce();
  });
});
