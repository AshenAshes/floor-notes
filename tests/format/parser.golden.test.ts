import { describe, it, expect } from "vitest";
import { parseThreadDocument } from "../../src/format/parser";

describe("T-001/T-003/T-005/T-006/T-007/T-008/T-009/T-011/T-012/T-013/T-014/T-015: Golden parser tests", () => {
  it("should parse a fully valid document successfully", () => {
    const docText = `---
floor-notes: 1
floor-notes-sort: desc
---
# Thread Title

Some preamble text here.

## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]
[favorite:: true]

Floor body content.

### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: 2026-07-16 15:31:12]

Reply body content.
`;

    const res = parseThreadDocument(docText, "my-thread.md");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.doc.title).toBe("Thread Title");
      expect(res.doc.explicitSort).toBe("desc");
      expect(res.doc.effectiveSort).toBe("desc");
      expect(res.doc.records.length).toBe(2);

      const floor = res.doc.records[0]!;
      expect(floor.type).toBe("floor");
      expect(floor.id).toBe("floor-20260716-153012-abcde123");
      expect(floor.favorite).toBe(true);
      expect(floor.floorNumber).toBe(1);

      const reply = res.doc.records[1]!;
      expect(reply.type).toBe("reply");
      expect(reply.id).toBe("reply-20260716-153112-xyz09876");
      expect(reply.favorite).toBe(false);
      expect(reply.floorNumber).toBeNull();
    }
  });

  it("uses the supplied global sort order when the file has no explicit sort", () => {
    const docText = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Body.
`;

    const builtInDefault = parseThreadDocument(docText, "my-thread.md");
    const configuredDefault = parseThreadDocument(docText, "my-thread.md", "desc");

    expect(builtInDefault.ok).toBe(true);
    expect(configuredDefault.ok).toBe(true);
    if (builtInDefault.ok && configuredDefault.ok) {
      expect(builtInDefault.doc.explicitSort).toBeNull();
      expect(builtInDefault.doc.effectiveSort).toBe("asc");
      expect(configuredDefault.doc.effectiveSort).toBe("desc");
    }
  });

  it("uses an explicit view style before the default view style", () => {
    const docText = `---
floor-notes: 1
floor-notes-view-style: timeline
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Body.
`;

    const explicit = parseThreadDocument(docText, "my-thread.md", { defaultViewStyle: "paper" });
    const inherited = parseThreadDocument(docText.replace("floor-notes-view-style: timeline\n", ""), "my-thread.md", { defaultViewStyle: "paper" });

    expect(explicit.ok).toBe(true);
    expect(inherited.ok).toBe(true);
    if (explicit.ok && inherited.ok) {
      expect(explicit.doc.explicitViewStyle).toBe("timeline");
      expect(explicit.doc.effectiveViewStyle).toBe("timeline");
      expect(inherited.doc.explicitViewStyle).toBeNull();
      expect(inherited.doc.effectiveViewStyle).toBe("paper");
    }
  });

  it("preserves arbitrary date values without rejecting the document", () => {
    const docText = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 春分后第 3 日]

Body.

### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: ]

Reply body.
`;

    const res = parseThreadDocument(docText, "my-thread.md");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.doc.records[0]?.date).toBe("春分后第 3 日");
      expect(res.doc.records[1]?.date).toBe("");
    }
  });

  it("should return fatal error for unsupported version 2", () => {
    const docText = `---
floor-notes: 2
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Body.
`;
    const res = parseThreadDocument(docText, "my-thread.md");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostics.length).toBe(1);
      expect(res.diagnostics[0]!.code).toBe("FN-F002");
    }
  });

  it("should return fatal error for duplicate IDs", () => {
    const docText = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Body 1.

## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:32:00]

Body 2.
`;
    const res = parseThreadDocument(docText, "my-thread.md");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostics.some(d => d.code === "FN-F007")).toBe(true);
    }
  });

  it("should return fatal error for Reply before Floor", () => {
    const docText = `---
floor-notes: 1
---
### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: 2026-07-16 15:31:12]

Body.
`;
    const res = parseThreadDocument(docText, "my-thread.md");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostics.some(d => d.code === "FN-F003")).toBe(true);
    }
  });

  it("should return fatal error for invalid favorite in Reply", () => {
    const docText = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Body.

### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: 2026-07-16 15:31:12]
[favorite:: true]

Body.
`;
    const res = parseThreadDocument(docText, "my-thread.md");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.diagnostics.some(d => d.code === "FN-F010")).toBe(true);
    }
  });

  it("should generate empty body warning", () => {
    const docText = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]


`;
    const res = parseThreadDocument(docText, "my-thread.md");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.warnings.length).toBeGreaterThan(0);
      expect(res.warnings[0]!.code).toBe("FN-W003");
    }
  });
});
