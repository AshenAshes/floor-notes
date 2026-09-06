export const VIEW_POSITION_VERSION = 1 as const;
export const MAX_VIEW_POSITIONS = 200;

export interface FloorViewPosition {
  readonly version: typeof VIEW_POSITION_VERSION;
  readonly page: number;
  readonly scrollTop: number;
  readonly anchorOffset: number;
  readonly updatedAt: number;
  readonly anchorRecordId?: string;
  readonly floorRecordId?: string;
  readonly previousRecordId?: string;
  readonly nextRecordId?: string;
}

export interface ViewPositionPersistence {
  isEnabled(): boolean;
  getRecent(path: string): FloorViewPosition | undefined;
  setRecent(path: string, position: FloorViewPosition, ownerWindow: Window): void;
  removeRecent(path: string, expectedPosition?: FloorViewPosition): void;
  flush(): Promise<void>;
}

interface PersistedViewPositionEntry {
  readonly path: string;
  readonly position: FloorViewPosition;
}

interface PersistedViewPositions {
  readonly version: typeof VIEW_POSITION_VERSION;
  readonly entries: readonly PersistedViewPositionEntry[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readRecordId(source: Record<string, unknown>, key: string): string | undefined | null {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return null;
  }
  return value;
}

export function parseFloorViewPosition(value: unknown): FloorViewPosition | null {
  if (!isObject(value) || value.version !== VIEW_POSITION_VERSION) {
    return null;
  }

  const page = value.page;
  const scrollTop = value.scrollTop;
  const anchorOffset = value.anchorOffset;
  const updatedAt = value.updatedAt;
  if (
    typeof page !== "number" ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !isFiniteNumber(scrollTop) ||
    scrollTop < 0 ||
    !isFiniteNumber(anchorOffset) ||
    !isFiniteNumber(updatedAt) ||
    updatedAt < 0
  ) {
    return null;
  }

  const anchorRecordId = readRecordId(value, "anchorRecordId");
  const floorRecordId = readRecordId(value, "floorRecordId");
  const previousRecordId = readRecordId(value, "previousRecordId");
  const nextRecordId = readRecordId(value, "nextRecordId");
  if (
    anchorRecordId === null ||
    floorRecordId === null ||
    previousRecordId === null ||
    nextRecordId === null
  ) {
    return null;
  }

  return {
    version: VIEW_POSITION_VERSION,
    page,
    scrollTop,
    anchorOffset,
    updatedAt,
    ...(anchorRecordId === undefined ? {} : { anchorRecordId }),
    ...(floorRecordId === undefined ? {} : { floorRecordId }),
    ...(previousRecordId === undefined ? {} : { previousRecordId }),
    ...(nextRecordId === undefined ? {} : { nextRecordId })
  };
}

export class ViewPositionStore {
  private readonly positions = new Map<string, FloorViewPosition>();
  private readonly locallyUpdatedPaths = new Set<string>();

  public get size(): number {
    return this.positions.size;
  }

  /**
   * Loads persisted state and returns whether the input should be normalized on disk.
   */
  public load(value: unknown): boolean {
    this.positions.clear();
    this.locallyUpdatedPaths.clear();
    if (value === undefined) {
      return false;
    }
    if (!isObject(value) || value.version !== VIEW_POSITION_VERSION || !Array.isArray(value.entries)) {
      return true;
    }

    let shouldNormalize = false;
    const validEntries: PersistedViewPositionEntry[] = [];
    const seenPaths = new Set<string>();
    for (const candidate of value.entries) {
      if (!isObject(candidate)) {
        shouldNormalize = true;
        continue;
      }
      const path = candidate.path;
      const position = parseFloorViewPosition(candidate.position);
      if (typeof path !== "string" || path.length === 0 || position === null) {
        shouldNormalize = true;
        continue;
      }
      if (seenPaths.has(path)) {
        shouldNormalize = true;
      }
      seenPaths.add(path);
      validEntries.push({ path, position });
    }

    validEntries.sort((left, right) => left.position.updatedAt - right.position.updatedAt);
    const retainedEntries = validEntries.slice(-MAX_VIEW_POSITIONS);
    if (retainedEntries.length !== validEntries.length) {
      shouldNormalize = true;
    }
    for (const entry of retainedEntries) {
      this.positions.delete(entry.path);
      this.positions.set(entry.path, entry.position);
    }
    return shouldNormalize;
  }

  public get(path: string): FloorViewPosition | undefined {
    return this.positions.get(path);
  }

  public set(path: string, position: FloorViewPosition): boolean {
    if (path.length === 0) {
      return false;
    }
    const existing = this.positions.get(path);
    if (
      existing &&
      this.locallyUpdatedPaths.has(path) &&
      existing.updatedAt > position.updatedAt
    ) {
      return false;
    }
    this.positions.delete(path);
    this.positions.set(path, position);
    this.locallyUpdatedPaths.add(path);
    while (this.positions.size > MAX_VIEW_POSITIONS) {
      const oldestPath = this.positions.keys().next().value;
      if (oldestPath === undefined) {
        break;
      }
      this.positions.delete(oldestPath);
      this.locallyUpdatedPaths.delete(oldestPath);
    }
    return true;
  }

  public delete(path: string): boolean {
    this.locallyUpdatedPaths.delete(path);
    return this.positions.delete(path);
  }

  public clear(): boolean {
    if (this.positions.size === 0) {
      this.locallyUpdatedPaths.clear();
      return false;
    }
    this.positions.clear();
    this.locallyUpdatedPaths.clear();
    return true;
  }

  public serialize(): PersistedViewPositions {
    return {
      version: VIEW_POSITION_VERSION,
      entries: Array.from(this.positions, ([path, position]) => ({ path, position }))
    };
  }
}
