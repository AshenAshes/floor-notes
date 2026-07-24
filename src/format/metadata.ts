import { PhysicalLine, ParsedField, Diagnostic, Span } from "./types";

export interface MetadataParseResult {
  readonly fields: readonly ParsedField[];
  readonly terminatorLineIndex: number;
  readonly diagnostics: readonly Diagnostic[];
}

export function parseMetadataBlock(
  rawText: string,
  lines: readonly PhysicalLine[],
  startLineIndex: number
): MetadataParseResult {
  const fields: ParsedField[] = [];
  const diagnostics: Diagnostic[] = [];

  let idx = startLineIndex;
  let terminatorLineIndex = -1;

  const fieldRegex = /^\[([A-Za-z][A-Za-z0-9_-]*)::[ \t]*(.*)\][ \t]*$/;

  while (idx < lines.length) {
    const line = lines[idx]!;
    const lineText = rawText.substring(line.contentSpan.start, line.contentSpan.end);

    // Check if it's a blank line
    // blank line: only space/tab and has EOL (or we're at the end)
    let isBlank = true;
    for (let i = 0; i < lineText.length; i++) {
      if (lineText[i] !== " " && lineText[i] !== "\t") {
        isBlank = false;
        break;
      }
    }

    if (isBlank) {
      // Must have EOL to be a valid metadata terminator
      if (line.eolSpan !== null) {
        terminatorLineIndex = idx;
        break;
      } else {
        // EOF without EOL doesn't count as a valid terminator EOL
        diagnostics.push({
          code: "FN-F011",
          severity: "error",
          message: "Metadata block is missing a terminating blank line at EOF.",
          line: line.index + 1,
          column: 1,
          span: line.contentSpan
        });
        return { fields: [], terminatorLineIndex: -1, diagnostics };
      }
    }

    // Must match field line
    const match = lineText.match(fieldRegex);
    if (!match) {
      diagnostics.push({
        code: "FN-F011",
        severity: "error",
        message: "Malformed metadata field. All lines in metadata block before the blank line must be '[key:: value]'.",
        line: line.index + 1,
        column: 1,
        span: line.contentSpan
      });
      return { fields: [], terminatorLineIndex: -1, diagnostics };
    }

    const key = match[1]!;
    const rawVal = match[2]!;

    // Find key and value spans
    const lineStart = line.contentSpan.start;
    const keyStart = lineStart + lineText.indexOf(key);
    const keySpan: Span = { start: keyStart, end: keyStart + key.length };

    const valStart = lineStart + lineText.indexOf(rawVal, key.length + 3); // 3 for ":: "
    const valueSpan: Span = { start: valStart, end: valStart + rawVal.length };

    const fullSpan: Span = {
      start: line.contentSpan.start,
      end: line.eolSpan ? line.eolSpan.end : line.contentSpan.end
    };

    fields.push({
      key,
      value: rawVal,
      lineIndex: idx,
      keySpan,
      valueSpan,
      fullSpan
    });

    idx++;
  }

  if (terminatorLineIndex === -1) {
    // We reached EOF or next structural heading without finding a blank line
    const lastLine = lines[lines.length - 1]!;
    diagnostics.push({
      code: "FN-F011",
      severity: "error",
      message: "Metadata block is missing a terminating blank line.",
      line: lastLine.index + 1,
      column: 1,
      span: lastLine.contentSpan
    });
    return { fields: [], terminatorLineIndex: -1, diagnostics };
  }

  return { fields, terminatorLineIndex, diagnostics };
}
