import { generateRecordId } from "../util/ids";
import { formatLocalDate } from "../util/date";
import { isUnicodeWhitespace } from "../util/unicodeWhitespace";
import { parseThreadDocument } from "./parser";
import { findRecordSeparatorSpan } from "./separators";
import { ParsedThreadDocument, ParsedRecord, Diagnostic } from "./types";
import { ThreadViewStyle } from "../settings/types";

export type OperationResult =
  | { readonly type: "applied"; readonly newText: string; readonly newDoc: ParsedThreadDocument }
  | { readonly type: "no-op"; readonly message?: string }
  | { readonly type: "conflict"; readonly reason: string }
  | { readonly type: "invalid"; readonly diagnostics: readonly Diagnostic[] }
  | { readonly type: "missing"; readonly message: string };

export function getPreferredEol(doc: ParsedThreadDocument): string {
  let lfCount = 0;
  let crlfCount = 0;
  for (const line of doc.physicalLines) {
    if (line.eolSpan) {
      const eolText = doc.rawText.substring(line.eolSpan.start, line.eolSpan.end);
      if (eolText === "\r\n") crlfCount++;
      else if (eolText === "\n") lfCount++;
    }
  }
  return crlfCount > lfCount ? "\r\n" : "\n";
}

export function normalizeEols(text: string, eol: string): string {
  return text.replace(/\r\n|\n|\r/g, eol);
}

// 1. AddFloor
export function addFloor(doc: ParsedThreadDocument, body: string, date: Date): OperationResult {
  let isEmpty = true;
  for (let i = 0; i < body.length; i++) {
    if (!isUnicodeWhitespace(body[i]!)) {
      isEmpty = false;
      break;
    }
  }
  if (isEmpty) {
    return { type: "conflict", reason: "Body cannot be empty." };
  }

  let attempts = 0;
  let floorId = "";
  while (attempts < 16) {
    floorId = generateRecordId("floor", date);
    if (!doc.records.some(r => r.id === floorId)) {
      break;
    }
    attempts++;
  }
  if (attempts >= 16) {
    return { type: "conflict", reason: "Failed to generate unique Floor ID after 16 attempts due to collision." };
  }

  const preferredEol = getPreferredEol(doc);
  const normalizedBody = normalizeEols(body, preferredEol);

  const metaBlock = `[id:: ${floorId}]${preferredEol}[date:: ${formatLocalDate(date)}]${preferredEol}${preferredEol}`;
  const recordText = `## Floor${preferredEol}${metaBlock}${normalizedBody}`;

  const contentEnd = doc.terminalEolSpan.start;
  const leftText = doc.rawText.substring(0, contentEnd);
  const rightText = doc.rawText.substring(contentEnd);

  let terminalAppend = "";
  if (doc.terminalEolSpan.start === doc.terminalEolSpan.end) {
    if (normalizedBody.endsWith("\n") || normalizedBody.endsWith("\r")) {
      terminalAppend = preferredEol;
    }
  }

  const newText = leftText + preferredEol + preferredEol + recordText + terminalAppend + rightText;

  const parseRes = parseThreadDocument(newText, doc.fileName);
  if (!parseRes.ok) {
    return { type: "invalid", diagnostics: parseRes.diagnostics };
  }

  return {
    type: "applied",
    newText,
    newDoc: parseRes.doc
  };
}

// 2. AddReply
export function addReply(doc: ParsedThreadDocument, targetFloorId: string, body: string, date: Date): OperationResult {
  let isEmpty = true;
  for (let i = 0; i < body.length; i++) {
    if (!isUnicodeWhitespace(body[i]!)) {
      isEmpty = false;
      break;
    }
  }
  if (isEmpty) {
    return { type: "conflict", reason: "Body cannot be empty." };
  }

  const floorIdx = doc.records.findIndex(r => r.type === "floor" && r.id === targetFloorId);
  if (floorIdx === -1) {
    return { type: "missing", message: `Target Floor '${targetFloorId}' not found.` };
  }

  let lastRecordIndex = floorIdx;
  while (lastRecordIndex + 1 < doc.records.length && doc.records[lastRecordIndex + 1]!.type === "reply") {
    lastRecordIndex++;
  }

  const lastRecord = doc.records[lastRecordIndex]!;
  const isLastInDoc = lastRecordIndex === doc.records.length - 1;

  let attempts = 0;
  let replyId = "";
  while (attempts < 16) {
    replyId = generateRecordId("reply", date);
    if (!doc.records.some(r => r.id === replyId)) {
      break;
    }
    attempts++;
  }
  if (attempts >= 16) {
    return { type: "conflict", reason: "Failed to generate unique Reply ID after 16 attempts due to collision." };
  }

  const preferredEol = getPreferredEol(doc);
  const normalizedBody = normalizeEols(body, preferredEol);
  const metaBlock = `[id:: ${replyId}]${preferredEol}[date:: ${formatLocalDate(date)}]${preferredEol}${preferredEol}`;
  const recordText = `### Reply${preferredEol}${metaBlock}${normalizedBody}`;

  let newText = "";

  if (isLastInDoc) {
    const contentEnd = doc.terminalEolSpan.start;
    const leftText = doc.rawText.substring(0, contentEnd);
    const rightText = doc.rawText.substring(contentEnd);

    let terminalAppend = "";
    if (doc.terminalEolSpan.start === doc.terminalEolSpan.end) {
      if (normalizedBody.endsWith("\n") || normalizedBody.endsWith("\r")) {
        terminalAppend = preferredEol;
      }
    }

    newText = leftText + preferredEol + preferredEol + recordText + terminalAppend + rightText;
  } else {
    const nextRecord = doc.records[lastRecordIndex + 1]!;
    const insertOffset = nextRecord.headingSpan.start;

    const sep = findRecordSeparatorSpan(doc.rawText, insertOffset, lastRecord.bodySpan.start);
    
    const leftText = doc.rawText.substring(0, insertOffset);
    const rightText = doc.rawText.substring(insertOffset);

    const padCount = Math.max(0, 2 - sep.eolCount);
    const prefixPadding = preferredEol.repeat(padCount);
    const suffixPadding = preferredEol + preferredEol;

    newText = leftText.substring(0, insertOffset) + prefixPadding + recordText + suffixPadding + rightText;
  }

  const parseRes = parseThreadDocument(newText, doc.fileName);
  if (!parseRes.ok) {
    return { type: "invalid", diagnostics: parseRes.diagnostics };
  }

  return {
    type: "applied",
    newText,
    newDoc: parseRes.doc
  };
}

// Helper for Edit
function editRecordBody(
  doc: ParsedThreadDocument,
  targetId: string,
  expectedBody: string,
  newBody: string,
  allowedType: "floor" | "reply"
): OperationResult {
  let isEmpty = true;
  for (let i = 0; i < newBody.length; i++) {
    if (!isUnicodeWhitespace(newBody[i]!)) {
      isEmpty = false;
      break;
    }
  }
  if (isEmpty) {
    return { type: "conflict", reason: "Body cannot be empty." };
  }

  const rec = doc.records.find(r => r.id === targetId);
  if (!rec) {
    return { type: "missing", message: `Record '${targetId}' not found.` };
  }

  if (rec.type !== allowedType) {
    return { type: "conflict", reason: `Record type mismatch for '${targetId}'.` };
  }

  const currentBody = doc.rawText.substring(rec.bodySpan.start, rec.bodySpan.end);
  const preferredEol = getPreferredEol(doc);
  const normalizedNew = normalizeEols(newBody, preferredEol);
  const normalizedExpected = normalizeEols(expectedBody, preferredEol);
  const normalizedCurrent = normalizeEols(currentBody, preferredEol);

  if (normalizedNew === normalizedCurrent) {
    return { type: "no-op", message: "Body is already identical to desired value." };
  }

  if (normalizedCurrent !== normalizedExpected) {
    return { type: "conflict", reason: "The record body has been modified externally." };
  }

  const leftText = doc.rawText.substring(0, rec.bodySpan.start);
  let rightText = doc.rawText.substring(rec.bodySpan.end);

  const isLast = doc.records[doc.records.length - 1]?.id === targetId;
  let terminalAppend = "";
  if (isLast && doc.terminalEolSpan.start === doc.terminalEolSpan.end) {
    if (normalizedNew.endsWith("\n") || normalizedNew.endsWith("\r")) {
      terminalAppend = preferredEol;
    }
  }

  const newText = leftText + normalizedNew + terminalAppend + rightText;

  const parseRes = parseThreadDocument(newText, doc.fileName);
  if (!parseRes.ok) {
    return { type: "invalid", diagnostics: parseRes.diagnostics };
  }

  return {
    type: "applied",
    newText,
    newDoc: parseRes.doc
  };
}

// 3. EditFloor
export function editFloor(doc: ParsedThreadDocument, targetId: string, expectedBody: string, newBody: string): OperationResult {
  return editRecordBody(doc, targetId, expectedBody, newBody, "floor");
}

// 4. EditReply
export function editReply(doc: ParsedThreadDocument, targetId: string, expectedBody: string, newBody: string): OperationResult {
  return editRecordBody(doc, targetId, expectedBody, newBody, "reply");
}

// 5. SetFavorite
export function setFavorite(doc: ParsedThreadDocument, floorId: string, desired: boolean): OperationResult {
  const floor = doc.records.find(r => r.id === floorId);
  if (!floor) {
    return { type: "missing", message: `Floor '${floorId}' not found.` };
  }

  if (floor.type !== "floor") {
    return { type: "conflict", reason: `Cannot set favorite on a Reply record '${floorId}'.` };
  }

  if (floor.favorite === desired) {
    return { type: "no-op", message: `Favorite is already set to ${desired}.` };
  }

  let newText = "";
  if (desired) {
    // Insert [favorite:: true] after date field line
    const dateField = floor.fields.find(f => f.key === "date");
    if (!dateField) {
      return { type: "conflict", reason: "Date field is missing from Floor metadata." };
    }
    const dateLine = doc.physicalLines[dateField.lineIndex]!;
    const eolText = dateLine.eolSpan ? doc.rawText.substring(dateLine.eolSpan.start, dateLine.eolSpan.end) : "\n";

    const insertOffset = dateLine.eolSpan ? dateLine.eolSpan.end : dateLine.contentSpan.end;
    const leftText = doc.rawText.substring(0, insertOffset);
    const rightText = doc.rawText.substring(insertOffset);

    newText = leftText + `[favorite:: true]${eolText}` + rightText;
  } else {
    // Remove favorite field line
    const favField = floor.fields.find(f => f.key === "favorite");
    if (!favField) {
      return { type: "no-op" };
    }
    const favLine = doc.physicalLines[favField.lineIndex]!;
    const start = favLine.contentSpan.start;
    const end = favLine.eolSpan ? favLine.eolSpan.end : favLine.contentSpan.end;

    newText = doc.rawText.substring(0, start) + doc.rawText.substring(end);
  }

  const parseRes = parseThreadDocument(newText, doc.fileName);
  if (!parseRes.ok) {
    return { type: "invalid", diagnostics: parseRes.diagnostics };
  }

  return {
    type: "applied",
    newText,
    newDoc: parseRes.doc
  };
}

// Helper for terminal EOL repair during deletion
function checkTerminalEolOnDeletion(newText: string, doc: ParsedThreadDocument): string {
  if (doc.terminalEolSpan.start === doc.terminalEolSpan.end) {
    const preferredEol = getPreferredEol(doc);
    if (newText.endsWith("\n") || newText.endsWith("\r")) {
      return newText + preferredEol;
    }
  }
  return newText;
}

// 6. DeleteReply
export function deleteReply(doc: ParsedThreadDocument, targetId: string, expectedRevision: string): OperationResult {
  const replyIdx = doc.records.findIndex(r => r.id === targetId);
  if (replyIdx === -1) {
    return { type: "missing", message: `Reply '${targetId}' not found.` };
  }

  const reply = doc.records[replyIdx]!;
  if (reply.type !== "reply") {
    return { type: "conflict", reason: `Record '${targetId}' is not a Reply.` };
  }

  const currentRevision = doc.rawText.substring(reply.fullSpan.start, reply.fullSpan.end);
  if (currentRevision !== expectedRevision) {
    return { type: "conflict", reason: "Target Reply revision has changed." };
  }

  const isLast = replyIdx === doc.records.length - 1;
  let newText = "";

  if (!isLast) {
    // Delete target fullSpan and subsequent separator
    const nextRec = doc.records[replyIdx + 1]!;
    newText = doc.rawText.substring(0, reply.fullSpan.start) + doc.rawText.substring(nextRec.headingSpan.start);
  } else {
    // Delete target fullSpan and preceding separator
    const prevRec = doc.records[replyIdx - 1]!;
    newText = doc.rawText.substring(0, prevRec.fullSpan.end) + doc.rawText.substring(reply.fullSpan.end);
  }

  newText = checkTerminalEolOnDeletion(newText, doc);

  const parseRes = parseThreadDocument(newText, doc.fileName);
  if (!parseRes.ok) {
    return { type: "invalid", diagnostics: parseRes.diagnostics };
  }

  return {
    type: "applied",
    newText,
    newDoc: parseRes.doc
  };
}

// 7. DeleteFloor
export function deleteFloor(
  doc: ParsedThreadDocument,
  targetId: string,
  expectedRevisions: readonly { readonly id: string; readonly revision: string }[]
): OperationResult {
  const floorIdx = doc.records.findIndex(r => r.id === targetId);
  if (floorIdx === -1) {
    return { type: "missing", message: `Floor '${targetId}' not found.` };
  }

  const floor = doc.records[floorIdx]!;
  if (floor.type !== "floor") {
    return { type: "conflict", reason: `Record '${targetId}' is not a Floor.` };
  }

  // Collect Floor and all consecutive Replies following it
  const groupRecords: ParsedRecord[] = [floor];
  let idx = floorIdx + 1;
  while (idx < doc.records.length && doc.records[idx]!.type === "reply") {
    groupRecords.push(doc.records[idx]!);
    idx++;
  }

  // Validate group revisions
  if (groupRecords.length !== expectedRevisions.length) {
    return { type: "conflict", reason: "Group size has changed." };
  }

  for (let i = 0; i < groupRecords.length; i++) {
    const rec = groupRecords[i]!;
    const exp = expectedRevisions[i]!;
    const currentRevision = doc.rawText.substring(rec.fullSpan.start, rec.fullSpan.end);
    if (rec.id !== exp.id || currentRevision !== exp.revision) {
      return { type: "conflict", reason: `Revision mismatch for record '${rec.id}'.` };
    }
  }

  const firstRec = groupRecords[0]!;
  const lastRec = groupRecords[groupRecords.length - 1]!;
  const isFirst = floorIdx === 0;
  const isLast = doc.records.indexOf(lastRec) === doc.records.length - 1;
  const isOnly = isFirst && isLast;

  let newText = "";

  if (isOnly) {
    // Delete唯一Floor group: delete preambleSeparatorSpan + group
    const start = doc.preambleSeparatorSpan ? doc.preambleSeparatorSpan.start : firstRec.fullSpan.start;
    newText = doc.rawText.substring(0, start) + doc.rawText.substring(lastRec.fullSpan.end);
  } else if (isLast) {
    // Delete last group: delete preceding separator + group
    const prevRec = doc.records[floorIdx - 1]!;
    newText = doc.rawText.substring(0, prevRec.fullSpan.end) + doc.rawText.substring(lastRec.fullSpan.end);
  } else {
    // Delete non-last group: delete group + subsequent separator
    const nextRec = doc.records[doc.records.indexOf(lastRec) + 1]!;
    newText = doc.rawText.substring(0, firstRec.fullSpan.start) + doc.rawText.substring(nextRec.headingSpan.start);
  }

  newText = checkTerminalEolOnDeletion(newText, doc);

  const parseRes = parseThreadDocument(newText, doc.fileName);
  if (!parseRes.ok) {
    return { type: "invalid", diagnostics: parseRes.diagnostics };
  }

  return {
    type: "applied",
    newText,
    newDoc: parseRes.doc
  };
}

// 8. SetSortOrder
export function setViewStyle(doc: ParsedThreadDocument, desired: ThreadViewStyle): OperationResult {
  const frontmatter = doc.frontmatter;
  if (!frontmatter) {
    return { type: "conflict", reason: "Frontmatter is missing." };
  }

  if (frontmatter.viewStyle === desired) {
    return { type: "no-op", message: `View style is already '${desired}'.` };
  }

  let newText = "";
  if (frontmatter.viewStyleValueSpan === null) {
    let versionLineIdx = -1;
    for (let i = 0; i < doc.physicalLines.length; i++) {
      const line = doc.physicalLines[i]!;
      const lineText = doc.rawText.substring(line.contentSpan.start, line.contentSpan.end);
      if (lineText.includes("floor-notes:")) {
        versionLineIdx = i;
        break;
      }
    }

    if (versionLineIdx === -1) {
      return { type: "conflict", reason: "floor-notes version line not found in frontmatter." };
    }

    const versionLine = doc.physicalLines[versionLineIdx]!;
    const eolText = versionLine.eolSpan ? doc.rawText.substring(versionLine.eolSpan.start, versionLine.eolSpan.end) : "\n";
    const insertOffset = versionLine.eolSpan ? versionLine.eolSpan.end : versionLine.contentSpan.end;
    newText =
      doc.rawText.substring(0, insertOffset) +
      `floor-notes-view-style: ${desired}${eolText}` +
      doc.rawText.substring(insertOffset);
  } else {
    const { start, end } = frontmatter.viewStyleValueSpan;
    newText = doc.rawText.substring(0, start) + desired + doc.rawText.substring(end);
  }

  const parseRes = parseThreadDocument(newText, doc.fileName);
  if (!parseRes.ok) {
    return { type: "invalid", diagnostics: parseRes.diagnostics };
  }

  return { type: "applied", newText, newDoc: parseRes.doc };
}

// 9. SetSortOrder
export function setSortOrder(doc: ParsedThreadDocument, desired: "asc" | "desc"): OperationResult {
  const frontmatter = doc.frontmatter;
  if (!frontmatter) {
    return { type: "conflict", reason: "Frontmatter is missing." };
  }

  if (frontmatter.sort === desired) {
    return { type: "no-op", message: `Sort order is already '${desired}'.` };
  }

  let newText = "";
  if (frontmatter.sortValueSpan === null) {
    // sort is missing: insert floor-notes-sort: <desired> right after floor-notes line
    // Find version line
    let versionLineIdx = -1;
    for (let i = 0; i < doc.physicalLines.length; i++) {
      const line = doc.physicalLines[i]!;
      const lineText = doc.rawText.substring(line.contentSpan.start, line.contentSpan.end);
      if (lineText.includes("floor-notes:")) {
        versionLineIdx = i;
        break;
      }
    }

    if (versionLineIdx === -1) {
      return { type: "conflict", reason: "floor-notes version line not found in frontmatter." };
    }

    const versionLine = doc.physicalLines[versionLineIdx]!;
    const eolText = versionLine.eolSpan ? doc.rawText.substring(versionLine.eolSpan.start, versionLine.eolSpan.end) : "\n";
    const insertOffset = versionLine.eolSpan ? versionLine.eolSpan.end : versionLine.contentSpan.end;

    newText =
      doc.rawText.substring(0, insertOffset) +
      `floor-notes-sort: ${desired}${eolText}` +
      doc.rawText.substring(insertOffset);
  } else {
    // sort is present: replace scalar value span
    const start = frontmatter.sortValueSpan.start;
    const end = frontmatter.sortValueSpan.end;
    newText = doc.rawText.substring(0, start) + desired + doc.rawText.substring(end);
  }

  const parseRes = parseThreadDocument(newText, doc.fileName);
  if (!parseRes.ok) {
    return { type: "invalid", diagnostics: parseRes.diagnostics };
  }

  return {
    type: "applied",
    newText,
    newDoc: parseRes.doc
  };
}
