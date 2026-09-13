import type { ParsedThreadDocument } from "../format/types";
import { t } from "../util/locale";

export interface OutlineRecordSummary {
  readonly id: string;
  readonly text: string;
}

/** Plain text only: outline labels never render user-supplied HTML. */
export function summarizeOutlineBody(body: string): string {
  const withoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
  const paragraphs = withoutComments.trim().split(/\r?\n\s*\r?\n/);
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (/^(?:```|~~~)/.test(trimmed)) return t("outlineCode");
    const text = trimmed
      .replace(/!\[\[([^\]]+)\]\]/g, (_match, target: string) => {
        const alias = target.split("|").slice(1).find((part) => !/^\d+(?:x\d+)?$/.test(part));
        return alias || t("outlineImage");
      })
      .replace(/!\[([^\]]*)\]\([^\n]*?\)/g, (_match, alt: string) => alt || t("outlineImage"))
      .replace(/\[\[([^\]]+)\]\]/g, (_match, target: string) => target.split("|").at(-1) ?? target)
      .replace(/\[([^\]]+)\]\([^\n]*?\)/g, "$1")
      .replace(/<[^>]*>/g, "")
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, "")
      .replace(/\[([ xX])\]\s*/g, "")
      .replace(/[*_~`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      const characters = Array.from(text);
      return characters.length > 60 ? characters.slice(0, 60).join("") + "…" : text;
    }
  }
  return t("outlineEmpty");
}

export function buildOutlineSummaries(doc: ParsedThreadDocument): Map<number, OutlineRecordSummary> {
  return new Map(doc.records.map((record) => [record.headingLineIndex, {
    id: record.id,
    text: summarizeOutlineBody(doc.rawText.slice(record.bodySpan.start, record.bodySpan.end))
  }]));
}
