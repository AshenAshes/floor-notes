import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("CSS styles contract", () => {
  it("should pass static css checks", () => {
    // Run build-css to ensure styles.css exists, then check-css
    let success = true;
    try {
      execSync("node scripts/build-css.mjs", { stdio: "pipe" });
      execSync("node scripts/check-css.mjs", { stdio: "pipe" });
    } catch (e) {
      success = false;
    }
    expect(success).toBe(true);
  });
});
