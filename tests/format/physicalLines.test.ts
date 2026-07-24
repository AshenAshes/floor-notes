import { describe, it, expect } from "vitest";
import { parsePhysicalLines } from "../../src/format/physicalLines";

describe("T-016: physicalLines parsing, BOM, LF, CRLF, and terminal EOL", () => {
  it("should parse empty string correctly", () => {
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines("");
    expect(bomSpan).toBeNull();
    expect(lines.length).toBe(1);
    expect(lines[0]!.contentSpan).toEqual({ start: 0, end: 0 });
    expect(lines[0]!.eolSpan).toBeNull();
    expect(terminalEolSpan).toEqual({ start: 0, end: 0 });
  });

  it("should parse single line without EOL", () => {
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines("hello");
    expect(bomSpan).toBeNull();
    expect(lines.length).toBe(1);
    expect(lines[0]!.contentSpan).toEqual({ start: 0, end: 5 });
    expect(lines[0]!.eolSpan).toBeNull();
    expect(terminalEolSpan).toEqual({ start: 5, end: 5 });
  });

  it("should parse single line with EOL (terminal EOL)", () => {
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines("hello\n");
    expect(bomSpan).toBeNull();
    // 2 lines: "hello" + ""
    expect(lines.length).toBe(2);
    expect(lines[0]!.contentSpan).toEqual({ start: 0, end: 5 });
    expect(lines[0]!.eolSpan).toEqual({ start: 5, end: 6 });
    expect(lines[0]!.isTerminalEol).toBe(true);
    expect(lines[1]!.contentSpan).toEqual({ start: 6, end: 6 });
    expect(lines[1]!.eolSpan).toBeNull();
    expect(terminalEolSpan).toEqual({ start: 5, end: 6 });
  });

  it("should parse multiple lines with CRLF and LF", () => {
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines("hello\r\nworld\n");
    expect(bomSpan).toBeNull();
    expect(lines.length).toBe(3);
    
    expect(lines[0]!.contentSpan).toEqual({ start: 0, end: 5 });
    expect(lines[0]!.eolSpan).toEqual({ start: 5, end: 7 });
    expect(lines[0]!.eol).toBe("\r\n");
    expect(lines[0]!.isTerminalEol).toBe(false);

    expect(lines[1]!.contentSpan).toEqual({ start: 7, end: 12 });
    expect(lines[1]!.eolSpan).toEqual({ start: 12, end: 13 });
    expect(lines[1]!.eol).toBe("\n");
    expect(lines[1]!.isTerminalEol).toBe(true);

    expect(lines[2]!.contentSpan).toEqual({ start: 13, end: 13 });
    expect(lines[2]!.eolSpan).toBeNull();

    expect(terminalEolSpan).toEqual({ start: 12, end: 13 });
  });

  it("should handle BOM correctly", () => {
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines("\uFEFFhello\n");
    expect(bomSpan).toEqual({ start: 0, end: 1 });
    expect(lines.length).toBe(2);
    expect(lines[0]!.contentSpan).toEqual({ start: 1, end: 6 });
    expect(lines[0]!.eolSpan).toEqual({ start: 6, end: 7 });
    expect(lines[0]!.isTerminalEol).toBe(true);
    expect(terminalEolSpan).toEqual({ start: 6, end: 7 });
  });

  it("should not treat lone CR as EOL", () => {
    const { lines } = parsePhysicalLines("hello\rworld");
    expect(lines.length).toBe(1);
    expect(lines[0]!.contentSpan).toEqual({ start: 0, end: 11 });
  });
});
