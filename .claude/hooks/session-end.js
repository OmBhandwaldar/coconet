#!/usr/bin/env node
// Stop hook — parses transcript, collects git state, calls Claude API (haiku) to
// generate a session narrative, then writes it between idempotent marker blocks.
//
// Pattern from affaan-m/everything-claude-code:
//   - Filename: YYYY-MM-DD-<last8ofSessionId>-session.tmp
//   - Idempotent: <!-- ECC:SUMMARY:START/END --> markers preserve user notes across
//     multiple Stop invocations within the same session
//   - File structure: metadata header → marker block → Notes for Next Session

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = path.resolve(__dirname, "../sessions");
const EXAMPLE_FILE = path.resolve(
  __dirname,
  "../sessions/2025-03-13-merging-wire-up-with-main.tmp"
);

const SUMMARY_START = "<!-- ECC:SUMMARY:START -->";
const SUMMARY_END = "<!-- ECC:SUMMARY:END -->";

// ── Read stdin ────────────────────────────────────────────────────────────────
let raw = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) raw += chunk;

// Debug: capture raw payload so we can inspect what Claude Code actually sends
fs.mkdirSync(path.resolve(__dirname, "../sessions"), { recursive: true });
fs.writeFileSync(path.resolve(__dirname, "../sessions/debug-payload.txt"), raw, "utf8");

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const transcriptPath = payload.transcript_path ?? "";
if (!transcriptPath || !fs.existsSync(transcriptPath)) process.exit(0);

// ── Parse transcript JSONL ────────────────────────────────────────────────────
const lines = fs.readFileSync(transcriptPath, "utf8").trim().split("\n");

const filesEdited = new Set();
const filesWritten = new Set();
const bashCommands = [];
const userMessages = [];

for (const line of lines) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue;
  }

  const msg = entry.message ?? entry;

  if (msg.role === "user") {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : (msg.content?.find?.((b) => b.type === "text")?.text ?? "");
    if (text.trim()) userMessages.push(text.trim().slice(0, 200));
  }

  if (msg.role !== "assistant") continue;

  for (const block of Array.isArray(msg.content) ? msg.content : []) {
    if (block.type !== "tool_use") continue;
    const { name, input } = block;

    if (name === "Edit" || name === "MultiEdit") {
      const fp = input?.file_path ?? input?.edits?.[0]?.file_path ?? "";
      if (fp) filesEdited.add(fp);
    }
    if (name === "Write") {
      const fp = input?.file_path ?? "";
      if (fp) filesWritten.add(fp);
    }
    if (name === "Bash") {
      const cmd = (input?.command ?? "").trim();
      if (cmd) bashCommands.push(cmd.slice(0, 300));
    }
  }
}

const totalActions = filesEdited.size + filesWritten.size + bashCommands.length;
if (totalActions === 0) process.exit(0);

// ── Git state ─────────────────────────────────────────────────────────────────
const REPO = path.resolve(__dirname, "../../");

function git(cmd) {
  try {
    return execSync(`git -C "${REPO}" ${cmd}`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const currentBranch = git("branch --show-current");
const lastCommit = git("log --oneline -1");
const recentCommits = git("log --oneline -6");
const projectName = path.basename(REPO);

// ── Session ID → filename ─────────────────────────────────────────────────────
const date = new Date().toISOString().slice(0, 10);
const time = new Date().toLocaleTimeString("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const filename = `${date}-session.tmp`;
const finalPath = path.join(SESSIONS_DIR, filename);

// ── Generate summary block via Claude API ─────────────────────────────────────
const example = fs.existsSync(EXAMPLE_FILE)
  ? fs.readFileSync(EXAMPLE_FILE, "utf8")
  : "";

const apiKey = process.env.ANTHROPIC_API_KEY;
let summaryBlock = "";

const interestingCmds = [...new Set(bashCommands)].filter(
  (c) => !/^git (status|log|diff|show)\b/.test(c)
);

if (apiKey) {
  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are writing the summary block for a session notes file for a software engineering project.

Your output will be placed between HTML comment markers in the file — generate ONLY the section content, no outer markers.

Use this file as your format reference (narrative prose, numbered steps, all sections filled):

<example>
${example}
</example>

Raw session data:
- First user message: ${userMessages[0] ?? ""}
- All user messages (up to 10): ${JSON.stringify(userMessages.slice(0, 10))}
- Files created: ${JSON.stringify([...filesWritten])}
- Files edited: ${JSON.stringify([...filesEdited])}
- Bash commands: ${JSON.stringify(interestingCmds)}
- Branch: ${currentBranch} | Last commit: ${lastCommit}
- Recent commits: ${recentCommits}
- Date: ${date}

Generate these five sections fully filled, no placeholders anywhere:

## What Was Completed
[Numbered steps with narrative prose — what happened and why, not flat file lists]

## What Was Attempted But Didn't Work
[Real failures/workarounds, or: "Nothing blocked this session."]

## What's Next
[Concrete numbered next steps with sub-steps inferred from what was completed.
 Project context: permissioned blockchain platform for trade finance + escrow.
 Stack: Hyperledger Fabric (TypeScript chaincode) + Polygon CDK (Solidity) + Express.js + TypeScript + MongoDB + MinIO.
 Build sequence per MVP-PLAN.md: Block 1 (foundation) → 2 (onboarding-cc) → 3 (trade-doc-cc) →
 4 (finance-cc) → 5 (escrow contracts + bridge) → 6 (wire & demo). Then Ring 1–12 expansion to full BRD.
 Identify which Block or Ring just progressed and recommend the next concrete sub-task in the same or next Block/Ring.
 Frontend portals are out of scope (solo build); demos via Postman + Swagger + block explorers.]

## Decisions Made
| Decision | Reasoning |
|---|---|
[Real decisions with genuine reasoning — no placeholder rows]

## Git State
- Current branch: ${currentBranch || "unknown"}
- Last commit: ${lastCommit || "unknown"}
- Remote: [infer sync status from commands]
- Docker: \`docker compose up\` runs Fabric test-network + Hardhat node + MongoDB + MinIO before \`npm run dev\`

Output ONLY the markdown above. No preamble, no code fences, no surrounding markers.`,
        },
      ],
    });
    summaryBlock = response.content[0]?.text?.trim() ?? "";
  } catch {
    summaryBlock = buildFallbackSummary();
  }
} else {
  summaryBlock = buildFallbackSummary();
}

// ── Write or idempotently update the session file ─────────────────────────────
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const newMarkerBlock = `${SUMMARY_START}\n${summaryBlock}\n${SUMMARY_END}`;

if (fs.existsSync(finalPath)) {
  let existing = fs.readFileSync(finalPath, "utf8");

  // Update Last Updated timestamp
  existing = existing.replace(/\*\*Last Updated:\*\* .+/, `**Last Updated:** ${time}`);
  // Update branch in case it changed mid-session
  existing = existing.replace(/\*\*Branch:\*\* .+/, `**Branch:** ${currentBranch || "unknown"}`);

  if (existing.includes(SUMMARY_START) && existing.includes(SUMMARY_END)) {
    // Replace only the generated block — everything outside markers is untouched
    const start = existing.indexOf(SUMMARY_START);
    const end = existing.indexOf(SUMMARY_END) + SUMMARY_END.length;
    existing = existing.slice(0, start) + newMarkerBlock + existing.slice(end);
  } else {
    // Markers missing — append the block before the Notes section if present
    const notesIdx = existing.indexOf("### Notes for Next Session");
    if (notesIdx !== -1) {
      existing =
        existing.slice(0, notesIdx) +
        newMarkerBlock +
        "\n\n" +
        existing.slice(notesIdx);
    } else {
      existing += "\n\n" + newMarkerBlock;
    }
  }

  fs.writeFileSync(finalPath, existing, "utf8");
} else {
  // First Stop in this session — create full file structure
  const content = [
    `# Session: ${date}`,
    `**Project:** ${projectName}`,
    `**Branch:** ${currentBranch || "unknown"}`,
    `**Started:** ${time}`,
    `**Last Updated:** ${time}`,
    ``,
    `---`,
    ``,
    newMarkerBlock,
    ``,
    `### Notes for Next Session`,
    `-`,
    ``,
    `### Context to Load`,
    ``,
  ].join("\n");

  fs.writeFileSync(finalPath, content, "utf8");
}

// ── Fallback summary when API is unavailable ──────────────────────────────────
function buildFallbackSummary() {
  const out = [];

  // ── What Was Completed ──────────────────────────────────────────────────────
  out.push(`## What Was Completed`, ``);

  const allFiles = [...filesWritten, ...filesEdited];
  const chaincodes  = allFiles.filter((f) => f.includes("/chaincodes/"));
  const contracts   = allFiles.filter((f) => f.includes("/contracts/") || /\.sol$/.test(f));
  const fabricSdk   = allFiles.filter((f) => f.includes("/api/fabric/"));
  const polygonSdk  = allFiles.filter((f) => f.includes("/api/polygon/"));
  const services    = allFiles.filter((f) => f.includes("/api/services/"));
  const routes      = allFiles.filter((f) => f.includes("/api/routes/") || f.includes("/api/controllers/"));
  const middleware  = allFiles.filter((f) => f.includes("/api/middleware/"));
  const adapters    = allFiles.filter((f) => f.includes("/api/adapters/"));
  const models      = allFiles.filter((f) => f.includes("/api/models/") || f.includes("/api/validators/"));
  const fabricNet   = allFiles.filter((f) => f.includes("/fabric-network/"));
  const scripts     = allFiles.filter((f) => f.includes("/scripts/"));
  const planDocs    = allFiles.filter((f) => /(PLAN|CLAUDE|MVP-PLAN|README)\.md$/i.test(f));
  const configFiles = allFiles.filter((f) => /docker-compose|hardhat\.config|tsconfig|package\.json|\.env/.test(f));
  const categorized = new Set([
    ...chaincodes, ...contracts, ...fabricSdk, ...polygonSdk, ...services, ...routes,
    ...middleware, ...adapters, ...models, ...fabricNet, ...scripts, ...planDocs, ...configFiles,
  ]);
  const otherFiles  = allFiles.filter((f) => !categorized.has(f));

  let step = 1;

  const pushSection = (label, files, useFullPath = false) => {
    if (files.length === 0) return;
    const created = files.filter((f) => filesWritten.has(f));
    const edited  = files.filter((f) => filesEdited.has(f));
    out.push(`### ${step++}. ${label}`);
    const fmt = (f) => `\`${useFullPath ? f : path.basename(f)}\``;
    if (created.length) out.push(`**Created:** ${created.map(fmt).join(", ")}`);
    if (edited.length)  out.push(`**Updated:** ${edited.map(fmt).join(", ")}`);
    out.push(``);
  };

  pushSection("Fabric chaincodes", chaincodes);
  pushSection("Solidity contracts", contracts);
  pushSection("Fabric SDK clients", fabricSdk);
  pushSection("Polygon clients", polygonSdk);
  pushSection("API services", services);
  pushSection("API routes / controllers", routes);
  pushSection("Middleware", middleware);
  pushSection("Integration adapters", adapters);
  pushSection("Models / validators", models);
  pushSection("Fabric network config", fabricNet);
  pushSection("Scripts", scripts);
  pushSection("Plan / docs", planDocs);
  pushSection("Config", configFiles);
  pushSection("Other files", otherFiles, true);
  if (interestingCmds.length > 0) {
    const gitCmds = interestingCmds.filter((c) => /^git (commit|push|checkout|merge)/.test(c));
    if (gitCmds.length > 0) {
      out.push(`### ${step++}. Git operations`);
      out.push(gitCmds.map((c) => `- \`${c.slice(0, 120)}\``).join("\n"));
      out.push(``);
    }
  }

  if (step === 1) {
    out.push(`No files written or edited this session.`, ``);
  }

  // ── What Was Attempted But Didn't Work ─────────────────────────────────────
  const failSignals = interestingCmds.filter((c) => /\bfail|error|fix\b/i.test(c));
  out.push(`## What Was Attempted But Didn't Work`, ``);
  if (failSignals.length > 0) {
    out.push(`Commands that may indicate issues:`);
    failSignals.slice(0, 4).forEach((c) => out.push(`- \`${c.slice(0, 120)}\``));
  } else {
    out.push(`Nothing blocked this session.`);
  }
  out.push(``);

  // ── What's Next ─────────────────────────────────────────────────────────────
  out.push(`## What's Next`, ``);
  out.push(...inferWhatsNext());
  out.push(``);

  // ── Decisions Made ──────────────────────────────────────────────────────────
  out.push(`## Decisions Made`, ``, `| Decision | Reasoning |`, `|---|---|`);
  // Infer decisions from file patterns
  if (chaincodes.length > 0 && services.length > 0) {
    out.push(`| Wired chaincode + API service together | Routes → Controllers → Services → Fabric SDK pattern from CLAUDE.md |`);
  }
  if (contracts.length > 0 && polygonSdk.length > 0) {
    out.push(`| Connected Solidity contract to API via ethers.js | Express → ethers.js → Polygon CDK chain |`);
  }
  if (allFiles.some((f) => f.includes("bridge.service"))) {
    out.push(`| Bridge service updated | Fabric ↔ Polygon event correlation via \`escrowPaymentId\` |`);
  }
  if (planDocs.length > 0) {
    out.push(`| Plan / spec doc updated | Keeps PLAN.md, CLAUDE.md, MVP-PLAN.md aligned with build progress |`);
  }
  out.push(``);

  // ── Git State ───────────────────────────────────────────────────────────────
  out.push(
    `## Git State`,
    ``,
    `- Current branch: ${currentBranch || "unknown"}`,
    `- Last commit: ${lastCommit || "unknown"}`,
    `- Docker: \`docker compose up\` runs Fabric test-network + Hardhat node + MongoDB + MinIO before \`npm run dev\``
  );

  return out.join("\n");
}

function inferWhatsNext() {
  const branch = currentBranch.toLowerCase();
  const commit = lastCommit.toLowerCase();
  const msgs   = userMessages.join(" ").toLowerCase();
  const files  = [...filesWritten, ...filesEdited].join(" ").toLowerCase();
  const blob   = `${branch} ${commit} ${msgs} ${files}`;

  const has = (...keywords) => keywords.some((k) => blob.includes(k));

  // Block 6 — wire & demo signals → MVP complete, start Ring 1
  if (has("postman", "integration test", "demo", "/health", "end-to-end")) {
    return [
      `### 1. MVP demo verified — confirm 14-step Tata/Bharat/HDFC flow runs green`,
      `   - All Postman steps pass`,
      `   - Jest integration test green against live Fabric + Polygon`,
      ``,
      `### 2. Start Ring 1 — real \`audit-cc\` (target ~1–2 weeks)`,
      `   a. \`audit-cc\` chaincode with \`logEvent\` properly stored on chain`,
      `   b. Auto-invoke \`audit-cc.logEvent\` from every state transition in other chaincodes`,
      `   c. \`generateAuditPack(entityId, entityType)\` — FR-REP-02`,
      `   d. Verify NFR-05 — every action timestamped, signed, traceable`,
    ];
  }

  // Block 5 — escrow contracts + bridge → Block 6
  if (has("escrowfactory", "escrowvault", "bridge.service", "bridge-service", "ethers")) {
    return [
      `### 1. Finish Block 5 — bridge service end-to-end`,
      `   - \`InvoiceApproved\` Fabric event → Polygon \`updateDeliveryAcceptance\` → release fires`,
      `   - \`escrowPaymentId\` correlation working both directions`,
      `   - Polygon \`FundsReleased\` event → Fabric audit stub`,
      ``,
      `### 2. Start Block 6 — wire & demo (target ~2 weeks)`,
      `   a. Postman collection covering all 14 steps of the Tata/Bharat/HDFC flow`,
      `   b. Jest integration test that runs the full flow against live Fabric + Polygon`,
      `   c. README — \`docker compose up && npm run demo\` one-command setup`,
      `   d. Add Hyperledger Explorer + Blockscout to docker-compose for visual demo`,
    ];
  }

  // Block 4 — finance-cc → Block 5
  if (has("finance-cc", "finance.service", "lockasset", "pre-shipment", "invoice-discounting", "rule-02")) {
    return [
      `### 1. Finish Block 4 — finance-cc validation`,
      `   - Rule-01 (invoice eligibility) + Rule-02 (duplicate financing prevention) enforced`,
      `   - Net settlement at invoice discounting deducting pre-shipment loan + interest`,
      `   - State machine: Requested → Validating → UnderReview → Offered → Accepted → Disbursed`,
      ``,
      `### 2. Start Block 5 — escrow contracts + bridge (target ~3 weeks)`,
      `   a. \`EscrowFactory.sol\` — \`createEscrowInstruction\``,
      `   b. \`EscrowVault.sol\` — \`fundEscrow\` + \`release\` with 1–2 inline conditions`,
      `   c. Bridge service skeleton — listen for \`InvoiceApproved\` → mark Polygon condition true`,
      `   d. \`/api/escrow\` routes (create, fund, status)`,
    ];
  }

  // Block 3 — trade-doc-cc → Block 4
  if (has("trade-doc-cc", "purchase-order", "three-way", "matchinvoice", "createpo", "submitinvoice")) {
    return [
      `### 1. Finish Block 3 — trade-doc-cc 3-way match`,
      `   - PO + GRN + Invoice match logic correct`,
      `   - State machine enforcement (Issued → Acknowledged → Locked → Fulfilled)`,
      `   - Document hash service (SHA-256) integrated with MinIO upload`,
      ``,
      `### 2. Start Block 4 — finance-cc (target ~2–3 weeks)`,
      `   a. \`createFinanceRequest\`, \`validateEligibility\` (Rule-01, Rule-02)`,
      `   b. \`submitQuote\`, \`approveFinancing\`, \`lockAsset\`, \`disburseFunds\``,
      `   c. \`/api/finance/pre-shipment\` + \`/api/finance/invoice-discounting\` routes`,
      `   d. Net settlement service for loan + interest deduction at discounting`,
    ];
  }

  // Block 2 — onboarding-cc → Block 3
  if (has("onboarding-cc", "createorganization", "fabric-ca", "assignrole", "maker-checker")) {
    return [
      `### 1. Finish Block 2 — 5 orgs registered + approved`,
      `   - Tata, Bharat, HDFC, Platform, Auditor enrolled with Fabric CA certs`,
      `   - Maker-checker thresholds configured per org`,
      ``,
      `### 2. Start Block 3 — trade-doc-cc (target ~3 weeks)`,
      `   a. \`createPO\`, \`acknowledgePO\` with state machine enforcement`,
      `   b. \`submitInvoice\`, \`runThreeWayMatch\`, \`approveInvoice\``,
      `   c. \`/api/trade-docs\` routes (PO + GRN + Invoice)`,
      `   d. MinIO document upload + SHA-256 hashing service`,
    ];
  }

  // Block 1 — foundation → Block 2
  if (has("docker-compose", "fabric-network", "hardhat", "/health", "gateway.ts", "provider.ts", "fabric-samples")) {
    return [
      `### 1. Finish Block 1 — foundation healthy`,
      `   - Fabric test-network up, Hardhat node up, MongoDB + MinIO running`,
      `   - \`GET /health\` returns 200 with all subsystems reachable`,
      `   - Fabric Gateway connection + Polygon provider connection both verified from API`,
      ``,
      `### 2. Start Block 2 — onboarding-cc (target ~1–2 weeks)`,
      `   a. \`onboarding-cc\`: \`createOrganization\`, \`updateOrganizationStatus\`, \`assignRole\``,
      `   b. Fabric CA enrollment script per org`,
      `   c. \`/api/onboarding\` routes`,
      `   d. Postman collection: register + approve all 5 orgs`,
    ];
  }

  // Ring detection (post-MVP) — coarser, point at MVP-PLAN.md
  if (has("audit-cc", "logevent", "auditpack")) {
    return [`### Continue Ring 1 — \`audit-cc\` auto-logging across all chaincodes. See MVP-PLAN.md.`];
  }
  if (has("provenance-cc", "recordcustody", "recordinspection", "exception-flag")) {
    return [`### Continue Ring 2 — \`provenance-cc\` + Rule-04 exception holds. See MVP-PLAN.md.`];
  }
  if (has("dispute-cc", "raisedispute", "resolvedispute", "rule-0c")) {
    return [`### Continue Ring 3 — \`dispute-cc\` + Rule-0C refund flow. See MVP-PLAN.md.`];
  }
  if (has("financingtermspdc", "escrowamountspdc", "sanctionsresultpdc", "private data")) {
    return [`### Continue Ring 4 — all 3 PDCs (financingTermsPDC, escrowAmountsPDC, sanctionsResultPDC). See MVP-PLAN.md.`];
  }
  if (has("lender-channel", "auditor-channel")) {
    return [`### Continue Ring 5 — add lender-channel + auditor-channel. See MVP-PLAN.md.`];
  }
  if (has("fundingmanager", "creditbacked", "reserved")) {
    return [`### Continue Ring 6 — FundingManager + Reserved + CreditBacked funding models. See MVP-PLAN.md.`];
  }
  if (has("releaseconditionevaluator")) {
    return [`### Continue Ring 7 — ReleaseConditionEvaluator + 6 release conditions. See MVP-PLAN.md.`];
  }
  if (has("warehouse-receipt", "post-shipment", "dynamic-discounting", "distributor")) {
    return [`### Continue Ring 9 — remaining 5 finance products. See MVP-PLAN.md.`];
  }
  if (has("sanctions", "screensanctions")) {
    return [`### Continue Ring 10 — sanctions screening at 5 checkpoints. See MVP-PLAN.md.`];
  }
  if (has("adapter", "openapi", "swagger")) {
    return [`### Continue Ring 12 — adapters + OpenAPI/Swagger + Postman polish. See MVP-PLAN.md.`];
  }

  // Generic — couldn't detect Block/Ring
  return [
    `### 1. Check current Block/Ring status in MVP-PLAN.md`,
    ``,
    `### 2. Continue with the in-progress Block or start the next one`,
    `   - MVP path: Block 1 → 2 → 3 → 4 → 5 → 6 (working demo at Block 6, ~17 weeks)`,
    `   - Post-MVP: Ring 1 (audit) → 2 (provenance) → 3 (disputes) → 4 (PDCs) → 5 (channels) → 6 (funding) → 7 (release eval) → 8 (asset types) → 9 (finance products) → 10 (sanctions) → 11 (maker-checker) → 12 (adapters/polish)`,
  ];
}
