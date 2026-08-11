import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";

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

  it("keeps image-only paragraphs in the same block flow across layouts and themes", () => {
    const baseStyles = fs.readFileSync("src/styles/base.css", "utf8");
    const paragraphRule = baseStyles.match(
      /\.floor-notes-body \.floor-notes-image-paragraph,\s*\.floor-notes-modal-preview \.floor-notes-image-paragraph\s*\{([^}]*)\}/
    );
    const imageRule = baseStyles.match(
      /\.floor-notes-body \.floor-notes-image-paragraph img,\s*\.floor-notes-modal-preview \.floor-notes-image-paragraph img\s*\{([^}]*)\}/
    );
    const descriptionRule = baseStyles.match(
      /\.floor-notes-body \.floor-notes-image-description,\s*\.floor-notes-modal-preview \.floor-notes-image-description\s*\{([^}]*)\}/
    );

    expect(paragraphRule?.[1]).toMatch(/margin-block:\s*0 var\(--size-4-2\)/);
    expect(imageRule?.[1]).toMatch(/block-size:\s*auto/);
    expect(imageRule?.[1]).toMatch(/display:\s*block/);
    expect(imageRule?.[1]).toMatch(/max-inline-size:\s*100%/);
    expect(descriptionRule?.[1]).toMatch(/display:\s*block/);
    expect(descriptionRule?.[1]).toMatch(/margin-block-start:\s*var\(--size-4-1\)/);
    expect(descriptionRule?.[1]).toMatch(/text-align:\s*center/);
  });
});
