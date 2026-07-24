import { describe, it, expect } from "vitest";
import { parseMetadataBlock } from "../../src/format/metadata";
import { parsePhysicalLines } from "../../src/format/physicalLines";

describe("T-010: metadata delimiter and malformed checks", () => {
  it("should parse valid metadata block with terminating blank line", () => {
    const text = "[id:: floor-123]\n[date:: 2026-07-16 15:33:12]\n\n";
    const { lines } = parsePhysicalLines(text);
    const { fields, terminatorLineIndex, diagnostics } = parseMetadataBlock(text, lines, 0);

    expect(diagnostics.length).toBe(0);
    expect(fields.length).toBe(2);
    expect(terminatorLineIndex).toBe(2); // Line 2 is the blank line
    expect(fields[0]!.key).toBe("id");
    expect(fields[0]!.value).toBe("floor-123");
  });

  it("should fail if there is no terminating blank line", () => {
    const text = "[id:: floor-123]\n[date:: 2026-07-16 15:33:12]";
    const { lines } = parsePhysicalLines(text);
    const { diagnostics } = parseMetadataBlock(text, lines, 0);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.code).toBe("FN-F011");
  });

  it("should fail if a line does not match the field syntax before blank line", () => {
    const text = "[id:: floor-123]\nnot-a-field-line\n\n";
    const { lines } = parsePhysicalLines(text);
    const { diagnostics } = parseMetadataBlock(text, lines, 0);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.code).toBe("FN-F011");
  });
});
