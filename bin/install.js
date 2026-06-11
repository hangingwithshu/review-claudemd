#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const dest = path.join(os.homedir(), ".claude", "skills", "review-claudemd");
const src = path.join(__dirname, "..", "SKILL.md");

if (!fs.existsSync(src)) {
  console.error("Error: SKILL.md not found alongside the installer.");
  process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });
fs.copyFileSync(src, path.join(dest, "SKILL.md"));
console.log(`Installed review-claudemd skill -> ${dest}`);
console.log("Invoke it inside any project with: /review-claudemd");
