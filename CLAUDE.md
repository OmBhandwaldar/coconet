# CLAUDE.md — Project Context & Build Guide

This file is the authoritative context for anyone (including Claude) working on this project. It is derived directly from the BRD/SRS (`Permissioned_blockchain_escrow_final_BRD_SRS v1.1 — 12 April 2026`) and the detailed build plan in [PLAN.md](PLAN.md).

---

## 1. Project Overview

**Project name:** Permissioned Blockchain Platform for Supply Chain Provenance, Invoice Financing, Corporate Financing, and Programmable Money Escrow.

**Purpose:** A consortium-grade permissioned blockchain platform that unifies:
- Supply chain provenance & traceability
- Trade document integrity (PO, GRN, Invoice)
- Invoice financing / bill discounting
- Corporate financing analytics
- Buyer-funded programmable money escrow

**Business motivation:** Most trade finance today is fragmented across email, ERP portals, banking portals, and manual escrow arrangements. This platform unifies provenance, receivables authenticity, financing, escrow, and audit on a single shared event chain so payment and settlement can be triggered from verified commercial events.

**Target deployment:** Permissioned enterprise blockchain network with controlled member access, private data partitions, smart contracts, programmable escrow wallets, buyer prefunding options, and treasury integrations.

---

## 2. Strict Scope Rules (MUST FOLLOW)

> **Build ONLY what is in the BRD. Nothing more. Nothing less.**

### In scope (BRD Section 5)
- Purchase order finance
- Pre-shipment finance
- Post-shipment finance
- Invoice discounting / bill discounting / receivables finance
- Dynamic discounting and early-payment programs
- Warehouse receipt financing
- Distributor and dealer financing
- Corporate financing analytics supported by validated trade flows
- Buyer-funded programmable money escrow and rule-based supplier payment release

### Out of scope (BRD Section 6)
- Public blockchain exposure and public token trading
- Retail-user participation
- Unrestricted anonymous onboarding
- Automated legal advice or regulatory determination engine
- Full customs filing replacement or full banking core replacement

### Deferred to future phases (not in current build)
- **RDM Token** — explicitly a future phase. Do NOT include tokenization logic in the current build.

---

## 3. Tech Stack

| Layer | Technology | Language |
|---|---|---|
| Permissioned Blockchain — Workflow/Documents/Finance | Hyperledger Fabric | TypeScript (chaincode) |
| Permissioned Blockchain — Escrow/Payments | Polygon Supernet (CDK) | Solidity (smart contracts) |
| API Server | Express.js | TypeScript |
| Frontend Portals | Next.js | TypeScript |
| Off-chain Query DB | MongoDB | — |
| Off-chain Reporting DB | PostgreSQL | — |
| Document Storage | S3 / MinIO | — |
| PKI | Hyperledger Fabric CA | — |
| Fabric SDK (in API) | `fabric-network` + `fabric-gateway` | TypeScript |
| EVM SDK (in API) | `ethers.js` v6 | TypeScript |
| Chaincode framework | `fabric-contract-api` | TypeScript |
| Monitoring | Prometheus + Grafana | — |

**One language rule:** TypeScript is used for chaincode + API + frontend. Solidity only for Polygon smart contracts. Do not propose Go, Java, Rust, or any other language.

---

## 4. Chain Responsibility Split

This is a **dual-chain architecture**. Never mix responsibilities.

### Hyperledger Fabric — Identity, Documents, Workflow, Finance, Disputes, Audit

| Chaincode | BRD Ref | Responsibility |
|---|---|---|
| `onboarding-cc` | FR-ONB-01 to FR-ONB-04, BR-01 | KYB, membership, roles, maker-checker thresholds |
| `provenance-cc` | FR-PROV-01 to FR-PROV-04, BR-03 | Items, batches, custody, inspection, exceptions |
| `trade-doc-cc` | FR-DOC-01 to FR-DOC-04, BR-02 | PO, GRN, Invoice, 3-way/4-way match, duplicate blocking |
| `finance-cc` | FR-FIN-01 to FR-FIN-04, BR-04, BR-05 | All 7 finance products, eligibility, asset locking |
| `dispute-cc` | FR-RSK-01 to FR-RSK-04, BR-11 | Dispute lifecycle, holdbacks, overrides, escalation |
| `audit-cc` | FR-REP-01 to FR-REP-04, BR-08 | Audit trails, evidence packs, observer access |

### Polygon Supernet — Programmable Money Escrow ONLY

| Contract | BRD Ref | Responsibility |
|---|---|---|
| `FundingManager.sol` | FR-ESC-02, Rule-0A | Prefunded / Reserved / CreditBacked funding |
| `EscrowFactory.sol` | FR-ESC-01, BR-12 | Create escrow payment instructions |
| `ReleaseConditionEvaluator.sol` | FR-ESC-03, Rule-0B | Evaluate all release conditions |
| `EscrowVault.sol` | FR-ESC-04, BR-12 | Hold, release, refund, reverse funds |

### Bridge Service (Node.js, part of API layer)
- Listens to Fabric block events → updates Polygon release conditions
- Listens to Polygon events → writes settlement confirmations to Fabric `audit-cc`
- **Correlation key: `escrowPaymentId`** — shared identifier across both chains
- Lives in [api/services/bridge.service.ts](api/services/bridge.service.ts)

---

## 5. Channels & Private Data Collections (PDCs)

### Fabric Channels
| Channel | Members |
|---|---|
| `buyer-supplier-channel` | Buyer, Supplier, Platform |
| `lender-channel` | Lender, Supplier, Platform |
| `auditor-channel` | Auditor, Platform (read-only) |

### Fabric PDCs (privacy by design — BRD NFR-06)
| PDC | Visible To |
|---|---|
| `financingTermsPDC` | Lender + Supplier only |
| `escrowAmountsPDC` | Buyer treasury only |
| `sanctionsResultPDC` | Platform only |

**Rule:** Confidential financing terms (rates, fees, tenor) go in PDCs — never on the main channel.

---

## 6. Business Requirements (BRD Section 7)

All 12 business requirements must be implemented. Every feature should map to one or more of these.

| ID | Requirement | Implemented In |
|---|---|---|
| BR-01 | Onboard organizations via consortium-approved KYC/KYB and role assignment | `onboarding-cc` |
| BR-02 | Register POs, GRNs, invoices, warehouse receipts, financing assets with immutable history | `trade-doc-cc`, `finance-cc` |
| BR-03 | Capture provenance & chain-of-custody events | `provenance-cc` |
| BR-04 | Determine finance eligibility using configurable rules | `finance-cc` |
| BR-05 | Prevent duplicate financing | `finance-cc` (Rule-02 enforcement) |
| BR-06 | Selective data visibility via PDCs | Fabric channel + PDC config |
| BR-07 | Integrate with ERP, WMS, TMS, banking, DMS, e-sign, alerting | `api/adapters/*` |
| BR-08 | Provide audit-ready evidence packs | `audit-cc` |
| BR-09 | Configurable maker-checker and multi-level approvals | All chaincodes + `api/middleware/rbac.middleware.ts` |
| BR-10 | Multi-anchor, multi-supplier, multi-lender programs | `finance-cc`, config |
| BR-11 | Single shared buyer-supplier interaction layer | Portals + all chaincodes |
| BR-12 | Programmable money & escrow controls | Polygon contracts + bridge |

---

## 7. Business Rules & Validation Logic (BRD Section 20)

These rules MUST be enforced at the chaincode / smart contract layer, not just the API layer.

| Rule | Name | Enforced In |
|---|---|---|
| Rule-0A | Escrow Funding Confirmation — no release evaluation until funded | `FundingManager.sol`, `EscrowVault.sol` |
| Rule-0B | Conditional Release — release only when ALL conditions = true | `ReleaseConditionEvaluator.sol` |
| Rule-0C | Refund / Reversal Priority — dispute/cancel before release → refund | `EscrowVault.sol` + `dispute-cc` |
| Rule-01 | Invoice Eligibility — link to valid supplier, buyer, PO, and GRN/acceptance | `finance-cc` + `trade-doc-cc` |
| Rule-02 | Duplicate Financing Prevention — no active lien/assignment on same asset | `finance-cc` |
| Rule-03 | Advance Rate — based on program, asset type, buyer quality, event completeness | `finance-cc` |
| Rule-04 | Exception Hold — disputes/quality failures/custody breaks put financing on hold | `provenance-cc` → `finance-cc` |
| Rule-05 | Release Control — warehouse release requires lien-free or override | `provenance-cc` + `dispute-cc` |
| Rule-06 | Threshold Approval — multi-level approval for high-value transactions | All chaincodes + services |

---

## 8. Non-Functional Requirements (BRD Section 19)

| NFR | Category | Requirement |
|---|---|---|
| NFR-01 | Security | Encryption in transit + at rest for all off-chain data |
| NFR-02 | Availability | 99.9%+ uptime |
| NFR-03 | Performance | Trade-event confirmation ≤ 5 seconds under expected load |
| NFR-04 | Scalability | Multi-anchor, multi-supplier, multi-lender across programs |
| NFR-05 | Auditability | All critical actions timestamped, signed, traceable to user + org |
| NFR-06 | Privacy | Bilateral financing data not visible to non-participating members (PDCs) |
| NFR-07 | Recoverability | Backup, restore, disaster-recovery procedures |
| NFR-08 | Interoperability | Documented APIs + integration adapters for enterprise systems |

---

## 9. Data Models (BRD Sections 21–27)

All 8 data models must match BRD field definitions exactly. Do not add fields unless added to the BRD first.

1. **Organization Master** (Section 21) — [api/models/organization.model.ts](api/models/organization.model.ts)
2. **Purchase Order** (Section 22) — [api/models/purchase-order.model.ts](api/models/purchase-order.model.ts)
3. **Goods Receipt / Acceptance** (Section 23) — [api/models/grn.model.ts](api/models/grn.model.ts)
4. **Invoice / Receivable** (Section 24) — [api/models/invoice.model.ts](api/models/invoice.model.ts)
5. **Provenance Event** (Section 25) — [api/models/provenance-event.model.ts](api/models/provenance-event.model.ts)
6. **Finance Request** (Section 26) — [api/models/finance-request.model.ts](api/models/finance-request.model.ts)
7. **Escrow Payment Instruction** (Section 26A) — [api/models/escrow-payment.model.ts](api/models/escrow-payment.model.ts)
8. **Warehouse Receipt** (Section 27) — [api/models/warehouse-receipt.model.ts](api/models/warehouse-receipt.model.ts)

---

## 10. State Machines (BRD Section 29)

State transitions MUST be enforced at the chaincode/smart contract layer. Do not allow illegal transitions.

| Entity | States |
|---|---|
| Purchase Order | Draft → Issued → Acknowledged → Amended → Locked → Fulfilled → Closed |
| Invoice | Draft → Submitted → Matched → Approved → Eligible → Assigned → Settled / Disputed → Closed |
| Finance Request | Requested → Validating → Under Review → Offered → Accepted → Disbursed → Repaid / Defaulted → Recovered → Closed |
| Escrow Payment | Created → Funded → Reserved → Held → Pending Release → Partially Released → Released / Refunded / Reversed → Closed |
| Provenance Event | Captured → Validated → Shared → Superseded |
| Warehouse Receipt | Active → Pledged → Released → Cancelled |
| Organization | Pending → Approved → Suspended → Closed |

---

## 11. Escrow Funding Models & Asset Links

> **Settlement currency (MVP decision):** escrow currently settles in **USD via a USDC/USDT-style ERC-20** on the Polygon Supernet (locally a mock `MockUSDC`), **not INR**. This is a deliberate MVP simplification — USD stablecoins are real and standard, whereas a regulated INR-pegged settlement token is deferred (tied to the future RDM token, §2). The worked example's INR figures carry their USD equivalent in oblique form `₹INR / $USD` at a fixed **1 USD = ₹92**. Production would swap the mock for an INR-pegged regulated token and drop the FX assumption.

From BRD Section 26A. The platform must support all 3 funding models × 5 asset-link types = **15 combinations**. The buyer chooses both when creating the escrow.

### Funding Models (`funding_model` field)
| Model | Meaning |
|---|---|
| **Prefunded** | Buyer deposits real cash into escrow vault at creation |
| **Reserved** | Buyer earmarks funds in treasury — no cash moved until release |
| **CreditBacked** | Bank guarantee / credit line backs the escrow — no cash moved |

### Linked Asset Types (`linked_asset_type` field)
| Type | Escrow Created When |
|---|---|
| **PO** | At order stage (earliest) |
| **GRN** | After delivery acceptance |
| **Invoice** | After invoice approval (most common) |
| **FinanceRequest** | Tied to a financing event |
| **Milestone** | In stages, as milestones complete |

---

## 12. Project Folder Structure

```
/project-root
│
├── CLAUDE.md                        — This file
├── PLAN.md                          — Detailed phased build plan
│
├── /fabric-network/                 — Hyperledger Fabric network config
│   ├── /config/
│   ├── /crypto-config/
│   ├── /channel-artifacts/
│   └── /docker-compose/
│
├── /chaincodes/                     — TypeScript chaincodes (6 total)
│   ├── /onboarding-cc/
│   ├── /provenance-cc/
│   ├── /trade-doc-cc/
│   ├── /finance-cc/
│   ├── /dispute-cc/
│   └── /audit-cc/
│
├── /contracts/                      — Solidity contracts (4 total)
│   ├── EscrowFactory.sol
│   ├── EscrowVault.sol
│   ├── ReleaseConditionEvaluator.sol
│   └── FundingManager.sol
│
├── /api/                            — Express.js + TypeScript server
│   ├── app.ts
│   ├── server.ts
│   ├── /routes/                     — 9 route files
│   ├── /controllers/                — 8 controllers
│   ├── /services/                   — 9 services (incl. bridge.service.ts)
│   ├── /middleware/                 — auth, rbac, validate, error, logger
│   ├── /fabric/                     — Fabric gateway + 6 chaincode clients
│   ├── /polygon/                    — ethers.js provider + 4 contract clients
│   ├── /adapters/                   — ERP, WMS, TMS, banking, DMS, notifications   // Mocked where no external system exists (solo build)
│   ├── /models/                     — 8 data models
│   ├── /validators/                 — Request validators
│   └── /config/                     — Fabric, Polygon, DB, env config
│
├── /portals/                        — Next.js + TypeScript UIs (3 total)   // Out of scope for solo build
│   ├── /buyer-supplier/             — Shared buyer-supplier workspace      // Out of scope for solo build
│   ├── /lender/                     — Lender portal                        // Out of scope for solo build
│   └── /admin-auditor/              — Admin + auditor UI                   // Out of scope for solo build
│
└── /scripts/                        — Deployment & setup scripts
```

---

## 13. Build Phases (from [PLAN.md](PLAN.md))

**Total: ~48 weeks (~12 months), 11-person team.**

| Phase | What | Weeks |
|---|---|---|
| 1 | Fabric + Polygon setup + Express scaffold + Onboarding | 1–6 |
| 2 | Trade Document core (PO / GRN / Invoice / 3-way / 4-way match) | 7–12 |
| 3 | Provenance & Traceability | 13–16 |
| 4 | Finance Module — all 7 products | 17–24 |
| 5 | Programmable Money Escrow (Polygon + Bridge) | 25–32 |
| 6 | Risk, Dispute & Audit | 33–37 |
| 7 | Integrations + all 3 Portals | 37–44 |
| 8 | NFRs, Security, Production Readiness | 45–48 |

Each phase has detailed chaincode functions + Express routes documented in [PLAN.md](PLAN.md).

---

## 14. Coding Conventions

### General
- **Language:** TypeScript strict mode (`"strict": true`), no `any` unless absolutely unavoidable
- **Imports:** Absolute imports via tsconfig paths, no deep relative paths
- **Async:** Always `async/await`, no raw Promise chains
- **Errors:** Typed error classes in `api/errors/`, never throw plain strings
- **Logging:** Use the centralized logger from `api/config/logger.ts`, not `console.log`

### Chaincode (TypeScript)
- Use `fabric-contract-api` decorators
- Every function that changes state MUST emit an event for the bridge / audit to consume
- Every state transition MUST call `audit-cc.logEvent()` for NFR-05
- Use PDCs for confidential data — never put financing terms on the main channel

### Solidity
- Pragma `^0.8.20` or higher
- Use OpenZeppelin libraries for access control (`Ownable`, `AccessControl`)
- Emit events for every state-changing action (so bridge can reflect to Fabric)
- No dynamic loops over user-supplied arrays (gas/security)
- All external calls use Checks-Effects-Interactions pattern

### Express.js
- **Routes → Controllers → Services → Fabric SDK / ethers.js**
- Controllers never touch the blockchain directly
- Services are the only layer that talks to Fabric or Polygon clients
- Validation middleware runs before controllers (`api/middleware/validate.middleware.ts`)
- RBAC middleware enforces role permissions from `onboarding-cc` (`api/middleware/rbac.middleware.ts`)

### Naming
- `camelCase` for TypeScript variables/functions
- `PascalCase` for TypeScript classes, Solidity contracts
- `snake_case` for MongoDB/PostgreSQL columns (matches BRD field definitions)
- `kebab-case` for file names and API routes
- Chaincode IDs: `<module>-cc` (e.g., `finance-cc`)

---

## 15. Cross-Cutting Concerns (MUST implement everywhere)

### Document Hashes
Every document (PO, GRN, invoice, WR, inspection report, etc.) MUST have its fingerprint (SHA-256) stored on-chain — BRD FR-DOC-02. Raw documents live in S3/MinIO; only the hash is on-chain.

### Sanctions Screening
Run at multiple points, not just one:
- At organization onboarding (`onboarding-cc`)
- At PO creation (buyer + supplier)
- At finance request approval (all parties)
- At escrow creation (all parties)
- At escrow release (final check)

Result goes into `sanctionsResultPDC` (platform-only visibility).

### Maker-Checker
Every critical action above a configurable threshold requires two signatures:
- **Maker:** initiates the action
- **Checker:** approves/rejects with reason

Thresholds configured per org + per transaction type via `onboarding-cc.setMakerCheckerThreshold()`.

### Correlation IDs
Every API request gets a correlation ID (UUID) that flows through all services, chaincodes, and adapter calls — BRD Section 28. Used for end-to-end tracing.

### Idempotency
All adapter inbound webhooks and external integration calls MUST be idempotent via an idempotency key — BRD Section 28.

### Audit Logging
Every chaincode state transition auto-calls `audit-cc.logEvent()` — enforces NFR-05. No action is exempt.

---

## 16. Key Workflows to Remember

### End-to-End Trade Flow
1. Buyer creates PO → internal maker-checker → PO issued
2. Supplier acknowledges PO → status: Acknowledged
3. (Optional) Supplier applies for pre-shipment finance → lender offer → acceptance → disbursement → asset lock on PO
4. Production events recorded on `provenance-cc`, linked to PO + finance request
5. Goods stored at warehouse → warehouse receipt issued
6. Goods dispatched + delivered → logistics events recorded
7. Buyer inspects → GRN with accepted/rejected qty → maker-checker approval
8. Supplier raises invoice → 3-way match auto-runs → matched
9. Buyer maker-checker approves invoice → status: Approved → Eligible
10. (Optional) Invoice discounting: supplier offers invoice to lender → lender maker-checker → disbursement with pre-shipment loan net settlement → invoice assigned to lender
11. Buyer creates escrow (linked to Invoice + chosen funding model) → funded
12. 6 conditions evaluated: delivery, invoice approval, sanctions, senior approval, funding, no active dispute
13. All conditions true → escrow auto-releases to beneficiary (lender or supplier per ownership)
14. Audit evidence pack available on demand

### Dispute Path (alternate)
- Dispute raised at any stage → `dispute-cc` → bridge notifies Polygon → escrow held
- Both parties submit evidence → mediator resolves
- Outcome: full release / refund / split settlement — Rule-0C

---

## 17. Real Example Reference

The full 14-step worked example lives in **[EXAMPLE-FLOW.md](EXAMPLE-FLOW.md)** — Tata Motors + Bharat Stampings + HDFC Bank + SecureStore + BlueDart, walking through a ₹2.47 crore deal end-to-end including pre-shipment finance, invoice discounting, escrow with net settlement, and final payment breakdown. Also covers the company onboarding UX (Stages 1–11).

**Read EXAMPLE-FLOW.md when:** building a chaincode function, writing a Postman request, or implementing a state transition — the story tells you who calls what with what data. Field names and amounts there are authoritative.

Key math in that example (for anyone implementing):
- Invoice discounting: HDFC pays supplier `invoice × (1 - discount_rate)` → collects full `invoice` from escrow → profit = discount
- Net settlement at discounting: platform auto-deducts pre-shipment loan + interest from discounting proceeds
- When lender owns invoice (`assignment_status = Assigned`), escrow beneficiary is lender, not supplier

---

## 18. Git & Branching

- **Main branch:** `main` (production-ready)
- **Feature branches:** `feat/<phase>-<short-desc>` (e.g., `feat/phase1-onboarding-cc`)
- **Fix branches:** `fix/<short-desc>`
- **Commit messages:** Imperative mood, reference BRD section or FR ID where applicable (e.g., `feat(onboarding-cc): add createOrganization per FR-ONB-01`)

---

## 19. Testing Requirements

### Strategy: 4 layers, each at a different cadence

| Layer | Scope | When written | When run |
|---|---|---|---|
| **Unit** | One chaincode function / one Solidity function / one API service method | Same commit as the code | Watch mode (every save) |
| **Component** | One chaincode on local Fabric / one contract on Hardhat | When function/method complete | Before commit |
| **Integration** | API + Fabric + Polygon together for a Block's slice | End of each Block | Before commit + end of day |
| **End-to-end (E2E)** | Full 14-step Tata/Bharat/HDFC flow | Built once at end of Block 6, extended per Ring | Before merging any change post-MVP |

You don't pick one — you build all four, layered. From MVP-PLAN.md: "Postman first" — define each step's request before writing chaincode.

### Tools per layer

| Layer | Runner | Notes |
|---|---|---|
| Chaincode unit + component | **Mocha + chai + sinon** | Per Hyperledger convention |
| Solidity unit + component | **Hardhat + chai** (Mocha-under-the-hood) | + `solidity-coverage` for ≥ 90% target |
| API unit + integration + E2E | **Vitest** | Native ESM (`ethers.js v6` is ESM-only — saves Jest config gymnastics) |
| E2E manual / demo | **Postman + Newman** | Master collection covers all 14 steps |
| Type-check / lint | `tsc --noEmit` + ESLint + prettier | On save |

Two test runners total: Mocha (chaincode + Solidity) and Vitest (API). Vitest's API is Jest-compatible — `describe`, `it`, `expect`, mocks all work the same.

### Cadence

**Per function** — write the function and its unit test in the same commit. Don't accept "I'll add tests later" — solo means no one else catches the gap.

**Per endpoint** — add a Postman request to the master collection. Postman doubles as spec and manual smoke test.

**Per Block** — block-specific integration test must be green. Previous Blocks' integration tests must remain green.

**Per Ring (post-MVP)** — full 14-step E2E test stays green. Add new tests for new ring behavior.

**Continuous** — unit tests in watch mode, type-check on save, lint on save.

### Coverage targets (solo realistic)

| Layer | Target | Rationale |
|---|---|---|
| Solidity | **≥ 90%** | BRD requires it; contracts are small, achievable |
| Chaincode | **60–70% on critical paths** | State transitions, business rules, access control. Skip 100% — diminishing returns |
| API services | **50–60% (happy + RBAC + validation)** | Most failure modes surface in integration tests, don't double-test |
| Integration | **Block-level coverage of every Block** | This is the regression net — non-negotiable |
| Postman | **All 14 steps after Block 6** | Demo + manual smoke test |

Don't chase 100%. Chase: "if I broke something important, the test would catch it."

### Special cases that need explicit tests

| Concern | What the test must verify |
|---|---|
| **PDC visibility (NFR-06)** | Spin up 3 peers, write to PDC, assert non-party `getPrivateData` returns empty / errors |
| **Bridge service correctness** | Mock Fabric event → verify Polygon condition flips → verify Polygon event triggers Fabric audit write |
| **Maker-checker enforcement (Rule-06)** | Two simulated MSP identities, maker submits + checker approves; assert "checker == maker" rejected |
| **State machine illegality** | For each entity, enumerate every illegal transition pair and assert each throws |
| **Rule-02 duplicate financing** | Lock asset → second lock attempt fails. Across two simulated lenders. |
| **Sanctions screening** | Mock sanctions API, verify it's called at all 5 mandatory checkpoints, no checkpoint silently skipped |

### Daily / weekly rhythm

**Daily:** code + unit test in one commit · `npm test -- --watch` always running · add Postman requests as endpoints land.

**End of day:** integration test for in-progress Block green · push to git only if green.

**End of Block:** Block-specific integration test green · all previous Blocks' integration tests still green · Postman covers all new endpoints · update MVP-PLAN.md status checkbox.

**End of Ring (post-MVP):** full 14-step E2E test green · new ring's tests green · sanity-check via Postman manual run.

### Load / Performance

- Trade-event confirmation ≤ 5 seconds under expected load (NFR-03) — must be verified in Phase 8 (out of scope for solo MVP).

---

## 20. Common Mistakes to Avoid

1. **Don't put escrow logic on Fabric.** Escrow is on Polygon. Fabric only receives settlement confirmations.
2. **Don't skip the bridge.** Fabric events flow to Polygon via `bridge.service.ts` — never hardcode cross-chain calls.
3. **Don't put financing terms on the main channel.** They go in `financingTermsPDC`.
4. **Don't allow a finance request without Rule-02 check.** Duplicate financing prevention must run every time.
5. **Don't release escrow manually.** Release must always evaluate all conditions via `ReleaseConditionEvaluator.sol`.
6. **Don't invent fields not in the BRD.** If a field is needed but missing from the BRD, flag it — do not silently add it.
7. **Don't add tokenization logic.** RDM token is future phase.
8. **Don't use Go, Java, or any non-TypeScript language** for chaincode or API.
9. **Don't mix funding models.** An escrow is Prefunded OR Reserved OR CreditBacked — never two.
10. **Don't skip sanctions screening** at any of the 5 required checkpoints.

---

## 21. User Preferences & Working Style

- **Tight, precise responses** — no fluff, no filler
- **No unnecessary code blocks** for narrative flows — plain prose when explaining
- **Real-world examples** with named entities (Tata Motors, HDFC Bank, etc.) work well
- **BRD scope is law** — always verify additions against the BRD before proposing
- **Dual-chain architecture is decided** — do not re-propose Fabric-only or Ethereum-only
- **Express.js, not NestJS** — user explicitly chose Express
- **TypeScript, not Go** — user explicitly chose TypeScript for chaincode

---

## 22. Key References

- [PLAN.md](PLAN.md) — Full phased build plan with all chaincode functions, routes, and timelines
- BRD/SRS v1.1 (12 April 2026) — authoritative requirements document
- Section numbers referenced throughout this file map directly to BRD sections

---

*Everything in this file maps directly to BRD/SRS v1.1. Nothing outside BRD scope is included. Nothing within BRD scope is omitted.*
