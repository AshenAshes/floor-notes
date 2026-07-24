import { describe, it, expect } from "vitest";
import fs from "node:fs";

describe("manifest.json contract", () => {
  it("should have correct properties and match spec rules", () => {
    const manifest = JSON.parse(fs.readFileSync("./manifest.json", "utf-8"));
    const pkg = JSON.parse(fs.readFileSync("./package.json", "utf-8"));

    expect(manifest.id).toBe("floor-notes");
    expect(manifest.name).toBe("Floor notes");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.minAppVersion).toBe("1.8.7");
    expect(manifest.isDesktopOnly).toBe(false);

    // NFR-014 / Description rules: Sentence case, ended with period.
    const desc = manifest.description;
    expect(desc).toBeDefined();
    expect(desc.endsWith(".")).toBe(true);
    // Ensure it doesn't contain "Obsidian" or "This plugin"
    expect(desc.toLowerCase().includes("obsidian")).toBe(false);
    expect(desc.toLowerCase().includes("this plugin")).toBe(false);
  });
});
