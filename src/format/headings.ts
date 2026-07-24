import { Span } from "./types";

export interface ParsedHeading {
  readonly type: "floor" | "reply";
  readonly span: Span;
}

export function parseStructuralHeading(lineText: string, lineStartOffset: number): ParsedHeading | null {
  // Must match exactly ## Floor[ \t]* or ### Reply[ \t]* from column zero (no leading whitespace)
  if (lineText.startsWith("## Floor")) {
    const rest = lineText.substring(8);
    if (/^[ \t]*$/.test(rest)) {
      return {
        type: "floor",
        span: { start: lineStartOffset, end: lineStartOffset + lineText.length }
      };
    }
  } else if (lineText.startsWith("### Reply")) {
    const rest = lineText.substring(9);
    if (/^[ \t]*$/.test(rest)) {
      return {
        type: "reply",
        span: { start: lineStartOffset, end: lineStartOffset + lineText.length }
      };
    }
  }

  return null;
}

export function parseATXH1Title(lineText: string): string | null {
  // Column-zero ATX H1: starts with '#' and next is EOL or space/tab
  if (!lineText.startsWith("#")) return null;
  if (lineText.length > 1 && lineText[1] !== " " && lineText[1] !== "\t") {
    return null;
  }

  let titleText = lineText.substring(1);

  // Remove closing hash sequence:
  // preceded by at least one space/tab, and followed by only space/tab
  let lastNonSpace = titleText.length - 1;
  while (lastNonSpace >= 0 && (titleText[lastNonSpace] === " " || titleText[lastNonSpace] === "\t")) {
    lastNonSpace--;
  }

  if (lastNonSpace >= 0) {
    let hashRunStart = lastNonSpace;
    while (hashRunStart >= 0 && titleText[hashRunStart] === "#") {
      hashRunStart--;
    }
    if (hashRunStart < lastNonSpace) {
      // We found a run of '#' from hashRunStart + 1 to lastNonSpace
      if (hashRunStart >= 0 && (titleText[hashRunStart] === " " || titleText[hashRunStart] === "\t")) {
        // Preceded by space/tab, remove it
        titleText = titleText.substring(0, hashRunStart + 1);
      }
    }
  }

  // Trim horizontal whitespace (ASCII space/tab)
  let start = 0;
  while (start < titleText.length && (titleText[start] === " " || titleText[start] === "\t")) {
    start++;
  }
  let end = titleText.length;
  while (end > start && (titleText[end - 1] === " " || titleText[end - 1] === "\t")) {
    end--;
  }

  return titleText.substring(start, end);
}
