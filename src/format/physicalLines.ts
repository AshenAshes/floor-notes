import { PhysicalLine, Span, EolText } from "./types";

export interface SplittingResult {
  bomSpan: Span | null;
  lines: PhysicalLine[];
  terminalEolSpan: Span;
}

export function parsePhysicalLines(rawText: string): SplittingResult {
  const lines: PhysicalLine[] = [];
  let bomSpan: Span | null = null;
  let startOffset = 0;

  if (rawText.startsWith("\uFEFF")) {
    bomSpan = { start: 0, end: 1 };
    startOffset = 1;
  }

  const length = rawText.length;
  let currentOffset = startOffset;
  let lineIndex = 0;

  // Handle empty string
  if (length === 0 || (length === 1 && bomSpan !== null)) {
    return {
      bomSpan,
      lines: [
        {
          index: 0,
          contentSpan: { start: currentOffset, end: currentOffset },
          eolSpan: null,
          eol: null,
          isTerminalEol: false
        }
      ],
      terminalEolSpan: { start: length, end: length }
    };
  }

  while (currentOffset < length) {
    let scanOffset = currentOffset;
    let foundEol: EolText | null = null;
    let eolStart = -1;
    let eolEnd = -1;

    while (scanOffset < length) {
      const char = rawText[scanOffset];
      if (char === "\n") {
        foundEol = "\n";
        eolStart = scanOffset;
        eolEnd = scanOffset + 1;
        break;
      } else if (char === "\r") {
        if (scanOffset + 1 < length && rawText[scanOffset + 1] === "\n") {
          foundEol = "\r\n";
          eolStart = scanOffset;
          eolEnd = scanOffset + 2;
          break;
        }
      }
      scanOffset++;
    }

    if (foundEol !== null) {
      lines.push({
        index: lineIndex,
        contentSpan: { start: currentOffset, end: eolStart },
        eolSpan: { start: eolStart, end: eolEnd },
        eol: foundEol,
        isTerminalEol: false
      });
      lineIndex++;
      currentOffset = eolEnd;
    } else {
      // Last line without EOL
      lines.push({
        index: lineIndex,
        contentSpan: { start: currentOffset, end: length },
        eolSpan: null,
        eol: null,
        isTerminalEol: false
      });
      lineIndex++;
      currentOffset = length;
    }
  }

  // Handle case where last character was EOL, so we need to add an empty final line
  const lastLine = lines[lines.length - 1];
  if (lastLine && lastLine.eolSpan !== null) {
    lines.push({
      index: lineIndex,
      contentSpan: { start: length, end: length },
      eolSpan: null,
      eol: null,
      isTerminalEol: false
    });
  }

  // Find terminal EOL
  // terminal EOL is the EOL of the second to last line in the lines array (which will be followed by the empty EOF line)
  // Or more simply: if the file ends with a newline, the last EOL is the terminal EOL.
  let terminalEolSpan: Span = { start: length, end: length };
  if (lines.length >= 2) {
    const secondToLast = lines[lines.length - 2]!;
    if (secondToLast.eolSpan !== null && lines[lines.length - 1]!.contentSpan.start === length) {
      // The second-to-last line has an EOL, and the last line is the empty line at EOF.
      // So this EOL is the terminal EOL.
      // Re-assign isTerminalEol
      const updatedLines = [...lines];
      const termLine = secondToLast;
      updatedLines[lines.length - 2] = {
        ...termLine,
        isTerminalEol: true
      };
      terminalEolSpan = termLine.eolSpan!;
      return {
        bomSpan,
        lines: updatedLines,
        terminalEolSpan
      };
    }
  }

  return {
    bomSpan,
    lines,
    terminalEolSpan
  };
}
