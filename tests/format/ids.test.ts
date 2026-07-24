import { describe, it, expect } from "vitest";
import { generateRandomSuffix, generateRecordId, isValidRecordId } from "../../src/util/ids";

describe("T-057 (primitive part): ID suffix generation and validation", () => {
  it("should generate random suffixes containing only characters from the allowed alphabet", () => {
    const suffix = generateRandomSuffix();
    expect(suffix.length).toBe(8);
    for (const char of suffix) {
      expect("0123456789abcdefghjkmnpqrstvwxyz").toContain(char);
    }
  });

  it("should generate unique suffixes on consecutive calls", () => {
    const suffix1 = generateRandomSuffix();
    const suffix2 = generateRandomSuffix();
    expect(suffix1).not.toBe(suffix2);
  });

  it("should generate valid record IDs", () => {
    const date = new Date(2026, 6, 16, 15, 33, 12);
    const floorId = generateRecordId("floor", date);
    expect(floorId.startsWith("floor-20260716-153312-")).toBe(true);
    expect(isValidRecordId(floorId)).toBe(true);

    const replyId = generateRecordId("reply", date);
    expect(replyId.startsWith("reply-20260716-153312-")).toBe(true);
    expect(isValidRecordId(replyId)).toBe(true);
  });

  it("should validate and reject invalid IDs", () => {
    expect(isValidRecordId("floor-20260716-153312-abcdefgh")).toBe(true);
    expect(isValidRecordId("reply-20260716-153312-01234567")).toBe(true);
    
    // Invalid characters (e.g. 'i', 'l', 'o', 'u' are not in alphabet)
    expect(isValidRecordId("floor-20260716-153312-abcdefgi")).toBe(false); 
    // Invalid length
    expect(isValidRecordId("floor-20260716-153312-abcdefg")).toBe(false);
    // Invalid timestamp format
    expect(isValidRecordId("floor-20260716-1533123-abcdefgh")).toBe(false);
    // Invalid prefix
    expect(isValidRecordId("other-20260716-153312-abcdefgh")).toBe(false);
  });
});
