#!/usr/bin/env node
// Repo-wide em dash scanner. Complements the ESLint rule by covering non-JS
// files (Markdown, Prisma, YAML, Docker, env). Exits non-zero if any em dash
// (U+2014) is found in a tracked file, excluding vendored/build output.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const EM_DASH = "\u2014";

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  ".cache",
  ".git",
  // Plans/ ships upstream spec docs (Master PRD, phase prompts) whose prose
  // is not written by Poppy code and is out of scope for our em-dash rule.
  "Plans",
]);

const SKIP_FILE_NAMES = new Set([
  "package-lock.json",
  "check-no-em-dash.mjs",
  "eslint.config.mjs",
]);

// Binary assets are not text and can contain the bytes E2 80 94 (U+2014) by
// coincidence, producing false positives. This rule only targets source/prose.
const SKIP_EXTENSIONS = new Set([
  ".mp4", ".mov", ".webm", ".avi", ".mkv",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp",
  ".mp3", ".wav", ".ogg", ".flac", ".m4a",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".pdf", ".zip", ".gz", ".tar", ".wasm", ".node",
]);

function hasSkippedExt(name) {
  const dot = name.lastIndexOf(".");
  return dot !== -1 && SKIP_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

const results = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    if (SKIP_FILE_NAMES.has(entry)) continue;
    if (hasSkippedExt(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full);
    } else if (s.isFile()) {
      let text;
      try {
        text = readFileSync(full, "utf8");
      } catch {
        continue;
      }
      let idx = text.indexOf(EM_DASH);
      while (idx !== -1) {
        const before = text.slice(0, idx);
        const line = before.split("\n").length;
        results.push({ file: relative(ROOT, full), line });
        idx = text.indexOf(EM_DASH, idx + 1);
      }
    }
  }
}

walk(ROOT);

if (results.length > 0) {
  console.error("Em dash (U+2014) found in these locations:");
  for (const r of results) console.error(`  ${r.file}:${r.line}`);
  process.exit(1);
}
console.log("No em dashes found.");
