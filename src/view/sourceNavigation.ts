import type { ParsedThreadDocument } from "../format/types";

interface SourceNavigationPosition {
  readonly offset: number | null;
  readonly line: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function asNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function getNavigationPosition(state: unknown): SourceNavigationPosition | null {
  const source = asRecord(state);
  if (!source) {
    return null;
  }

  const startLoc = asRecord(source.startLoc);
  const directOffset = asNonNegativeInteger(source.offset);
  const startOffset = asNonNegativeInteger(startLoc?.offset);
  const match = asRecord(source.match);
  const matches = match?.matches;
  const matchEntries = Array.isArray(matches) ? matches as unknown[] : [];
  const firstMatch: unknown = matchEntries[0];
  const matchOffset = Array.isArray(firstMatch)
    ? asNonNegativeInteger((firstMatch as unknown[])[0])
    : null;
  const line = asNonNegativeInteger(source.line);
  const offset = directOffset ?? startOffset ?? matchOffset;

  return offset !== null || line !== null
    ? { offset, line }
    : null;
}

export function hasSourceNavigationState(state: unknown): boolean {
  return getNavigationPosition(state) !== null;
}

export function resolveRecordIdFromNavigationState(
  doc: ParsedThreadDocument,
  state: unknown
): string | undefined {
  const position = getNavigationPosition(state);
  if (!position) {
    return undefined;
  }

  const offset = position.offset ?? (
    position.line !== null
      ? doc.physicalLines[position.line]?.contentSpan.start
      : undefined
  );
  if (offset === undefined) {
    return undefined;
  }

  return doc.records.find((record) =>
    offset >= record.fullSpan.start && offset < record.fullSpan.end
  )?.id;
}
