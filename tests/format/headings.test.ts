import { describe, it, expect } from "vitest";
import { parseStructuralHeading, parseATXH1Title } from "../../src/format/headings";

describe("T-004: structural heading precise identification", () => {
  it("should match column-zero headings with optional trailing spaces", () => {
    expect(parseStructuralHeading("## Floor", 10)).toEqual({
      type: "floor",
      span: { start: 10, end: 18 }
    });

    expect(parseStructuralHeading("## Floor \t ", 10)).toEqual({
      type: "floor",
      span: { start: 10, end: 21 }
    });

    expect(parseStructuralHeading("### Reply", 10)).toEqual({
      type: "reply",
      span: { start: 10, end: 19 }
    });
  });

  it("should reject headings with leading whitespace, wrong casing, or extra text", () => {
    expect(parseStructuralHeading(" ## Floor", 10)).toBeNull();
    expect(parseStructuralHeading("## floor", 10)).toBeNull();
    expect(parseStructuralHeading("## Floors", 10)).toBeNull();
    expect(parseStructuralHeading("### Reply extra", 10)).toBeNull();
  });
});

describe("T-002/T-055: ATX H1 title parsing", () => {
  it("should parse standard column-zero H1", () => {
    expect(parseATXH1Title("# My Title")).toBe("My Title");
    expect(parseATXH1Title("#   My Title  \t ")).toBe("My Title");
  });

  it("should reject non-H1 lines or H1 with multiple hashes", () => {
    expect(parseATXH1Title("## H2 Title")).toBeNull();
    expect(parseATXH1Title(" # Indented H1")).toBeNull();
    expect(parseATXH1Title("#MyTitle")).toBeNull(); // No space after '#'
  });

  it("should handle closing hashes", () => {
    expect(parseATXH1Title("# My Title #")).toBe("My Title");
    expect(parseATXH1Title("# My Title ## \t")).toBe("My Title");
    expect(parseATXH1Title("# My Title#")).toBe("My Title#"); // Not preceded by space
    expect(parseATXH1Title("# #")).toBe(""); // Empty title
  });
});
