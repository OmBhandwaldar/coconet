#!/usr/bin/env node
// SessionEnd marker — no-op pass-through for lifecycle signaling.
// SessionEnd does not carry transcript_path so real persistence lives in Stop.
// Pattern from affaan-m/everything-claude-code.

let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;
process.stdout.write(raw);
