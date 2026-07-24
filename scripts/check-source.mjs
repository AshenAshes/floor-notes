import fs from "node:fs";
import path from "node:path";

const srcDir = "./src";

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (file.endsWith(".ts") || file.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function check() {
  const files = walk(srcDir);
  let failed = false;

  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    
    // Check for regex lookbehinds: (?<= or (?<!
    if (/\(\?<=|\(\?<!/.test(content)) {
      console.error(`Error in ${file}: RegExp lookbehinds are forbidden (iOS compatibility).`);
      failed = true;
    }

    // Check for bare fetch
    if (/\bfetch\s*\(/.test(content)) {
      console.error(`Error in ${file}: Use of fetch() is forbidden. Use requestUrl() instead.`);
      failed = true;
    }

    // Check for Math.random
    if (/Math\.random\s*\(/.test(content)) {
      console.error(`Error in ${file}: Math.random() is forbidden. Use crypto.getRandomValues() instead.`);
      failed = true;
    }

    // Check for bare document and window usage (excluding activeDocument, activeWindow, ownerDocument, defaultView, etc.)
    // We match 'document' or 'window' but ensure they are not preceded by 'active', 'owner', 'defaultView.', etc.
    const bareDocumentRegex = /(?<!active|owner)(?<!\bclass\s+)(?<!\s+cls:\s+)(?<!\.)\bdocument\b/g;
    const bareWindowRegex = /(?<!active|default)(?<!\.)\bwindow\b(?!\.setTimeout)(?!\.setInterval)/g;

    let match;
    while ((match = bareDocumentRegex.exec(content)) !== null) {
      // Allow if it's commented or inside a string or specific allowed patterns
      const index = match.index;
      // Simple heuristic: check if line is commented
      const before = content.substring(0, index);
      const lineStart = before.lastIndexOf("\n") + 1;
      const line = content.substring(lineStart, content.indexOf("\n", index));
      if (!line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        console.error(`Error in ${file}: Bare 'document' found. Use 'activeDocument' or 'ownerDocument'. Line: ${line.trim()}`);
        failed = true;
      }
    }

    while ((match = bareWindowRegex.exec(content)) !== null) {
      const index = match.index;
      const before = content.substring(0, index);
      const lineStart = before.lastIndexOf("\n") + 1;
      const line = content.substring(lineStart, content.indexOf("\n", index));
      if (!line.trim().startsWith("//") && !line.trim().startsWith("*")) {
        console.error(`Error in ${file}: Bare 'window' found. Use 'activeWindow' or 'defaultView'. Line: ${line.trim()}`);
        failed = true;
      }
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log("Source safety checks passed.");
}

check();
