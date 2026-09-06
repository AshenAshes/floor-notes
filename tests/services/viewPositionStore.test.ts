import { describe, expect, it } from "vitest";
import {
  FloorViewPosition,
  MAX_VIEW_POSITIONS,
  parseFloorViewPosition,
  ViewPositionStore,
  VIEW_POSITION_VERSION
} from "../../src/services/ViewPositionStore";

function makePosition(updatedAt: number, page = 1): FloorViewPosition {
  return {
    version: VIEW_POSITION_VERSION,
    page,
    scrollTop: updatedAt,
    anchorOffset: -12,
    updatedAt,
    anchorRecordId: `floor-${updatedAt}`
  };
}

describe("ViewPositionStore", () => {
  it("accepts only finite, versioned positions", () => {
    expect(parseFloorViewPosition(makePosition(10))).toEqual(makePosition(10));
    expect(parseFloorViewPosition({ ...makePosition(10), version: 2 })).toBeNull();
    expect(parseFloorViewPosition({ ...makePosition(10), page: 0 })).toBeNull();
    expect(parseFloorViewPosition({ ...makePosition(10), scrollTop: Number.NaN })).toBeNull();
    expect(parseFloorViewPosition({ ...makePosition(10), anchorRecordId: "" })).toBeNull();
  });

  it("normalizes invalid entries and keeps the newest duplicate path", () => {
    const store = new ViewPositionStore();
    const shouldNormalize = store.load({
      version: VIEW_POSITION_VERSION,
      entries: [
        { path: "thread.md", position: makePosition(1) },
        { path: "", position: makePosition(2) },
        { path: "thread.md", position: makePosition(3, 2) },
        { path: "broken.md", position: { ...makePosition(4), page: -1 } }
      ]
    });

    expect(shouldNormalize).toBe(true);
    expect(store.size).toBe(1);
    expect(store.get("thread.md")).toEqual(makePosition(3, 2));
  });

  it("uses least-recently-updated eviction at the configured limit", () => {
    const store = new ViewPositionStore();
    for (let index = 0; index <= MAX_VIEW_POSITIONS; index++) {
      store.set(`thread-${index}.md`, makePosition(index));
    }

    expect(store.size).toBe(MAX_VIEW_POSITIONS);
    expect(store.get("thread-0.md")).toBeUndefined();
    expect(store.get(`thread-${MAX_VIEW_POSITIONS}.md`)).toEqual(
      makePosition(MAX_VIEW_POSITIONS)
    );
  });

  it("round-trips persisted positions without requesting normalization", () => {
    const original = new ViewPositionStore();
    original.set("one.md", makePosition(1));
    original.set("two.md", makePosition(2, 3));

    const restored = new ViewPositionStore();
    expect(restored.load(original.serialize())).toBe(false);
    expect(restored.get("one.md")).toEqual(makePosition(1));
    expect(restored.get("two.md")).toEqual(makePosition(2, 3));
  });

  it("does not let a delayed older pane overwrite a newer position", () => {
    const store = new ViewPositionStore();
    const newer = makePosition(20, 2);
    expect(store.set("thread.md", newer)).toBe(true);

    expect(store.set("thread.md", makePosition(10, 1))).toBe(false);
    expect(store.get("thread.md")).toEqual(newer);
  });

  it("lets the first local interaction replace a synced timestamp from another device", () => {
    const store = new ViewPositionStore();
    store.load({
      version: VIEW_POSITION_VERSION,
      entries: [{ path: "thread.md", position: makePosition(10_000, 2) }]
    });
    const local = makePosition(10, 1);

    expect(store.set("thread.md", local)).toBe(true);
    expect(store.get("thread.md")).toEqual(local);
  });
});
