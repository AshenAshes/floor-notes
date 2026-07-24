import fs from "node:fs";
import path from "node:path";

const stylesDir = "./src/styles";
const outputFile = "./styles.css";

function build() {
  if (!fs.existsSync(stylesDir)) {
    // Write empty or minimal CSS if stylesDir does not exist yet
    fs.writeFileSync(outputFile, "/* Minimal Floor Notes CSS */\n");
    return;
  }
  const files = [
    "base.css",
    "thread.css",
    "records.css",
    "modals.css",
    "favorites.css",
    "themes.css",
    "responsive.css"
  ];
  let content = "";
  for (const file of files) {
    const filePath = path.join(stylesDir, file);
    if (fs.existsSync(filePath)) {
      content += fs.readFileSync(filePath, "utf-8") + "\n";
    }
  }
  fs.writeFileSync(outputFile, content);
  console.log("CSS build completed.");
}

build();
