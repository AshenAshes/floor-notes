import fs from "node:fs";

const cssFile = "./styles.css";

function check() {
  if (!fs.existsSync(cssFile)) {
    console.log("No styles.css found. Skipping CSS check.");
    return;
  }
  const css = fs.readFileSync(cssFile, "utf-8");
  let failed = false;

  if (css.includes("!important")) {
    console.error("Error: Found forbidden '!important' in CSS.");
    failed = true;
  }
  
  // Note: `:has` check, but let's make sure it's actually used as a selector, e.g., `:has`
  // We can do a regex check
  if (/:has\b/.test(css)) {
    console.error("Error: Found forbidden ':has' pseudo-class in CSS.");
    failed = true;
  }

  const requiredViewStyleSelectors = [
    ".floor-notes-view-style-bubble",
    ".floor-notes-view-style-glass",
    ".floor-notes-view-style-paper",
    ".floor-notes-view-style-timeline",
    ".floor-notes-record-list",
    ".floor-notes-record-footer",
    ".floor-notes-replies"
  ];
  for (const selector of requiredViewStyleSelectors) {
    if (!css.includes(selector)) {
      console.error(`Error: Missing required thread view style selector '${selector}'.`);
      failed = true;
    }
  }

  if (/^\s*(?:columns|column-count)\s*:/m.test(css)) {
    console.error("Error: Glass view must use CSS Grid instead of CSS columns.");
    failed = true;
  }

  const recordsSource = fs
    .readFileSync("./src/styles/records.css", "utf-8")
    .replace(/\r\n?/g, "\n");
  if (/(?:#[0-9a-f]{3,8}\b|rgba?\s*\()/i.test(recordsSource)) {
    console.error("Error: Thread view styles must use theme tokens instead of literal colors.");
    failed = true;
  }

  const glassListRule = recordsSource.match(
    /\.floor-notes-thread-view\.floor-notes-view-style-glass \.floor-notes-record-list\s*\{([\s\S]*?)\n\}/
  );
  if (!glassListRule || /grid-auto-rows\s*:/.test(glassListRule[1])) {
    console.error("Error: Glass must reserve fixed grid rows for the ready masonry state only.");
    failed = true;
  }

  const paperDateRule = recordsSource.match(
    /\.floor-notes-thread-view\.floor-notes-view-style-paper \.floor-notes-date\s*\{([\s\S]*?)\n\}/
  );
  if (!paperDateRule || !/clip-path\s*:/.test(paperDateRule[1])) {
    console.error("Error: Paper dates must remain visually hidden without removing their DOM nodes.");
    failed = true;
  }

  const paperFloorNumberRules = recordsSource.match(
    /\.floor-notes-thread-view\.floor-notes-view-style-paper \.floor-notes-floor-number\s*\{[\s\S]*?\n\}/g
  );
  if (
    paperFloorNumberRules?.length !== 1 ||
    !/top\s*:\s*2px\s*;/.test(paperFloorNumberRules[0]) ||
    !/opacity\s*:\s*0\.6\s*;/.test(paperFloorNumberRules[0])
  ) {
    console.error("Error: Paper floor numbers must have one canonical 2px/.6 rule.");
    failed = true;
  }

  const requiredPaperDemoFragments = [
    "--floor-notes-paper-folio-gutter: 36px",
    ".floor-notes-view-style-paper .floor-notes-record-list {\n  gap: 36px",
    ".floor-notes-view-style-paper .floor-notes-replies {\n  border-inline-start: 2px solid var(--floor-notes-paper-reply-rule);\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  margin-top: 12px;\n  padding-inline-start: 12px",
    ".floor-notes-view-style-paper .floor-notes-floor .floor-notes-record-content {\n  padding-inline-end: 60px",
    ".floor-notes-view-style-paper .floor-notes-reply .floor-notes-body {\n  color: var(--text-muted)"
  ];
  if (requiredPaperDemoFragments.some((fragment) => !recordsSource.includes(fragment))) {
    console.error("Error: Paper layout and reply hierarchy must retain demo-calibrated geometry.");
    failed = true;
  }

  if (recordsSource.includes("grid-template-columns: minmax(0, 1fr) 60px")) {
    console.error("Error: Paper actions must remain outside the document flow.");
    failed = true;
  }

  const paperActionRailFragments = [
    "@media (width > 600px) and (hover: hover) and (pointer: fine)",
    ".floor-notes-meta-right::before",
    "inset-inline: -16px -4px",
    "pointer-events: none",
    "pointer-events: auto"
  ];
  if (paperActionRailFragments.some((fragment) => !recordsSource.includes(fragment))) {
    console.error("Error: Paper desktop actions must retain their hover-priority rail.");
    failed = true;
  }

  const requiredMasonryFragments = [
    "--floor-notes-glass-row-height: 1px",
    "row-gap: 0",
    "margin-block-end: var(--size-4-6)"
  ];
  if (requiredMasonryFragments.some((fragment) => !recordsSource.includes(fragment))) {
    console.error("Error: Glass masonry must use one-pixel tracks and a fixed card gap.");
    failed = true;
  }

  if (/body\.theme-(?:light|dark)\s+\.floor-notes-thread-view\.floor-notes-view-style-glass/.test(recordsSource)) {
    console.error("Error: Glass styling must not depend on host body theme classes.");
    failed = true;
  }

  const glassGridSource = fs.readFileSync("./src/view/glassGrid.ts", "utf-8");
  if (!glassGridSource.includes("computed.columnGap")) {
    console.error("Error: Glass masonry spans must include the resolved card gap.");
    failed = true;
  }

  const requiredTimelineFragments = [
    "--timeline-floor-date-center",
    "--timeline-reply-date-center",
    ".floor-notes-floor::after",
    "--timeline-reply-axis-from-reply"
  ];
  if (requiredTimelineFragments.some((fragment) => !recordsSource.includes(fragment))) {
    console.error("Error: Timeline markers must derive from date and reply-axis coordinates.");
    failed = true;
  }

  const requiredTimelineInteractionFragments = [
    ".floor-notes-floor:hover .floor-notes-date",
    ".floor-notes-floor:focus-within .floor-notes-date",
    ".floor-notes-reply:hover .floor-notes-date",
    ".floor-notes-reply:focus-within .floor-notes-date",
    "transition: color 0.2s ease;",
    "color: var(--floor-notes-timeline-date-hover)"
  ];
  if (requiredTimelineInteractionFragments.some((fragment) => !recordsSource.includes(fragment))) {
    console.error("Error: Timeline date hover must preserve mouse and keyboard text-color emphasis.");
    failed = true;
  }

  const themesSource = fs.readFileSync("./src/styles/themes.css", "utf-8");
  if (
    recordsSource.includes("box-shadow: 0 0 0 1px var(--floor-notes-timeline-date-hover-ring)") ||
    recordsSource.includes("--floor-notes-timeline-date-hover-ring") ||
    themesSource.includes("--floor-notes-timeline-date-hover-ring")
  ) {
    console.error("Error: Timeline date hover must not render a ring around the date.");
    failed = true;
  }
  for (const mode of ["light", "dark"]) {
    for (const style of ["bubble", "glass", "paper", "timeline"]) {
      const selector = `.theme-custom.mode-${mode}.floor-notes-view-style-${style}`;
      if (!themesSource.includes(selector)) {
        console.error(`Error: Missing Custom theme selector '${selector}'.`);
        failed = true;
      }
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log("CSS validation passed.");
}

check();
