import fs from "node:fs";
import path from "node:path";

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walk(fullPath, files);
    } else if (file.endsWith(".test.ts") || file.endsWith(".test.js")) {
      files.push(fullPath);
    }
  }
  return files;
}

function check() {
  let failed = false;

  // 1. Verify version alignment
  const packageJson = JSON.parse(fs.readFileSync("./package.json", "utf-8"));
  const manifestJson = JSON.parse(fs.readFileSync("./manifest.json", "utf-8"));
  const versionsJson = JSON.parse(fs.readFileSync("./versions.json", "utf-8"));

  const pkgVersion = packageJson.version;
  const manifestVersion = manifestJson.version;
  const releaseTag = process.env.RELEASE_TAG;

  if (releaseTag) {
    const validReleaseTag = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
    if (!validReleaseTag.test(releaseTag)) {
      console.error(`Error: RELEASE_TAG must use the exact vX.Y.Z format. Found "${releaseTag}".`);
      failed = true;
    } else if (releaseTag !== `v${pkgVersion}`) {
      console.error(`Error: RELEASE_TAG (${releaseTag}) does not match package.json version (${pkgVersion}).`);
      failed = true;
    }
  }

  if (pkgVersion !== manifestVersion) {
    console.error(`Error: package.json version (${pkgVersion}) does not match manifest.json version (${manifestVersion}).`);
    failed = true;
  }

  if (!versionsJson[manifestVersion]) {
    console.error(`Error: versions.json is missing an entry for the current version (${manifestVersion}).`);
    failed = true;
  }

  const manifestMinAppVersion = manifestJson.minAppVersion;
  const versionsMinAppVersion = versionsJson[manifestVersion];
  if (manifestMinAppVersion !== versionsMinAppVersion) {
    console.error(`Error: manifest.json minAppVersion (${manifestMinAppVersion}) does not match versions.json minAppVersion (${versionsMinAppVersion}) for version ${manifestVersion}.`);
    failed = true;
  }

  if (manifestMinAppVersion !== "1.8.7") {
    console.error(`Error: minAppVersion must be strictly "1.8.7". Found "${manifestMinAppVersion}".`);
    failed = true;
  }

  // 2. Verify that release assets exist and bundled editor dependencies do not rely on Obsidian's module loader.
  const stylesPath = "./styles.css";
  if (!fs.existsSync(stylesPath) || fs.statSync(stylesPath).size === 0) {
    console.error("Error: styles.css is missing or empty. Run the production build before release verification.");
    failed = true;
  }

  const bundlePath = "./main.js";
  if (!fs.existsSync(bundlePath) || fs.statSync(bundlePath).size === 0) {
    console.error("Error: main.js is missing or empty. Run the production build before release verification.");
    failed = true;
  } else {
    const bundle = fs.readFileSync(bundlePath, "utf-8");
    if (/require\(["']@(codemirror|lezer)\//.test(bundle)) {
      console.error("Error: main.js contains external CodeMirror or Lezer requires. Bundle these dependencies with the plugin.");
      failed = true;
    }
  }

  // 3. Verify test coverage for T-001 through T-071
  const testFiles = walk("./tests");
  const testIds = new Set();
  const testIdMap = new Map(); // testId -> file path

  const testIdRegex = /\bT-\d{3}\b/g;

  for (const file of testFiles) {
    const content = fs.readFileSync(file, "utf-8");
    let match;
    while ((match = testIdRegex.exec(content)) !== null) {
      const id = match[0];
      testIds.add(id);
      if (!testIdMap.has(id)) {
        testIdMap.set(id, []);
      }
      testIdMap.get(id).push(file);
    }
  }

  // Check for missing IDs
  const missingIds = [];
  for (let i = 1; i <= 71; i++) {
    const id = `T-${String(i).padStart(3, "0")}`;
    if (!testIds.has(id)) {
      missingIds.push(id);
    }
  }

  if (missingIds.length > 0) {
    console.warn(`Warning: Missing test implementations for: ${missingIds.join(", ")}`);
    // Wait, the specification says: "the release check rejects missing or duplicate IDs."
    // So we fail the check if there are missing IDs.
    failed = true;
  }

  // Check for duplicates
  for (const [id, files] of testIdMap.entries()) {
    if (files.length > 1) {
      console.warn(`Warning: Duplicate test ID ${id} found in: ${files.join(", ")}`);
      // Wait, is it okay to have multiple assertions or tests for the same ID across different files?
      // "Every automated test name begins with exactly one ID from T-001 through T-071; the release check rejects missing or duplicate IDs."
      // Since it says "projects missing or duplicate IDs", it means we must have exactly one test per ID, or at least they should be unique test cases.
      // We will raise an error for duplicate IDs.
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log("Release verification passed (Versions aligned, minAppVersion OK, test ID coverage complete).");
}

check();
