import fs from "node:fs";

const themesCssFile = "./src/styles/themes.css";
const fixedThemes = [
  "nord",
  "monokai",
  "vscode",
  "material",
  "claude",
  "dracula",
  "gruvbox",
  "solarized"
];
const customStyles = ["bubble", "glass", "paper", "timeline"];
const requiredTokens = [
  "background-primary",
  "background-secondary",
  "background-secondary-alt",
  "background-primary-alt",
  "text-normal",
  "text-muted",
  "text-faint",
  "text-accent",
  "link-color",
  "text-error",
  "text-warning",
  "background-modifier-border",
  "background-modifier-border-hover",
  "background-modifier-border-subtle",
  "background-modifier-hover",
  "background-modifier-accent-subtle"
];

function parseHexColor(value) {
  const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) {
    return null;
  }

  const color = match[1].length === 3
    ? match[1].split("").map((channel) => `${channel}${channel}`).join("")
    : match[1];
  return [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255);
}

function relativeLuminance([red, green, blue]) {
  const linearize = (channel) => channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function contrastRatio(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function getBlock(css, selector) {
  const match = css.match(new RegExp(`\\${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  return match?.[1] ?? null;
}

function getTokenValue(block, token) {
  const match = block.match(new RegExp(`--${token}:\\s*([^;]+);`));
  return match?.[1] ?? null;
}

function validateThemeBlock(block, label) {
  let failed = false;
  if (!block) {
    console.error(`Error: Theme '${label}' is missing its token block.`);
    return true;
  }

  for (const token of requiredTokens) {
    if (!getTokenValue(block, token)) {
      console.error(`Error: Theme '${label}' is missing --${token}.`);
      failed = true;
    }
  }

  const foreground = parseHexColor(getTokenValue(block, "text-normal") ?? "");
  const background = parseHexColor(getTokenValue(block, "background-primary") ?? "");
  if (!foreground || !background) {
    console.error(`Error: Theme '${label}' needs hexadecimal text and background colors for contrast validation.`);
    return true;
  }

  const ratio = contrastRatio(foreground, background);
  if (ratio < 4.5) {
    console.error(`Error: Theme '${label}' text contrast is ${ratio.toFixed(2)}:1; expected at least 4.5:1.`);
    failed = true;
  }

  return failed;
}

function check() {
  if (!fs.existsSync(themesCssFile)) {
    console.log("No themes.css found yet. Skipping theme contrast checks.");
    return;
  }

  const css = fs.readFileSync(themesCssFile, "utf-8");
  let failed = false;

  for (const theme of fixedThemes) {
    for (const mode of ["light", "dark"]) {
      failed = validateThemeBlock(getBlock(css, `.theme-${theme}.mode-${mode}`), `${theme} (${mode})`) || failed;
    }
  }

  for (const style of customStyles) {
    const sharedBlock = getBlock(css, `.theme-custom.floor-notes-view-style-${style}`);
    if (!sharedBlock) {
      console.error(`Error: Custom theme '${style}' is missing its shared style token block.`);
      failed = true;
    }

    for (const mode of ["light", "dark"]) {
      const label = `custom/${style} (${mode})`;
      const block = getBlock(css, `.theme-custom.mode-${mode}.floor-notes-view-style-${style}`);
      failed = validateThemeBlock(block, label) || failed;

      const requiredStyleTokens = style === "glass"
        ? ["floor-notes-glass-mesh", "floor-notes-glass-card-background"]
        : style === "paper"
          ? ["floor-notes-paper-sub-line"]
          : style === "timeline"
            ? ["floor-notes-timeline-line", "floor-notes-timeline-node"]
            : [];
      for (const token of requiredStyleTokens) {
        if (!block || !getTokenValue(block, token)) {
          console.error(`Error: Theme '${label}' is missing --${token}.`);
          failed = true;
        }
      }
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log("Theme token and contrast verification passed.");
}

check();
