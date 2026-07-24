import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("source safety checks", () => {
  it("should pass static code safety script", () => {
    // Run the check-source.mjs script and verify it exits with 0
    let success = true;
    try {
      execSync("node scripts/check-source.mjs", { stdio: "pipe" });
    } catch (e) {
      success = false;
    }
    expect(success).toBe(true);
  });
});
