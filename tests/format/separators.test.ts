import { describe, it, expect } from "vitest";
import { findRecordSeparatorSpan } from "../../src/format/separators";

describe("T-051 (partial): separator parsing", () => {
  it("should parse count 0 (no EOL preceding)", () => {
    const text = "body## Floor";
    const res = findRecordSeparatorSpan(text, 4, 0);
    expect(res.eolCount).toBe(0);
    expect(res.span).toEqual({ start: 4, end: 4 });
  });

  it("should parse count 1 (one EOL preceding)", () => {
    const text = "body\n## Floor";
    const res = findRecordSeparatorSpan(text, 5, 0);
    expect(res.eolCount).toBe(1);
    expect(res.span).toEqual({ start: 4, end: 5 });
  });

  it("should parse count 2 (two EOLs with whitespace)", () => {
    const text = "body\n  \n## Floor";
    const res = findRecordSeparatorSpan(text, 8, 0);
    expect(res.eolCount).toBe(2);
    expect(res.span).toEqual({ start: 4, end: 8 });
  });

  it("should respect lowerBound and not scan beyond it", () => {
    const text = "body\n\n## Floor";
    // If lowerBound is 5, it means we cannot scan character at 4 (\n)
    const res = findRecordSeparatorSpan(text, 6, 5);
    expect(res.eolCount).toBe(1); // Only the second EOL at 5 is counted
    expect(res.span).toEqual({ start: 5, end: 6 });
  });
});
