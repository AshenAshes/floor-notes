import { Span } from "./types";

export interface SeparatorResult {
  readonly span: Span;
  readonly eolCount: number;
}

export function findRecordSeparatorSpan(
  rawText: string,
  headingStart: number,
  lowerBound: number
): SeparatorResult {
  let cursor = headingStart;
  let eolCount = 0;
  let boundaryStart = headingStart;

  function getPrecedingEol(curr: number): { start: number; length: number } | null {
    if (curr - 1 < lowerBound) return null;
    const char = rawText[curr - 1];
    if (char === "\n") {
      if (curr - 2 >= lowerBound && rawText[curr - 2] === "\r") {
        return { start: curr - 2, length: 2 };
      }
      return { start: curr - 1, length: 1 };
    }
    return null;
  }

  const firstEol = getPrecedingEol(cursor);
  if (firstEol !== null) {
    eolCount = 1;
    cursor = firstEol.start;
    boundaryStart = firstEol.start;

    // Skip backward horizontal spaces/tabs
    let tempCursor = cursor;
    while (tempCursor - 1 >= lowerBound && (rawText[tempCursor - 1] === " " || rawText[tempCursor - 1] === "\t")) {
      tempCursor--;
    }

    const secondEol = getPrecedingEol(tempCursor);
    if (secondEol !== null) {
      eolCount = 2;
      boundaryStart = secondEol.start;
    }
  }

  return {
    span: { start: boundaryStart, end: headingStart },
    eolCount
  };
}
