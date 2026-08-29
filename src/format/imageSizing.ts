import { INITIAL_FENCE_STATE, updateFenceState } from "./fences";
import type { OperationResult } from "./operations";
import { parseThreadDocument } from "./parser";
import { parsePhysicalLines } from "./physicalLines";
import type { ParsedThreadDocument, Span } from "./types";

export type DirectImageSyntax = "wiki" | "markdown";

export interface ResizableImageOccurrence {
  readonly syntax: DirectImageSyntax;
  readonly relativeSpan: Span;
  readonly originalToken: string;
  readonly target: string;
  readonly targetSpan: Span;
  readonly sizeInsertionOffset: number;
  readonly sizeSegmentSpan: Span | null;
  readonly sizeValueSpan: Span | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface SetImageSizeIntent {
  readonly recordId: string;
  readonly expectedBody: string;
  readonly occurrence: ResizableImageOccurrence;
  readonly desiredWidth: number | null;
}

const IMAGE_EXTENSION = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const HTML_ELEMENT = /<([A-Za-z][A-Za-z0-9-]*)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const SIZE_SEGMENT = /^([1-9]\d*)(?:x([1-9]\d*))?$/;

function excludeRange(excluded: Uint8Array, start: number, end: number): void {
  excluded.fill(1, start, end);
}

function isEscaped(text: string, offset: number): boolean {
  let slashCount = 0;
  for (let index = offset - 1; index >= 0 && text[index] === "\\"; index--) {
    slashCount++;
  }
  return slashCount % 2 === 1;
}

function excludeFencedCode(body: string, excluded: Uint8Array): void {
  const { lines } = parsePhysicalLines(body);
  let fenceState = INITIAL_FENCE_STATE;
  for (const line of lines) {
    const lineText = body.substring(line.contentSpan.start, line.contentSpan.end);
    const nextState = updateFenceState(lineText, fenceState);
    if (fenceState.inFence || nextState.inFence) {
      excludeRange(excluded, line.contentSpan.start, line.eolSpan?.end ?? line.contentSpan.end);
    }
    fenceState = nextState;
  }
}

function excludePattern(body: string, excluded: Uint8Array, pattern: RegExp): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    excludeRange(excluded, match.index, match.index + match[0].length);
  }
}

function excludeHtml(body: string, excluded: Uint8Array): void {
  excludePattern(body, excluded, HTML_ELEMENT);
  excludePattern(
    body,
    excluded,
    /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^>\r\n]*)?\s*\/?>/g
  );
}

function excludeInlineCode(body: string, excluded: Uint8Array): void {
  let offset = 0;
  while (offset < body.length) {
    if (excluded[offset] !== 0 || body[offset] !== "`" || isEscaped(body, offset)) {
      offset++;
      continue;
    }

    let runEnd = offset + 1;
    while (body[runEnd] === "`") {
      runEnd++;
    }
    const marker = body.substring(offset, runEnd);
    let close = body.indexOf(marker, runEnd);
    while (close !== -1 && excluded[close] !== 0) {
      close = body.indexOf(marker, close + marker.length);
    }
    if (close === -1) {
      offset = runEnd;
      continue;
    }

    const end = close + marker.length;
    excludeRange(excluded, offset, end);
    offset = end;
  }
}

interface ExclusionMap {
  readonly excluded: Uint8Array;
  readonly hasVisibleHtmlImage: boolean;
}

function hasVisiblePattern(body: string, excluded: Uint8Array, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    if (isRangeVisible(excluded, match.index, match.index + match[0].length)) {
      return true;
    }
  }
  return false;
}

function createExclusionMap(body: string): ExclusionMap {
  const excluded = new Uint8Array(body.length);
  excludeFencedCode(body, excluded);
  excludePattern(body, excluded, /<!--[\s\S]*?-->/g);
  excludeInlineCode(body, excluded);
  const hasVisibleHtmlImage = hasVisiblePattern(body, excluded, /<img\b[^>\r\n]*>/gi);
  excludeHtml(body, excluded);
  return { excluded, hasVisibleHtmlImage };
}

function isRangeVisible(excluded: Uint8Array, start: number, end: number): boolean {
  for (let offset = start; offset < end; offset++) {
    if (excluded[offset] !== 0) {
      return false;
    }
  }
  return true;
}

function findUnescapedSequence(text: string, sequence: string, start: number): number {
  let offset = text.indexOf(sequence, start);
  while (offset !== -1 && isEscaped(text, offset)) {
    offset = text.indexOf(sequence, offset + sequence.length);
  }
  return offset;
}

function findUnescapedPipes(text: string, start: number, end: number): number[] {
  const offsets: number[] = [];
  for (let offset = start; offset < end; offset++) {
    if (text[offset] === "|" && !isEscaped(text, offset)) {
      offsets.push(offset);
    }
  }
  return offsets;
}

function parseSize(text: string): { readonly width: number; readonly height: number | null } | null {
  const match = SIZE_SEGMENT.exec(text);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = match[2] === undefined ? null : Number(match[2]);
  if (!Number.isSafeInteger(width) || (height !== null && !Number.isSafeInteger(height))) {
    return null;
  }
  return { width, height };
}

function indexWikiImages(
  body: string,
  excluded: Uint8Array,
  occurrences: ResizableImageOccurrence[]
): boolean {
  let isComplete = true;
  let offset = 0;
  while ((offset = body.indexOf("![[", offset)) !== -1) {
    if (excluded[offset] !== 0 || isEscaped(body, offset)) {
      offset += 3;
      continue;
    }

    const close = findUnescapedSequence(body, "]]", offset + 3);
    if (close === -1) {
      isComplete = false;
      break;
    }
    const end = close + 2;
    if (!isRangeVisible(excluded, offset, end)) {
      offset = end;
      continue;
    }

    const pipes = findUnescapedPipes(body, offset + 3, close);
    const targetEnd = pipes[0] ?? close;
    const target = body.substring(offset + 3, targetEnd);
    const lastPipe = pipes.at(-1);
    const parsedSize = lastPipe === undefined
      ? null
      : parseSize(body.substring(lastPipe + 1, close));
    if (target.includes("\n") || target.includes("\r") || !IMAGE_EXTENSION.test(target)) {
      isComplete = false;
      offset = end;
      continue;
    }

    occurrences.push({
      syntax: "wiki",
      relativeSpan: { start: offset, end },
      originalToken: body.substring(offset, end),
      target,
      targetSpan: { start: offset + 3, end: targetEnd },
      sizeInsertionOffset: close,
      sizeSegmentSpan: parsedSize && lastPipe !== undefined
        ? { start: lastPipe, end: close }
        : null,
      sizeValueSpan: parsedSize && lastPipe !== undefined
        ? { start: lastPipe + 1, end: close }
        : null,
      width: parsedSize?.width ?? null,
      height: parsedSize?.height ?? null
    });
    offset = end;
  }
  return isComplete;
}

function findClosingBracket(text: string, start: number): number {
  let nestedDepth = 0;
  for (let offset = start; offset < text.length; offset++) {
    if (isEscaped(text, offset)) {
      continue;
    }
    if (text[offset] === "[") {
      nestedDepth++;
    } else if (text[offset] === "]") {
      if (nestedDepth === 0) {
        return offset;
      }
      nestedDepth--;
    }
  }
  return -1;
}

function skipWhitespace(text: string, start: number): number {
  let offset = start;
  while (offset < text.length && /\s/.test(text[offset]!)) {
    offset++;
  }
  return offset;
}

function trimWhitespaceEnd(text: string, start: number, end: number): number {
  let offset = end;
  while (offset > start && /\s/.test(text[offset - 1]!)) {
    offset--;
  }
  return offset;
}

function hasUnescapedWhitespace(text: string, start: number, end: number): boolean {
  for (let offset = start; offset < end; offset++) {
    if (/\s/.test(text[offset]!) && !isEscaped(text, offset)) {
      return true;
    }
  }
  return false;
}

interface MarkdownDestination {
  readonly close: number;
  readonly targetSpan: Span;
}

function parseStrictMarkdownDestination(text: string, open: number): MarkdownDestination | null {
  let offset = skipWhitespace(text, open + 1);
  let targetStart = offset;
  let targetEnd = -1;

  if (text[offset] === "<") {
    targetStart = offset + 1;
    const angleClose = findUnescapedSequence(text, ">", targetStart);
    if (angleClose === -1 || text.substring(targetStart, angleClose).includes("\n")) {
      return null;
    }
    targetEnd = angleClose;
    offset = angleClose + 1;
  } else {
    let nestedDepth = 0;
    for (; offset < text.length; offset++) {
      if (isEscaped(text, offset)) {
        continue;
      }
      const character = text[offset]!;
      if (character === "(") {
        nestedDepth++;
      } else if (character === ")") {
        if (nestedDepth === 0) {
          targetEnd = offset;
          break;
        }
        nestedDepth--;
      } else if (/\s/.test(character) && nestedDepth === 0) {
        targetEnd = offset;
        break;
      }
    }
  }

  if (targetEnd <= targetStart) {
    return null;
  }
  const targetSpan = { start: targetStart, end: targetEnd };
  if (text[offset] === ")") {
    return { close: offset, targetSpan };
  }

  const titleStart = skipWhitespace(text, offset);
  if (titleStart === offset) {
    return null;
  }
  const titleOpen = text[titleStart];
  if (titleOpen !== "\"" && titleOpen !== "'" && titleOpen !== "(") {
    return null;
  }
  const titleClose = titleOpen === "(" ? ")" : titleOpen;

  const titleEnd = findUnescapedSequence(text, titleClose, titleStart + 1);
  if (titleEnd === -1) {
    return null;
  }
  const close = skipWhitespace(text, titleEnd + 1);
  return text[close] === ")" ? { close, targetSpan } : null;
}

function findRelaxedDestinationClose(text: string, open: number): number {
  let nestedDepth = 0;
  for (let offset = open + 1; offset < text.length; offset++) {
    if (text[offset] === "\n" || text[offset] === "\r") {
      return -1;
    }
    if (isEscaped(text, offset)) {
      continue;
    }
    if (text[offset] === "(") {
      nestedDepth++;
    } else if (text[offset] === ")") {
      if (nestedDepth === 0) {
        return offset;
      }
      nestedDepth--;
    }
  }
  return -1;
}

function findRelaxedQuotedTitleStart(
  text: string,
  contentStart: number,
  contentEnd: number
): number | null {
  const quote = text[contentEnd - 1];
  if ((quote !== "\"" && quote !== "'") || isEscaped(text, contentEnd - 1)) {
    return null;
  }
  for (let offset = contentEnd - 2; offset > contentStart; offset--) {
    if (
      text[offset] === quote
      && !isEscaped(text, offset)
      && /\s/.test(text[offset - 1]!)
    ) {
      return offset;
    }
  }
  return null;
}

function findRelaxedParenthesizedTitleStart(
  text: string,
  contentStart: number,
  contentEnd: number
): number | null {
  if (text[contentEnd - 1] !== ")" || isEscaped(text, contentEnd - 1)) {
    return null;
  }
  let nestedDepth = 0;
  for (let offset = contentEnd - 2; offset > contentStart; offset--) {
    if (isEscaped(text, offset)) {
      continue;
    }
    if (text[offset] === ")") {
      nestedDepth++;
    } else if (text[offset] === "(") {
      if (nestedDepth === 0) {
        return /\s/.test(text[offset - 1]!) ? offset : null;
      }
      nestedDepth--;
    }
  }
  return null;
}

function parseRelaxedMarkdownDestination(text: string, open: number): MarkdownDestination | null {
  const contentStart = skipWhitespace(text, open + 1);
  if (text[contentStart] === "<") {
    return null;
  }
  const close = findRelaxedDestinationClose(text, open);
  if (close === -1) {
    return null;
  }
  const contentEnd = trimWhitespaceEnd(text, contentStart, close);
  const titleStart = findRelaxedQuotedTitleStart(text, contentStart, contentEnd)
    ?? findRelaxedParenthesizedTitleStart(text, contentStart, contentEnd);
  const targetEnd = titleStart === null
    ? contentEnd
    : trimWhitespaceEnd(text, contentStart, titleStart);
  if (
    targetEnd <= contentStart
    || !hasUnescapedWhitespace(text, contentStart, targetEnd)
  ) {
    return null;
  }
  return {
    close,
    targetSpan: { start: contentStart, end: targetEnd }
  };
}

function parseMarkdownDestination(text: string, open: number): MarkdownDestination | null {
  return parseStrictMarkdownDestination(text, open)
    ?? parseRelaxedMarkdownDestination(text, open);
}

function indexMarkdownImages(
  body: string,
  excluded: Uint8Array,
  occurrences: ResizableImageOccurrence[]
): boolean {
  let isComplete = true;
  let offset = 0;
  while ((offset = body.indexOf("![", offset)) !== -1) {
    if (body.startsWith("![[", offset) || excluded[offset] !== 0 || isEscaped(body, offset)) {
      offset += 2;
      continue;
    }

    const labelEnd = findClosingBracket(body, offset + 2);
    if (labelEnd === -1 || body[labelEnd + 1] !== "(") {
      isComplete = false;
      offset += 2;
      continue;
    }
    const destination = parseMarkdownDestination(body, labelEnd + 1);
    if (!destination) {
      isComplete = false;
      offset += 2;
      continue;
    }

    const end = destination.close + 1;
    if (!isRangeVisible(excluded, offset, end)) {
      offset = end;
      continue;
    }
    const pipes = findUnescapedPipes(body, offset + 2, labelEnd);
    const lastPipe = pipes.at(-1);
    const parsedSize = lastPipe === undefined
      ? null
      : parseSize(body.substring(lastPipe + 1, labelEnd));
    const target = body.substring(destination.targetSpan.start, destination.targetSpan.end);

    occurrences.push({
      syntax: "markdown",
      relativeSpan: { start: offset, end },
      originalToken: body.substring(offset, end),
      target,
      targetSpan: destination.targetSpan,
      sizeInsertionOffset: labelEnd,
      sizeSegmentSpan: parsedSize && lastPipe !== undefined
        ? { start: lastPipe, end: labelEnd }
        : null,
      sizeValueSpan: parsedSize && lastPipe !== undefined
        ? { start: lastPipe + 1, end: labelEnd }
        : null,
      width: parsedSize?.width ?? null,
      height: parsedSize?.height ?? null
    });
    offset = end;
  }
  return isComplete;
}

interface DirectImageSourceIndex {
  readonly occurrences: readonly ResizableImageOccurrence[];
  readonly isComplete: boolean;
}

function createDirectImageSourceIndex(body: string): DirectImageSourceIndex {
  const { excluded, hasVisibleHtmlImage } = createExclusionMap(body);
  const occurrences: ResizableImageOccurrence[] = [];
  const hasOnlySupportedWikiImages = indexWikiImages(body, excluded, occurrences);
  const hasOnlySupportedMarkdownImages = indexMarkdownImages(body, excluded, occurrences);
  occurrences.sort((left, right) => left.relativeSpan.start - right.relativeSpan.start);
  return {
    occurrences,
    isComplete: !hasVisibleHtmlImage
      && hasOnlySupportedWikiImages
      && hasOnlySupportedMarkdownImages
  };
}

export function indexResizableImages(body: string): readonly ResizableImageOccurrence[] {
  return createDirectImageSourceIndex(body).occurrences;
}

export function normalizeMarkdownImageTargets(body: string): string {
  const targets = indexResizableImages(body)
    .filter((occurrence) => (
      occurrence.syntax === "markdown"
      && body[occurrence.targetSpan.start - 1] !== "<"
      && hasUnescapedWhitespace(body, occurrence.targetSpan.start, occurrence.targetSpan.end)
    ));
  let normalized = body;
  for (const occurrence of [...targets].reverse()) {
    let encodedTarget = "";
    for (let offset = occurrence.targetSpan.start; offset < occurrence.targetSpan.end; offset++) {
      const character = body[offset]!;
      encodedTarget += /\s/.test(character) && !isEscaped(body, offset)
        ? encodeURIComponent(character)
        : character;
    }
    normalized = normalized.substring(0, occurrence.targetSpan.start)
      + encodedTarget
      + normalized.substring(occurrence.targetSpan.end);
  }
  return normalized;
}

export function resolveImageResizeOccurrences(
  body: string,
  renderedImageCount: number
): readonly ResizableImageOccurrence[] | null {
  const index = createDirectImageSourceIndex(body);
  return index.isComplete && index.occurrences.length === renderedImageCount
    ? index.occurrences
    : null;
}

function sameSpan(left: Span | null, right: Span | null): boolean {
  return left?.start === right?.start && left?.end === right?.end;
}

function isSameOccurrence(
  current: ResizableImageOccurrence,
  expected: ResizableImageOccurrence
): boolean {
  return current.syntax === expected.syntax
    && sameSpan(current.relativeSpan, expected.relativeSpan)
    && current.originalToken === expected.originalToken
    && current.target === expected.target
    && sameSpan(current.targetSpan, expected.targetSpan)
    && current.sizeInsertionOffset === expected.sizeInsertionOffset
    && sameSpan(current.sizeSegmentSpan, expected.sizeSegmentSpan)
    && sameSpan(current.sizeValueSpan, expected.sizeValueSpan)
    && current.width === expected.width
    && current.height === expected.height;
}

export function setImageSize(
  doc: ParsedThreadDocument,
  intent: SetImageSizeIntent
): OperationResult {
  const record = doc.records.find((candidate) => candidate.id === intent.recordId);
  if (!record) {
    return { type: "missing", message: `Record '${intent.recordId}' not found.` };
  }

  const currentBody = doc.rawText.substring(record.bodySpan.start, record.bodySpan.end);
  if (currentBody !== intent.expectedBody) {
    return { type: "conflict", reason: "The record body has been modified externally." };
  }

  const currentOccurrence = indexResizableImages(currentBody).find((candidate) => (
    sameSpan(candidate.relativeSpan, intent.occurrence.relativeSpan)
  ));
  if (!currentOccurrence || !isSameOccurrence(currentOccurrence, intent.occurrence)) {
    return { type: "conflict", reason: "The image source occurrence has changed." };
  }
  if (intent.desiredWidth === null && currentOccurrence.sizeSegmentSpan === null) {
    return { type: "no-op", message: "Image size is already unset." };
  }
  if (
    intent.desiredWidth !== null
    && (!Number.isInteger(intent.desiredWidth) || intent.desiredWidth < 20)
  ) {
    return { type: "conflict", reason: "The image width is invalid." };
  }
  if (
    intent.desiredWidth !== null
    && currentOccurrence.width === intent.desiredWidth
    && currentOccurrence.height === null
  ) {
    return { type: "no-op", message: "Image width is already identical to desired value." };
  }

  const isReset = intent.desiredWidth === null;
  const relativeStart = isReset
    ? currentOccurrence.sizeSegmentSpan!.start
    : currentOccurrence.sizeValueSpan?.start ?? currentOccurrence.sizeInsertionOffset;
  const relativeEnd = isReset
    ? currentOccurrence.sizeSegmentSpan!.end
    : currentOccurrence.sizeValueSpan?.end ?? currentOccurrence.sizeInsertionOffset;
  const replacement = isReset
    ? ""
    : currentOccurrence.sizeValueSpan
      ? String(intent.desiredWidth)
      : `|${intent.desiredWidth}`;
  const tokenMutationStart = relativeStart - currentOccurrence.relativeSpan.start;
  const tokenMutationEnd = relativeEnd - currentOccurrence.relativeSpan.start;
  const updatedToken = normalizeMarkdownImageTargets(
    currentOccurrence.originalToken.substring(0, tokenMutationStart)
      + replacement
      + currentOccurrence.originalToken.substring(tokenMutationEnd)
  );
  const mutationStart = record.bodySpan.start + currentOccurrence.relativeSpan.start;
  const mutationEnd = record.bodySpan.start + currentOccurrence.relativeSpan.end;
  const newText = doc.rawText.substring(0, mutationStart)
    + updatedToken
    + doc.rawText.substring(mutationEnd);
  const parseResult = parseThreadDocument(newText, doc.fileName);
  if (!parseResult.ok) {
    return { type: "invalid", diagnostics: parseResult.diagnostics };
  }

  const updatedRecord = parseResult.doc.records.find((candidate) => candidate.id === intent.recordId);
  if (!updatedRecord) {
    return { type: "conflict", reason: "The updated image record could not be verified." };
  }
  const updatedBody = newText.substring(updatedRecord.bodySpan.start, updatedRecord.bodySpan.end);
  const updatedOccurrence = indexResizableImages(updatedBody).find((candidate) => (
    candidate.relativeSpan.start === currentOccurrence.relativeSpan.start
      && candidate.syntax === currentOccurrence.syntax
      && candidate.originalToken === updatedToken
  ));
  if (!updatedOccurrence) {
    return { type: "conflict", reason: "The updated image occurrence could not be verified." };
  }

  return { type: "applied", newText, newDoc: parseResult.doc };
}
