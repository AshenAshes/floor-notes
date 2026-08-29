import { describe, expect, it } from "vitest";
import { parseThreadDocument } from "../../src/format/parser";

describe("T-074: Record author label extraction", () => {
  it("derives the first non-empty lowercase author label without reserving or rewriting its fields", () => {
    const ideographicSpace = "\u3000";
    const noBreakSpace = "\u00a0";
    const decomposedRingA = "A\u030A";
    const source = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]
[author:: ${ideographicSpace}]
[Author:: ignored]
[author:: ${noBreakSpace}${decomposedRingA}${noBreakSpace}]
[author:: Later]

Body.
`;

    const result = parseThreadDocument(source, "thread.md");

    expect(result.ok).toBe(true);
    if (result.ok) {
      const floor = result.doc.records[0]!;
      expect(floor.authorLabel).toEqual({
        displayValue: decomposedRingA,
        comparisonValue: "Å"
      });
      expect(floor.fields.map(({ key, value }) => ({ key, value }))).toEqual([
        { key: "id", value: "floor-20260716-153012-abcde123" },
        { key: "date", value: "2026-07-16 15:30:12" },
        { key: "author", value: ideographicSpace },
        { key: "Author", value: "ignored" },
        { key: "author", value: `${noBreakSpace}${decomposedRingA}${noBreakSpace}` },
        { key: "author", value: "Later" }
      ]);
      expect(result.doc.rawText).toBe(source);
    }
  });

  it("keeps missing, differently cased, and whitespace-only author fields ineffective", () => {
    const noBreakSpace = "\u00a0";
    const longEmojiAuthor = `${"长名字".repeat(40)}👩🏽‍💻`;
    const source = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]
[Author:: Alice]
[author:: ${noBreakSpace}]

Floor body.

### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: 2026-07-16 15:31:12]
[author:: ${longEmojiAuthor}]

Reply body.

### Reply
[id:: reply-20260716-153212-qrstvwxy]
[date:: 2026-07-16 15:32:12]

Reply without author.
`;

    const result = parseThreadDocument(source, "thread.md");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.records[0]?.authorLabel).toBeNull();
      expect(result.doc.records[1]?.authorLabel).toEqual({
        displayValue: longEmojiAuthor,
        comparisonValue: longEmojiAuthor
      });
      expect(result.doc.records[2]?.authorLabel).toBeNull();
      expect(result.doc.rawText).toBe(source);
    }
  });
});
