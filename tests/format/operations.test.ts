import { describe, it, expect } from "vitest";
import { parseThreadDocument } from "../../src/format/parser";
import * as ops from "../../src/format/operations";

const validBaseDoc = `---
floor-notes: 1
---
# Thread Title

## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Floor 1 body.
`;

describe("Task 4: Pure source-span operations tests", () => {
  it("T-017 / T-018: AddFloor basic and empty doc", () => {
    const parseRes = parseThreadDocument(validBaseDoc, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const res = ops.addFloor(parseRes.doc, "New Floor Body", new Date(2026, 6, 16, 15, 35, 0));
      expect(res.type).toBe("applied");
      if (res.type === "applied") {
        expect(res.newDoc.records.length).toBe(2);
        expect(res.newDoc.records[1]!.type).toBe("floor");
        expect(res.newDoc.records[1]!.floorNumber).toBe(2);
      }
    }
  });

  it("appends a Floor ending in an EOL without doubling a missing terminal EOL", () => {
    const docText = validBaseDoc.slice(0, -1);
    const parseRes = parseThreadDocument(docText, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const res = ops.addFloor(parseRes.doc, "New Floor Body\n", new Date(2026, 6, 16, 15, 35, 0));
      expect(res.type).toBe("applied");
      if (res.type === "applied") {
        const floorId = res.newDoc.records[1]!.id;
        expect(res.newText).toBe(
          `${docText}\n\n## Floor\n[id:: ${floorId}]\n[date:: 2026-07-16 15:35:00]\n\nNew Floor Body\n`
        );
      }
    }
  });

  it("T-019 / T-020: AddReply to last record and between records", () => {
    const parseRes = parseThreadDocument(validBaseDoc, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const res = ops.addReply(parseRes.doc, "floor-20260716-153012-abcde123", "Reply Body", new Date(2026, 6, 16, 15, 36, 0));
      expect(res.type).toBe("applied");
      if (res.type === "applied") {
        expect(res.newDoc.records.length).toBe(2);
        expect(res.newDoc.records[1]!.type).toBe("reply");
      }
    }
  });

  it("appends a last Reply ending in an EOL without doubling a missing terminal EOL", () => {
    const docText = validBaseDoc.slice(0, -1);
    const parseRes = parseThreadDocument(docText, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const floorId = parseRes.doc.records[0]!.id;
      const res = ops.addReply(parseRes.doc, floorId, "Reply Body\n", new Date(2026, 6, 16, 15, 36, 0));
      expect(res.type).toBe("applied");
      if (res.type === "applied") {
        const replyId = res.newDoc.records[1]!.id;
        expect(res.newText).toBe(
          `${docText}\n\n### Reply\n[id:: ${replyId}]\n[date:: 2026-07-16 15:36:00]\n\nReply Body\n`
        );
      }
    }
  });

  it("T-021 / T-022 / T-023: EditFloor / EditReply no-op and conflict", () => {
    const parseRes = parseThreadDocument(validBaseDoc, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const floor = parseRes.doc.records[0]!;
      
      // Idempotent no-op
      const resNoOp = ops.editFloor(parseRes.doc, floor.id, "Floor 1 body.", "Floor 1 body.");
      expect(resNoOp.type).toBe("no-op");

      // Valid edit
      const resApplied = ops.editFloor(parseRes.doc, floor.id, "Floor 1 body.", "Updated Body");
      expect(resApplied.type).toBe("applied");
      if (resApplied.type === "applied") {
        expect(resApplied.newDoc.records[0]!.id).toBe(floor.id);
        const currentBody = resApplied.newText.substring(
          resApplied.newDoc.records[0]!.bodySpan.start,
          resApplied.newDoc.records[0]!.bodySpan.end
        );
        expect(currentBody).toBe("Updated Body");
      }

      // Conflict
      const resConflict = ops.editFloor(parseRes.doc, floor.id, "Stale Expected Body", "Updated Body");
      expect(resConflict.type).toBe("conflict");
    }
  });

  it.each(["Updated Body", "Updated Body\n"])(
    "repairs a missing terminal EOL when the edited body is %j",
    (newBody) => {
      const docText = validBaseDoc.slice(0, -1);
      const parseRes = parseThreadDocument(docText, "thread.md");
      expect(parseRes.ok).toBe(true);
      if (parseRes.ok) {
        const floor = parseRes.doc.records[0]!;
        const res = ops.editFloor(parseRes.doc, floor.id, "Floor 1 body.", newBody);
        expect(res.type).toBe("applied");
        if (res.type === "applied") {
          expect(res.newText).toBe(docText.replace("Floor 1 body.", "Updated Body\n"));
        }
      }
    }
  );

  it("T-024 / T-025: SetFavorite on and off", () => {
    const parseRes = parseThreadDocument(validBaseDoc, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const floor = parseRes.doc.records[0]!;
      expect(floor.favorite).toBe(false);

      // SetFavorite on
      const resOn = ops.setFavorite(parseRes.doc, floor.id, true);
      expect(resOn.type).toBe("applied");
      if (resOn.type === "applied") {
        expect(resOn.newDoc.records[0]!.favorite).toBe(true);
        expect(resOn.newText).toContain("[favorite:: true]");

        // SetFavorite off
        const resOff = ops.setFavorite(resOn.newDoc, floor.id, false);
        expect(resOff.type).toBe("applied");
        if (resOff.type === "applied") {
          expect(resOff.newDoc.records[0]!.favorite).toBe(false);
          expect(resOff.newText).not.toContain("favorite");
        }
      }
    }
  });

  it("T-026 / T-027: DeleteReply and DeleteFloor groups", () => {
    const docWithReplies = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Floor body.

### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: 2026-07-16 15:31:12]

Reply body.
`;

    const parseRes = parseThreadDocument(docWithReplies, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const reply = parseRes.doc.records[1]!;
      const replyRevision = parseRes.doc.rawText.substring(reply.fullSpan.start, reply.fullSpan.end);

      // Delete Reply
      const resDelReply = ops.deleteReply(parseRes.doc, reply.id, replyRevision);
      expect(resDelReply.type).toBe("applied");
      if (resDelReply.type === "applied") {
        expect(resDelReply.newDoc.records.length).toBe(1);
        expect(resDelReply.newDoc.records[0]!.type).toBe("floor");
      }

      // Delete Floor Group
      const floor = parseRes.doc.records[0]!;
      const floorRevision = parseRes.doc.rawText.substring(floor.fullSpan.start, floor.fullSpan.end);
      const resDelFloor = ops.deleteFloor(parseRes.doc, floor.id, [
        { id: floor.id, revision: floorRevision },
        { id: reply.id, revision: replyRevision }
      ]);
      expect(resDelFloor.type).toBe("applied");
      if (resDelFloor.type === "applied") {
        expect(resDelFloor.newDoc.records.length).toBe(0);
      }
    }
  });

  it("does not double an existing EOL after deleting from a document without one", () => {
    const docText = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Floor body.`;
    const parseRes = parseThreadDocument(docText, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const floor = parseRes.doc.records[0]!;
      const revision = docText.substring(floor.fullSpan.start, floor.fullSpan.end);
      const res = ops.deleteFloor(parseRes.doc, floor.id, [{ id: floor.id, revision }]);
      expect(res.type).toBe("applied");
      if (res.type === "applied") {
        expect(res.newText).toBe("---\nfloor-notes: 1\n---\n");
      }
    }
  });

  it("adds one EOL after deleting the last Reply from a document without one", () => {
    const docText = `---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Floor body.

### Reply
[id:: reply-20260716-153112-xyz09876]
[date:: 2026-07-16 15:31:12]

Reply body.`;
    const parseRes = parseThreadDocument(docText, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const reply = parseRes.doc.records[1]!;
      const revision = docText.substring(reply.fullSpan.start, reply.fullSpan.end);
      const res = ops.deleteReply(parseRes.doc, reply.id, revision);
      expect(res.type).toBe("applied");
      if (res.type === "applied") {
        expect(res.newText).toBe(`---
floor-notes: 1
---
## Floor
[id:: floor-20260716-153012-abcde123]
[date:: 2026-07-16 15:30:12]

Floor body.
`);
      }
    }
  });

  it("preserves free-form date metadata through mutations", () => {
    const docText = validBaseDoc.replace("2026-07-16 15:30:12", "not a Gregorian date");
    const parseRes = parseThreadDocument(docText, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      const floor = parseRes.doc.records[0]!;
      const favoriteResult = ops.setFavorite(parseRes.doc, floor.id, true);
      expect(favoriteResult.type).toBe("applied");
      if (favoriteResult.type === "applied") {
        expect(favoriteResult.newText).toContain("[date:: not a Gregorian date]");
        const replyResult = ops.addReply(
          favoriteResult.newDoc,
          floor.id,
          "Reply body.",
          new Date(2026, 6, 16, 15, 36, 0)
        );
        expect(replyResult.type).toBe("applied");
        if (replyResult.type === "applied") {
          expect(replyResult.newDoc.records[0]?.date).toBe("not a Gregorian date");
          expect(replyResult.newDoc.records).toHaveLength(2);
        }
      }
    }
  });

  it("sets a per-thread view style without rewriting other frontmatter", () => {
    const docText = validBaseDoc.replace("floor-notes: 1", "floor-notes: 1\ncustom: keep-me");
    const parsed = parseThreadDocument(docText, "thread.md", { defaultViewStyle: "glass" });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const inserted = ops.setViewStyle(parsed.doc, "glass");
      expect(inserted.type).toBe("applied");
      if (inserted.type === "applied") {
        expect(inserted.newText).toContain("floor-notes-view-style: glass");
        expect(inserted.newText).toContain("custom: keep-me");
        const updated = ops.setViewStyle(inserted.newDoc, "paper");
        expect(updated.type).toBe("applied");
        if (updated.type === "applied") {
          expect(updated.newText).toContain("floor-notes-view-style: paper");
        }
      }
    }
  });

  it("T-028 / T-029: SetSortOrder insert and update", () => {
    const parseRes = parseThreadDocument(validBaseDoc, "thread.md");
    expect(parseRes.ok).toBe(true);
    if (parseRes.ok) {
      expect(parseRes.doc.explicitSort).toBeNull();

      // Insert sort order
      const resInsert = ops.setSortOrder(parseRes.doc, "asc");
      expect(resInsert.type).toBe("applied");
      if (resInsert.type === "applied") {
        expect(resInsert.newDoc.explicitSort).toBe("asc");
        expect(resInsert.newText).toContain("floor-notes-sort: asc");

        // Update sort order
        const resUpdate = ops.setSortOrder(resInsert.newDoc, "desc");
        expect(resUpdate.type).toBe("applied");
        if (resUpdate.type === "applied") {
          expect(resUpdate.newDoc.explicitSort).toBe("desc");
          expect(resUpdate.newText).toContain("floor-notes-sort: desc");
        }
      }
    }
  });
});
