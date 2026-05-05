#!/usr/bin/env node
// SessionStart hook — injects the latest session notes so Claude has prior
// context immediately. Picks up both the new *-session.tmp naming pattern
// (from the ECC-style session-end hook) and any legacy *.tmp files.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.resolve(__dirname, "../sessions");

// Consume stdin (SessionStart passes session JSON — not needed here)
for await (const _ of process.stdin) {}

if (!fs.existsSync(SESSIONS_DIR)) process.exit(0);

const latest = fs.readdirSync(SESSIONS_DIR)
  .filter((f) => f.endsWith(".tmp"))
  .map((f) => ({ f, mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime)[0]?.f;

if (!latest) process.exit(0);

const content = fs.readFileSync(path.join(SESSIONS_DIR, latest), "utf8");

// Strip ECC marker comments before injecting — Claude doesn't need to see them
const cleaned = content
  .replace(/<!-- ECC:SUMMARY:START -->\n?/g, "")
  .replace(/<!-- ECC:SUMMARY:END -->\n?/g, "");

console.log("==============================");
console.log(" PREVIOUS SESSION NOTES LOADED");
console.log(` File: ${latest}`);
console.log("==============================");
console.log(cleaned);
console.log("==============================");
console.log(" END OF SESSION NOTES");
console.log("==============================");
