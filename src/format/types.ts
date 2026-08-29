export interface Span {
  readonly start: number;
  readonly end: number;
}

export type EolText = "\n" | "\r\n";

export interface PhysicalLine {
  readonly index: number;
  readonly contentSpan: Span;
  readonly eolSpan: Span | null;
  readonly eol: EolText | null;
  readonly isTerminalEol: boolean;
}

export interface Diagnostic {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
  readonly span?: Span;
}

export type ExplicitSort = "asc" | "desc";
export type EffectiveSort = "asc" | "desc";

export interface ParsedFrontmatter {
  readonly lexicalSpan: Span;
  readonly ownedSpan: Span;
  readonly version: number;
  readonly sort: ExplicitSort | null;
  readonly sortValueSpan: Span | null;
  readonly sortLineIndex: number | null;
  readonly viewStyle: import("../settings/types").ThreadViewStyle | null;
  readonly viewStyleValueSpan: Span | null;
  readonly viewStyleLineIndex: number | null;
}

export interface ParsedField {
  readonly key: string;
  readonly value: string;
  readonly lineIndex: number;
  readonly keySpan: Span;
  readonly valueSpan: Span;
  readonly fullSpan: Span;
}

export interface RecordAuthorLabel {
  readonly displayValue: string;
  readonly comparisonValue: string;
}

export interface ParsedRecord {
  readonly type: "floor" | "reply";
  readonly id: string;
  readonly date: string;
  readonly favorite: boolean;
  readonly authorLabel: RecordAuthorLabel | null;
  readonly floorNumber: number | null; // Bound during physical ordering
  readonly headingSpan: Span;
  readonly metadataSpan: Span; // Span of metadata block including terminator
  readonly metadataTerminatorSpan: Span;
  readonly bodySpan: Span;
  readonly fullSpan: Span;
  readonly fields: readonly ParsedField[];
  readonly headingLineIndex: number;
  readonly bodyLineIndices: readonly number[];
  readonly idSpan: Span;
  readonly dateSpan: Span;
  readonly favoriteSpan: Span | null;
}

export interface ParsedThreadDocument {
  readonly rawText: string;
  readonly fileName: string;
  readonly bomSpan: Span | null;
  readonly physicalLines: readonly PhysicalLine[];
  readonly terminalEolSpan: Span;
  readonly frontmatter: ParsedFrontmatter | null;
  readonly preambleSpan: Span; // preambleOwnedSpan
  readonly preambleSeparatorSpan: Span | null;
  readonly title: string;
  readonly explicitSort: ExplicitSort | null;
  readonly effectiveSort: EffectiveSort;
  readonly explicitViewStyle: import("../settings/types").ThreadViewStyle | null;
  readonly effectiveViewStyle: import("../settings/types").ThreadViewStyle;
  readonly records: readonly ParsedRecord[];
}

export type ParseResult =
  | { readonly ok: true; readonly doc: ParsedThreadDocument; readonly warnings: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };
