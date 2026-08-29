import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

  it("keeps Floor image presentation out of native Markdown editor and reading-view hooks", () => {
    const mainSource = fs.readFileSync("src/main.ts", "utf8");
    const styleSource = fs.readdirSync("src/styles")
      .filter((fileName) => fileName.endsWith(".css"))
      .map((fileName) => fs.readFileSync(path.join("src/styles", fileName), "utf8"))
      .join("\n");

    expect(mainSource).not.toMatch(/registerMarkdownPostProcessor|registerEditorExtension/);
    expect(styleSource).not.toMatch(/\.image-embed|\.markdown-source-view|\.markdown-reading-view/);
  });
});
