import { parseDocument, isMap, isScalar } from "yaml";
import { Span, ParsedFrontmatter, Diagnostic, PhysicalLine } from "./types";
import { isThreadViewStyle, ThreadViewStyle } from "../settings/types";

export interface FrontmatterParseResult {
  frontmatter: ParsedFrontmatter | null;
  diagnostics: Diagnostic[];
}

export function parseFrontmatter(
  rawText: string,
  bomSpan: Span | null,
  lines: readonly PhysicalLine[],
  terminalEolSpan: Span
): FrontmatterParseResult {
  const diagnostics: Diagnostic[] = [];

  // Check if first line starts with "---"
  const firstLineIndex = bomSpan ? 1 : 0;
  const firstLine = lines[firstLineIndex];
  if (!firstLine) {
    return { frontmatter: null, diagnostics };
  }

  const firstLineText = rawText.substring(firstLine.contentSpan.start, firstLine.contentSpan.end);
  if (firstLineText !== "---") {
    diagnostics.push({
      code: "FN-F001",
      severity: "error",
      message: "Missing or malformed reserved frontmatter. Thread files must start with a valid frontmatter block.",
      line: firstLine.index + 1,
      column: 1,
      span: firstLine.contentSpan
    });
    return { frontmatter: null, diagnostics };
  }

  // Find closing "---"
  let closingLineIndex = -1;
  for (let i = firstLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const lineText = rawText.substring(line.contentSpan.start, line.contentSpan.end);
    if (lineText === "---") {
      closingLineIndex = i;
      break;
    }
  }

  if (closingLineIndex === -1) {
    diagnostics.push({
      code: "FN-F001",
      severity: "error",
      message: "Frontmatter block is not closed. Missing closing '---'.",
      line: firstLine.index + 1,
      column: 1,
      span: firstLine.contentSpan
    });
    return { frontmatter: null, diagnostics };
  }

  const closingLine = lines[closingLineIndex]!;
  
  // Define spans
  const openingStart = firstLine.contentSpan.start;
  const closingEolEnd = closingLine.eolSpan ? closingLine.eolSpan.end : closingLine.contentSpan.end;

  const lexicalSpan: Span = { start: openingStart, end: closingEolEnd };

  // ownedSpan: If closing EOL is the terminal EOL, ownedSpan ends at terminalEolSpan.start
  let ownedSpan: Span;
  if (closingLine.eolSpan && closingLine.eolSpan.start === terminalEolSpan.start && closingLine.eolSpan.end === terminalEolSpan.end) {
    ownedSpan = { start: openingStart, end: terminalEolSpan.start };
  } else {
    ownedSpan = lexicalSpan;
  }

  // Parse YAML block
  // Extract lines inside the frontmatter
  const frontmatterLines = lines.slice(firstLineIndex + 1, closingLineIndex);
  if (frontmatterLines.length === 0) {
    diagnostics.push({
      code: "FN-F001",
      severity: "error",
      message: "Empty frontmatter block.",
      line: firstLine.index + 1,
      column: 1
    });
    return { frontmatter: null, diagnostics };
  }

  const yamlStart = frontmatterLines[0]!.contentSpan.start;
  const yamlEnd = frontmatterLines[frontmatterLines.length - 1]!.eolSpan 
    ? frontmatterLines[frontmatterLines.length - 1]!.eolSpan!.end 
    : frontmatterLines[frontmatterLines.length - 1]!.contentSpan.end;

  const yamlText = rawText.substring(yamlStart, yamlEnd);

  const doc = parseDocument(yamlText, { uniqueKeys: false });
  if (doc.errors.length > 0) {
    diagnostics.push({
      code: "FN-F001",
      severity: "error",
      message: `Invalid YAML syntax in frontmatter: ${doc.errors[0]!.message}`,
      line: firstLine.index + 2,
      column: 1
    });
    return { frontmatter: null, diagnostics };
  }

  const contents = doc.contents;
  if (!isMap(contents)) {
    diagnostics.push({
      code: "FN-F001",
      severity: "error",
      message: "Frontmatter content must be a YAML mapping (key-value pairs).",
      line: firstLine.index + 2,
      column: 1
    });
    return { frontmatter: null, diagnostics };
  }

  // Check duplicate keys manually in YAML AST before mapping collapse
  const keys = new Set<string>();
  let version: number | null = null;
  let sort: "asc" | "desc" | null = null;
  let sortValueSpan: Span | null = null;
  let sortLineIndex: number | null = null;
  let viewStyle: ThreadViewStyle | null = null;
  let viewStyleValueSpan: Span | null = null;
  let viewStyleLineIndex: number | null = null;

  for (const pair of contents.items) {
    if (!pair.key || !isScalar(pair.key)) {
      continue;
    }
    const keyName = String(pair.key.value);
    
    if (keys.has(keyName)) {
      // Duplicate key is a fatal error
      diagnostics.push({
        code: "FN-F013",
        severity: "error",
        message: `Duplicate key '${keyName}' found in frontmatter.`,
        line: firstLine.index + 2,
        column: 1
      });
      return { frontmatter: null, diagnostics };
    }
    keys.add(keyName);

    const valNode = pair.value;
    if (keyName === "floor-notes") {
      if (!valNode || !isScalar(valNode)) {
        diagnostics.push({
          code: "FN-F001",
          severity: "error",
          message: "The 'floor-notes' key must have a scalar integer value.",
          line: firstLine.index + 2,
          column: 1
        });
        return { frontmatter: null, diagnostics };
      }
      const val = valNode.value;
      if (typeof val !== "number" || !Number.isInteger(val)) {
        diagnostics.push({
          code: "FN-F001",
          severity: "error",
          message: "The 'floor-notes' value must be an integer (e.g. 1).",
          line: firstLine.index + 2,
          column: 1
        });
        return { frontmatter: null, diagnostics };
      }
      version = val;
    } else if (keyName === "floor-notes-sort") {
      if (!valNode || !isScalar(valNode)) {
        diagnostics.push({
          code: "FN-F012",
          severity: "error",
          message: "The 'floor-notes-sort' key must have a scalar string value.",
          line: firstLine.index + 2,
          column: 1
        });
        return { frontmatter: null, diagnostics };
      }
      const val = valNode.value;
      if (val !== "asc" && val !== "desc") {
        diagnostics.push({
          code: "FN-F012",
          severity: "error",
          message: "The 'floor-notes-sort' value must be 'asc' or 'desc'.",
          line: firstLine.index + 2,
          column: 1
        });
        return { frontmatter: null, diagnostics };
      }
      sort = val;
      
      // Calculate sortValueSpan and sortLineIndex
      if (valNode.range) {
        const start = yamlStart + valNode.range[0];
        const end = yamlStart + valNode.range[1];
        sortValueSpan = { start, end };

        // Find line index
        for (let idx = firstLineIndex + 1; idx < closingLineIndex; idx++) {
          const line = lines[idx]!;
          if (start >= line.contentSpan.start && start <= line.contentSpan.end) {
            sortLineIndex = idx;
            break;
          }
        }
      }
    } else if (keyName === "floor-notes-view-style") {
      if (!valNode || !isScalar(valNode) || !isThreadViewStyle(valNode.value)) {
        diagnostics.push({
          code: "FN-F014",
          severity: "error",
          message: "The 'floor-notes-view-style' value must be one of: bubble, glass, paper, timeline.",
          line: firstLine.index + 2,
          column: 1
        });
        return { frontmatter: null, diagnostics };
      }
      viewStyle = valNode.value;
      if (valNode.range) {
        const start = yamlStart + valNode.range[0];
        const end = yamlStart + valNode.range[1];
        viewStyleValueSpan = { start, end };
        for (let idx = firstLineIndex + 1; idx < closingLineIndex; idx++) {
          const line = lines[idx]!;
          if (start >= line.contentSpan.start && start <= line.contentSpan.end) {
            viewStyleLineIndex = idx;
            break;
          }
        }
      }
    }
  }

  if (version === null) {
    diagnostics.push({
      code: "FN-F001",
      severity: "error",
      message: "Missing version marker 'floor-notes: 1' in frontmatter.",
      line: firstLine.index + 2,
      column: 1
    });
    return { frontmatter: null, diagnostics };
  }

  // version is present
  if (version !== 1) {
    if (version > 1) {
      diagnostics.push({
        code: "FN-F002",
        severity: "error",
        message: `Unsupported version ${version}. Only version 1 is supported.`,
        line: firstLine.index + 2,
        column: 1
      });
      return { frontmatter: null, diagnostics };
    } else {
      diagnostics.push({
        code: "FN-F001",
        severity: "error",
        message: "Invalid version number in 'floor-notes'. Value must be >= 1.",
        line: firstLine.index + 2,
        column: 1
      });
      return { frontmatter: null, diagnostics };
    }
  }

  const parsedFrontmatter: ParsedFrontmatter = {
    lexicalSpan,
    ownedSpan,
    version,
    sort,
    sortValueSpan,
    sortLineIndex,
    viewStyle,
    viewStyleValueSpan,
    viewStyleLineIndex
  };

  return { frontmatter: parsedFrontmatter, diagnostics };
}
