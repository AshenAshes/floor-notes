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

  it("uses shared logical author-label styles across every thread layout", () => {
    const recordStyles = fs.readFileSync("src/styles/records.css", "utf8");
    const authorRule = recordStyles.match(/\.floor-notes-reply-author\s*\{([^}]*)\}/);
    const leadRule = recordStyles.match(/\.floor-notes-reply-author-lead\s*\{([^}]*)\}/);

    expect(authorRule?.[1]).toMatch(/color:\s*var\(--text-accent\)/);
    expect(authorRule?.[1]).toMatch(/font-weight:\s*var\(--font-semibold\)/);
    expect(authorRule?.[1]).toMatch(/overflow-wrap:\s*anywhere/);
    expect(leadRule?.[1]).toMatch(/margin-block-end:\s*var\(--size-4-1\)/);
  });

  it("matches Obsidian 1.13.7 image action and resize-corner geometry", () => {
    const baseStyles = fs.readFileSync("src/styles/base.css", "utf8");
    const actionsRule = baseStyles.match(/\.floor-notes-image-actions\s*\{([^}]*)\}/);
    const actionRule = baseStyles.match(/\.floor-notes-thread-view button\.floor-notes-image-action\s*\{([^}]*)\}/);
    const handleRule = baseStyles.match(/\.floor-notes-thread-view button\.floor-notes-image-resize-handle\s*\{([^}]*)\}/);
    const cornerRule = baseStyles.match(/\.floor-notes-image-resize-handle::after\s*\{([^}]*)\}/);

    expect(actionsRule?.[1]).toMatch(/top:\s*var\(--size-4-2\)/);
    expect(actionsRule?.[1]).toMatch(/inset-inline-end:\s*8px/);
    expect(actionsRule?.[1]).toMatch(/gap:\s*var\(--size-2-1\)/);
    expect(actionsRule?.[1]).toMatch(/opacity:\s*0/);
    expect(actionsRule?.[1]).toMatch(/transition:\s*opacity 0\.07s ease-out/);
    expect(actionsRule?.[1]).toMatch(/background-color:\s*var\(--embed-actions-background\)/);
    expect(actionsRule?.[1]).toMatch(/border-radius:\s*var\(--embed-actions-radius\)/);
    expect(actionsRule?.[1]).toMatch(/box-shadow:\s*var\(--embed-actions-shadow\)/);
    expect(actionsRule?.[1]).toMatch(/padding:\s*var\(--embed-actions-padding\)/);
    expect(actionsRule?.[1]).toMatch(/backdrop-filter:\s*var\(--embed-actions-blur\)/);

    expect(actionRule?.[1]).toMatch(/appearance:\s*none/);
    expect(actionRule?.[1]).toMatch(/padding:\s*var\(--size-2-2\) var\(--size-2-3\)/);
    expect(actionRule?.[1]).toMatch(/color:\s*var\(--embed-action-color\)/);
    expect(actionRule?.[1]).toMatch(/border-radius:\s*var\(--embed-action-radius\)/);
    expect(actionRule?.[1]).not.toMatch(/(?:inline|block)-size:\s*44px/);

    expect(handleRule?.[1]).toMatch(/width:\s*30px/);
    expect(handleRule?.[1]).toMatch(/height:\s*30px/);
    expect(handleRule?.[1]).toMatch(/display:\s*block/);
    expect(handleRule?.[1]).toMatch(/border-radius:\s*0/);
    expect(handleRule?.[1]).toMatch(/cursor:\s*nwse-resize/);
    expect(handleRule?.[1]).toMatch(/inset-inline-end:\s*0/);
    expect(cornerRule?.[1]).toMatch(/width:\s*10px/);
    expect(cornerRule?.[1]).toMatch(/height:\s*10px/);
    expect(cornerRule?.[1]).toMatch(/border-bottom:\s*var\(--icon-stroke\) solid var\(--text-muted\)/);
    expect(cornerRule?.[1]).toMatch(/border-inline-end:\s*var\(--icon-stroke\) solid var\(--text-muted\)/);
    expect(cornerRule?.[1]).toMatch(/inset-inline-end:\s*6px/);
    expect(cornerRule?.[1]).toMatch(/bottom:\s*6px/);
    expect(cornerRule?.[1]).toMatch(/opacity:\s*0/);

    expect(baseStyles).toContain(".floor-notes-resizable-image:hover > .floor-notes-image-actions");
    expect(baseStyles).toContain(".floor-notes-resizable-image:hover .floor-notes-image-resize-handle::after");
    expect(baseStyles).toContain(".floor-notes-resizable-image.is-resizing > .floor-notes-image-actions");
    expect(baseStyles).toContain(".floor-notes-resizable-image.is-resizing .floor-notes-image-resize-handle::after");
    expect(baseStyles).toMatch(
      /\.floor-notes-resizable-image\.is-resizing \.floor-notes-image-resize-handle::after\s*\{[^}]*border-color:\s*var\(--color-accent\)/s
    );
    expect(baseStyles).not.toMatch(/\.floor-notes-image-action:hover\s*\{[^}]*color:\s*var\(--text-accent\)/s);
  });

  it("keeps the accepted image-resize geometry shared across layouts and themes", () => {
    const layoutAndThemeStyles = [
      "src/styles/records.css",
      "src/styles/responsive.css",
      "src/styles/themes.css",
      "src/styles/thread.css"
    ].map((path) => fs.readFileSync(path, "utf8")).join("\n");

    expect(layoutAndThemeStyles).not.toMatch(
      /(?:\.theme-|\.floor-notes-view-style-)[^{]*\.floor-notes-image-(?:resize-handle|wrapper)/s
    );
  });
});
