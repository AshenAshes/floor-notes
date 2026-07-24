import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../../src/format/frontmatter";
import { parsePhysicalLines } from "../../src/format/physicalLines";

describe("T-054/T-053: frontmatter semantic validation", () => {
  it("should parse valid version 1 with sort", () => {
    const text = "---\nfloor-notes: 1\nfloor-notes-sort: asc\n---\n";
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(text);
    const { frontmatter, diagnostics } = parseFrontmatter(text, bomSpan, lines, terminalEolSpan);
    
    expect(diagnostics.length).toBe(0);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!.version).toBe(1);
    expect(frontmatter!.sort).toBe("asc");
  });

  it("should parse an explicit thread view style and preserve its scalar span", () => {
    const text = "---\nfloor-notes: 1\nfloor-notes-view-style: 'paper' # Reading mode\n---\n";
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(text);
    const { frontmatter, diagnostics } = parseFrontmatter(text, bomSpan, lines, terminalEolSpan);

    expect(diagnostics).toHaveLength(0);
    expect(frontmatter?.viewStyle).toBe("paper");
    expect(text.substring(frontmatter!.viewStyleValueSpan!.start, frontmatter!.viewStyleValueSpan!.end)).toBe("'paper'");
  });

  it.each(["bubble", "glass", "paper", "timeline"] as const)("should accept the canonical '%s' thread view style", (viewStyle) => {
    const text = `---\nfloor-notes: 1\nfloor-notes-view-style: ${viewStyle}\n---\n`;
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(text);
    const { frontmatter, diagnostics } = parseFrontmatter(text, bomSpan, lines, terminalEolSpan);

    expect(diagnostics).toHaveLength(0);
    expect(frontmatter?.viewStyle).toBe(viewStyle);
  });

  it("should reject an invalid thread view style", () => {
    const text = "---\nfloor-notes: 1\nfloor-notes-view-style: neon\n---\n";
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(text);
    const { frontmatter, diagnostics } = parseFrontmatter(text, bomSpan, lines, terminalEolSpan);

    expect(frontmatter).toBeNull();
    expect(diagnostics[0]?.code).toBe("FN-F014");
  });

  it("should support equivalent YAML formats like +1 or comments", () => {
    const text = "---\nfloor-notes: +1 # comment\n---\n";
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(text);
    const { frontmatter, diagnostics } = parseFrontmatter(text, bomSpan, lines, terminalEolSpan);
    
    expect(diagnostics.length).toBe(0);
    expect(frontmatter).not.toBeNull();
    expect(frontmatter!.version).toBe(1);
  });

  it("should detect duplicate keys", () => {
    const text = "---\nfloor-notes: 1\nfloor-notes: 2\n---\n";
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(text);
    const { frontmatter, diagnostics } = parseFrontmatter(text, bomSpan, lines, terminalEolSpan);
    
    expect(frontmatter).toBeNull();
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0]!.message).toContain("Duplicate key");
  });

  it("should reject wrong value types", () => {
    const text = "---\nfloor-notes: \"1\"\n---\n"; // String "1" instead of number 1
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(text);
    const { frontmatter, diagnostics } = parseFrontmatter(text, bomSpan, lines, terminalEolSpan);
    
    expect(frontmatter).toBeNull();
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("should reject missing floor-notes version key", () => {
    const text = "---\nfloor-notes-sort: asc\n---\n";
    const { bomSpan, lines, terminalEolSpan } = parsePhysicalLines(text);
    const { frontmatter, diagnostics } = parseFrontmatter(text, bomSpan, lines, terminalEolSpan);
    
    expect(frontmatter).toBeNull();
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});
