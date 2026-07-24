import { describe, it, expect } from "vitest";
import { formatLocalDate } from "../../src/util/date";

describe("T-056: local date formatting", () => {
  it("should format dates correctly", () => {
    const d = new Date(2026, 6, 17, 7, 5, 9); // Note: Month is 0-indexed in JS Date
    expect(formatLocalDate(d)).toBe("2026-07-17 07:05:09");
  });
});
