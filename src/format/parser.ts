import { parsePhysicalLines } from "./physicalLines";
import { parseFrontmatter } from "./frontmatter";
import { updateFenceState, INITIAL_FENCE_STATE } from "./fences";
import { parseStructuralHeading, parseATXH1Title } from "./headings";
import { parseMetadataBlock } from "./metadata";
import { findRecordSeparatorSpan } from "./separators";
import { isValidRecordId } from "../util/ids";
import { isUnicodeWhitespace } from "../util/unicodeWhitespace";
import { ParseResult, Diagnostic, ParsedRecord, Span, ParsedThreadDocument } from "./types";
import { ThreadViewStyle } from "../settings/types";

export interface ThreadDocumentDefaults {
  readonly defaultSortOrder?: "asc" | "desc";
  readonly defaultViewStyle?: ThreadViewStyle;
}

export function parseThreadDocument(
  source: string,
  fileName: string,
  defaults: "asc" | "desc" | ThreadDocumentDefaults = "asc"
): ParseResult {
  const defaultSortOrder = typeof defaults === "string"
    ? defaults
    : defaults.defaultSortOrder ?? "asc";
  const defaultViewStyle = typeof defaults === "string"
    ? "bubble"
    : defaults.defaultViewStyle ?? "bubble";
  const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(source);
  const diagnostics: Diagnostic[] = [];

  // Parse frontmatter
  const fmRes = parseFrontmatter(source, bomSpan, lines, terminalEolSpan);
  diagnostics.push(...fmRes.diagnostics);

  // If frontmatter is null, we cannot proceed with parsing records safely
  if (fmRes.frontmatter === null) {
    return {
      ok: false,
      diagnostics: diagnostics.filter(d => d.severity === "error")
    };
  }

  const frontmatter = fmRes.frontmatter;

  // Determine line range after frontmatter
  // Frontmatter ends at closingLineIndex
  // Find closingLineIndex by matching frontmatter.lexicalSpan.end
  let closingLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const end = line.eolSpan ? line.eolSpan.end : line.contentSpan.end;
    if (end === frontmatter.lexicalSpan.end) {
      closingLineIndex = i;
      break;
    }
  }

  // Scan post-frontmatter lines for headings, fence states, and H1
  let fenceState = INITIAL_FENCE_STATE;
  const headingInfo: { lineIndex: number; type: "floor" | "reply"; span: Span }[] = [];
  let firstH1Title: string | null = null;

  for (let i = closingLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const lineText = source.substring(line.contentSpan.start, line.contentSpan.end);

    fenceState = updateFenceState(lineText, fenceState);

    if (!fenceState.inFence) {
      const heading = parseStructuralHeading(lineText, line.contentSpan.start);
      if (heading) {
        headingInfo.push({
          lineIndex: i,
          type: heading.type,
          span: heading.span
        });
      } else {
        // H1 check in Preamble (before any structural heading)
        if (headingInfo.length === 0 && firstH1Title === null) {
          const h1 = parseATXH1Title(lineText);
          if (h1 !== null) {
            firstH1Title = h1;
          }
        }
      }
    }
  }

  const records: ParsedRecord[] = [];
  let hasFloor = false;
  let replyBeforeFloorError = false;
  const seenIds = new Map<string, Span>();
  let floorCounter = 0;

  for (let idx = 0; idx < headingInfo.length; idx++) {
    const h = headingInfo[idx]!;
    const nextH = headingInfo[idx + 1];

    // Check first reply before floor
    if (h.type === "floor") {
      hasFloor = true;
    } else if (h.type === "reply" && !hasFloor && !replyBeforeFloorError) {
      replyBeforeFloorError = true;
      diagnostics.push({
        code: "FN-F003",
        severity: "error",
        message: "Reply record found before the first Floor record.",
        line: lines[h.lineIndex]!.index + 1,
        column: 1,
        span: h.span
      });
    }

    // Parse metadata block
    const metaRes = parseMetadataBlock(source, lines, h.lineIndex + 1);
    diagnostics.push(...metaRes.diagnostics);

    if (metaRes.terminatorLineIndex === -1) {
      // Missing terminator blank line is already captured as FN-F011.
      // We cannot parse body/record safely, but let's try to proceed to next records
      continue;
    }

    // Process fields
    let recordId: string | null = null;
    let idSpan: Span = { start: 0, end: 0 };
    let recordDate: string | null = null;
    let dateSpan: Span = { start: 0, end: 0 };
    let recordFavorite: boolean = false;
    let favoriteSpan: Span | null = null;

    let idCount = 0;
    let dateCount = 0;
    let favoriteCount = 0;

    for (const field of metaRes.fields) {
      const trimmedVal = field.value.trim(); // Trim horizontal ASCII whitespace
      
      if (field.key === "id") {
        idCount++;
        if (idCount > 1) {
          diagnostics.push({
            code: "FN-F006",
            severity: "error",
            message: "Duplicate 'id' field in the same metadata block.",
            line: lines[field.lineIndex]!.index + 1,
            column: 1,
            span: field.fullSpan
          });
        } else {
          recordId = trimmedVal;
          idSpan = field.valueSpan;

          // Check ID format and prefix
          if (!isValidRecordId(trimmedVal)) {
            diagnostics.push({
              code: "FN-F005",
              severity: "error",
              message: "Invalid ID format or character alphabet.",
              line: lines[field.lineIndex]!.index + 1,
              column: 1,
              span: field.valueSpan
            });
          } else {
            // Check prefix matches record type
            const expectedPrefix = h.type === "floor" ? "floor-" : "reply-";
            if (!trimmedVal.startsWith(expectedPrefix)) {
              diagnostics.push({
                code: "FN-F005",
                severity: "error",
                message: `ID prefix mismatch. Expected prefix '${expectedPrefix}' for record type '${h.type}'.`,
                line: lines[field.lineIndex]!.index + 1,
                column: 1,
                span: field.valueSpan
              });
            } else {
              // Check duplicate ID globally
              if (seenIds.has(trimmedVal)) {
                diagnostics.push({
                  code: "FN-F007",
                  severity: "error",
                  message: `Duplicate ID '${trimmedVal}' found across the file.`,
                  line: lines[field.lineIndex]!.index + 1,
                  column: 1,
                  span: field.valueSpan
                });
              } else {
                seenIds.set(trimmedVal, field.valueSpan);
              }
            }
          }
        }
      } else if (field.key === "date") {
        dateCount++;
        if (dateCount > 1) {
          diagnostics.push({
            code: "FN-F006",
            severity: "error",
            message: "Duplicate 'date' field in the same metadata block.",
            line: lines[field.lineIndex]!.index + 1,
            column: 1,
            span: field.fullSpan
          });
        } else {
          recordDate = trimmedVal;
          dateSpan = field.valueSpan;

        }
      } else if (field.key === "favorite") {
        favoriteCount++;
        if (favoriteCount > 1) {
          diagnostics.push({
            code: "FN-F006",
            severity: "error",
            message: "Duplicate 'favorite' field in the same metadata block.",
            line: lines[field.lineIndex]!.index + 1,
            column: 1,
            span: field.fullSpan
          });
        } else {
          favoriteSpan = field.valueSpan;
          if (h.type === "reply") {
            diagnostics.push({
              code: "FN-F010",
              severity: "error",
              message: "The 'favorite' key is not allowed in Reply records.",
              line: lines[field.lineIndex]!.index + 1,
              column: 1,
              span: field.fullSpan
            });
          } else {
            if (trimmedVal !== "true") {
              diagnostics.push({
                code: "FN-F010",
                severity: "error",
                message: "The 'favorite' value must be exactly 'true'.",
                line: lines[field.lineIndex]!.index + 1,
                column: 1,
                span: field.valueSpan
              });
            } else {
              recordFavorite = true;
            }
          }
        }
      }
    }

    if (idCount === 0) {
      diagnostics.push({
        code: "FN-F004",
        severity: "error",
        message: `Missing required field 'id' in ${h.type} metadata.`,
        line: lines[h.lineIndex]!.index + 1,
        column: 1,
        span: h.span
      });
    }

    if (dateCount === 0) {
      diagnostics.push({
        code: "FN-F008",
        severity: "error",
        message: `Missing required field 'date' in ${h.type} metadata.`,
        line: lines[h.lineIndex]!.index + 1,
        column: 1,
        span: h.span
      });
    }

    // Determine body boundaries
    const rawBodyStart = lines[metaRes.terminatorLineIndex + 1] 
      ? lines[metaRes.terminatorLineIndex + 1]!.contentSpan.start 
      : terminalEolSpan.start;

    let bodyEnd = terminalEolSpan.start;
    if (nextH) {
      const sep = findRecordSeparatorSpan(source, nextH.span.start, rawBodyStart);
      bodyEnd = sep.span.start;
    }

    const bodySpan: Span = { start: rawBodyStart, end: bodyEnd };

    // Capture body physical line indices
    const bodyLineIndices: number[] = [];
    for (let i = metaRes.terminatorLineIndex + 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.contentSpan.start >= bodyEnd) {
        break;
      }
      bodyLineIndices.push(i);
    }

    // Calculate metadataSpan and metadataTerminatorSpan
    const firstField = metaRes.fields[0];
    const metaStart = firstField ? firstField.fullSpan.start : lines[h.lineIndex + 1]!.contentSpan.start;
    const termLine = lines[metaRes.terminatorLineIndex]!;
    const metaEnd = termLine.eolSpan ? termLine.eolSpan.end : termLine.contentSpan.end;

    const metadataSpan: Span = { start: metaStart, end: metaEnd };
    const metadataTerminatorSpan: Span = {
      start: termLine.contentSpan.start,
      end: termLine.eolSpan ? termLine.eolSpan.end : termLine.contentSpan.end
    };

    let floorNumber: number | null = null;
    if (h.type === "floor") {
      floorCounter++;
      floorNumber = floorCounter;
    }

    records.push({
      type: h.type,
      id: recordId || "",
      date: recordDate || "",
      favorite: recordFavorite,
      floorNumber,
      headingSpan: h.span,
      metadataSpan,
      metadataTerminatorSpan,
      bodySpan,
      fullSpan: { start: h.span.start, end: bodyEnd },
      fields: metaRes.fields,
      headingLineIndex: h.lineIndex,
      bodyLineIndices,
      idSpan,
      dateSpan,
      favoriteSpan
    });
  }

  // Check for errors in collected diagnostics
  const hasErrors = diagnostics.some(d => d.severity === "error");
  if (hasErrors) {
    return {
      ok: false,
      diagnostics: diagnostics.filter(d => d.severity === "error")
    };
  }

  // Build preambleSpan and preambleSeparatorSpan
  const preambleStart = frontmatter.ownedSpan.end;
  let preambleEnd = terminalEolSpan.start;
  let preambleSeparatorSpan: Span | null = null;

  if (headingInfo.length > 0) {
    const firstH = headingInfo[0]!;
    const sep = findRecordSeparatorSpan(source, firstH.span.start, preambleStart);
    preambleEnd = sep.span.start;
    preambleSeparatorSpan = sep.span.start === sep.span.end ? null : sep.span;
  }

  const preambleSpan: Span = { start: preambleStart, end: preambleEnd };

  // Calculate Title
  let title = firstH1Title || "";
  if (!title) {
    // Fall back to filename without .md
    const base = fileName.split(/[/\\]/).pop() || "";
    title = base.endsWith(".md") ? base.substring(0, base.length - 3) : base;
  }

  const explicitSort = frontmatter.sort;
  const effectiveSort = explicitSort || defaultSortOrder;
  const explicitViewStyle = frontmatter.viewStyle;
  const effectiveViewStyle = explicitViewStyle || defaultViewStyle;

  // Check warnings
  const warnings: Diagnostic[] = [];

  // 1. Mixed Line Endings
  let hasLF = false;
  let hasCRLF = false;
  for (const line of lines) {
    if (line.eolSpan) {
      const eolText = source.substring(line.eolSpan.start, line.eolSpan.end);
      if (eolText === "\n") hasLF = true;
      else if (eolText === "\r\n") hasCRLF = true;
    }
  }
  if (hasLF && hasCRLF) {
    warnings.push({
      code: "FN-W002",
      severity: "warning",
      message: "Mixed line endings (LF and CRLF) detected."
    });
  }

  // 2. Empty Body Warning
  for (let rIdx = 0; rIdx < records.length; rIdx++) {
    const record = records[rIdx]!;
    const bodyText = source.substring(record.bodySpan.start, record.bodySpan.end);
    let isEmpty = true;
    for (let charIdx = 0; charIdx < bodyText.length; charIdx++) {
      if (!isUnicodeWhitespace(bodyText[charIdx]!)) {
        isEmpty = false;
        break;
      }
    }
    if (isEmpty) {
      warnings.push({
        code: "FN-W003",
        severity: "warning",
        message: `Body of ${record.type} record ${record.id || rIdx} is empty.`,
        line: lines[record.headingLineIndex]!.index + 1,
        column: 1,
        span: record.bodySpan
      });
    }
  }

  const docParsed: ParsedThreadDocument = {
    rawText: source,
    fileName,
    bomSpan,
    physicalLines: lines,
    terminalEolSpan,
    frontmatter,
    preambleSpan,
    preambleSeparatorSpan,
    title,
    explicitSort,
    effectiveSort,
    explicitViewStyle,
    effectiveViewStyle,
    records
  };

  return {
    ok: true,
    doc: docParsed,
    warnings
  };
}
