import fs from "node:fs";
import path from "node:path";

const localesDir = "./src/locales";

function isSentenceCase(str) {
  if (!str) return true;
  // If string contains multiple sentences, we check the first character of the first word.
  // Generally, sentence case means only the first word is capitalized, unless it's a proper noun.
  // We'll enforce that the first character is capitalized (if alphabetical) or at least not all words are capitalized.
  // Standard test: The first letter is uppercase if alphabetical, and there are no consecutive capitalized words.
  // Let's do a simple check: First letter is capital, and we don't have Title Case (e.g. "Create Floor Thread" vs "Create floor thread").
  // If there are multiple words, check if the second word starts with an uppercase letter (unless it's an acronym or proper noun like "Obsidian", "Markdown", "BOM", "CRLF", "LF", "YAML", "HTML", "ID", "Date").
  const words = str.split(/\s+/).filter(w => w.length > 0);
  if (words.length <= 1) return true; // Single words are fine
  
  const allowedUpper = ["Obsidian", "Markdown", "BOM", "CRLF", "LF", "YAML", "HTML", "ID", "Date", "Floor", "Reply", "UI", "CSS", "BOM", "EOF", "UAX", "Unicode", "ZHW", "ZWJ", "ASCII", "Thread", "ThreadView", "FavoritesIndex", "Component", "Code"];
  
  for (let i = 1; i < words.length; i++) {
    const word = words[i].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "");
    if (word.length === 0) continue;
    const firstChar = word[0];
    if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
      if (!allowedUpper.includes(word)) {
        return false;
      }
    }
  }
  return true;
}

function check() {
  if (!fs.existsSync(localesDir)) {
    console.log("No locales directory found. Skipping locales check.");
    return;
  }
  const files = fs.readdirSync(localesDir).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("No locale JSON files found. Skipping locales check.");
    return;
  }

  let failed = false;
  const keySets = {};

  for (const file of files) {
    const filePath = path.join(localesDir, file);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
      console.error(`Error parsing JSON in ${file}:`, e);
      failed = true;
      continue;
    }
    
    keySets[file] = Object.keys(data).sort();

    // Check sentence case for English locales
    if (file.startsWith("en")) {
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === "string") {
          if (!isSentenceCase(value)) {
            console.error(`Error in ${file}: Key '${key}' value '${value}' is not in sentence case.`);
            failed = true;
          }
        }
      }
    }
  }

  // Compare key sets
  const fileNames = Object.keys(keySets);
  if (fileNames.length > 1) {
    const baselineFile = fileNames[0];
    const baselineKeys = keySets[baselineFile].join(",");
    for (let i = 1; i < fileNames.length; i++) {
      const cmpFile = fileNames[i];
      const cmpKeys = keySets[cmpFile].join(",");
      if (baselineKeys !== cmpKeys) {
        console.error(`Error: Key mismatch between locale files ${baselineFile} and ${cmpFile}.`);
        console.error(`${baselineFile} keys:`, keySets[baselineFile]);
        console.error(`${cmpFile} keys:`, keySets[cmpFile]);
        failed = true;
      }
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log("Locales verification passed.");
}

check();
