# MVP-PLAN.md — Solo Build Sequence

This file is the **actual build sequence** for the solo developer. It complements [PLAN.md](PLAN.md), which holds the full BRD/SRS spec. PLAN.md is the *what*; MVP-PLAN.md is the *how* and *in what order*.

> **Strategy:** Build a thin vertical slice that touches every architectural component end-to-end (Block 1–6), then expand to full BRD scope ring by ring (Ring 1–12). The MVP demonstrates the **Tata Motors / Bharat Stampings / HDFC Bank** worked example end-to-end via Postman. Every later ring adds breadth on a working foundation.

> **The flow itself — names, amounts, ordering, expected statuses — is in [EXAMPLE-FLOW.md](EXAMPLE-FLOW.md).** Treat it as a frozen test fixture: every Postman request and every integration test assertion must match it exactly.

---

## 1. Why This Approach

| Phase-by-phase (PLAN.md) | Vertical slice MVP (this doc) |
|---|---|
| Build all chaincodes → all API → connect at the end | Thin slice through every layer first; expand after |
| Integration bugs surface late (month 8+) | Integration bugs surface early (month 3–4) |
| First demo possible at month 10+ | First demo possible at ~month 4 |
| Solo morale risk: months of half-finished modules | Always have a working flow to point at |
| Architecture mistakes discovered late | Architecture validated early under real load |

The riskiest seams in this project are **cross-chain communication** — Fabric ↔ Polygon bridge, correlation IDs, condition evaluation timing. The MVP exercises all of them in month 4 instead of month 10.

---

## 2. The MVP Slice — What's In / What's Out

### Orgs (5 — full set, minimal members)
| In MVP | Skipped in MVP |
|---|---|
| 1 Buyer (Tata), 1 Supplier (Bharat), 1 Lender (HDFC), 1 Platform, 1 Auditor (read-only) | Multiple buyers/suppliers/lenders, Logistics org, Warehouse org, Insurer org |

### Fabric Chaincodes (3 of 6)
| In MVP | Skipped in MVP |
|---|---|
| `onboarding-cc` (basic register + approve) | `provenance-cc` |
| `trade-doc-cc` (PO + Invoice + 3-way match — skip GRN nuances) | `dispute-cc` |
| `finance-cc` (pre-shipment + invoice discounting only + Rule-02 lock) | `audit-cc` (use stub `logEvent` placeholder) |

### Solidity Contracts (2 of 4)
| In MVP | Skipped in MVP |
|---|---|
| `EscrowFactory.sol` | `FundingManager.sol` (hardcode Prefunded) |
| `EscrowVault.sol` (1–2 conditions inline) | `ReleaseConditionEvaluator.sol` (inline conditions in EscrowVault) |

### Channels
- **MVP:** `buyer-supplier-channel` only
- **Later rings:** `lender-channel`, `auditor-channel`

### PDCs
- **MVP:** none
- **Ring 4:** all 3 PDCs added

### Finance Products (2 of 7)
- **MVP:** Pre-shipment + Invoice Discounting (matches Tata/Bharat/HDFC example)
- **Ring 9:** remaining 5 products

### Funding Models (1 of 3)
- **MVP:** Prefunded only
- **Ring 6:** Reserved + CreditBacked

### Linked Asset Types (1 of 5)
- **MVP:** Invoice only
- **Ring 8:** PO, GRN, FinanceRequest, Milestone

### Bridge Service
- **MVP:** listens for `InvoiceApproved` Fabric event → flips one condition on Polygon → triggers release
- **Later rings:** full event coverage

### Demo Surface
- **MVP:** Postman collection that runs the 14-step Tata / Bharat / HDFC flow end-to-end
- **Later rings:** OpenAPI / Swagger UI, integration test suite, block explorer screenshots

### Out of Scope Entirely (Solo Build)
- All 3 Next.js portals
- Kubernetes / Helm (Compose only)
- 99.9% HA, DR drills, multi-cluster (Phase 8 production hardening)
- Real ERP / WMS / TMS / banking / DMS systems (adapters mocked)

---

## 3. Build Blocks — MVP Path (~14–17 weeks)

### Block 1 — Foundation (3–4 weeks)
**Goal:** Local dev environment running. All infra components healthy. Empty Express scaffold. Empty chaincode scaffold. Empty Solidity scaffold.

| Deliverable | Tech |
|---|---|
| Docker Compose with Fabric test-network (2 orgs to start) | `fabric-samples/test-network` |
| Hardhat node running locally | Hardhat |
| Express.js scaffold with middleware stack | Express + TypeScript |
| MongoDB + MinIO containers (PostgreSQL deferred to reporting ring) | Docker Compose |
| `GET /health` endpoint working | Express |
| Fabric Gateway connection from API verified | `fabric-gateway` |
| Polygon provider connection from API verified | `ethers.js v6` |
| Logger + correlation ID middleware | Custom |
| Vitest configured for API tests + first dummy test passing | Vitest |
| Mocha + chai + sinon scaffolded for chaincode tests | Mocha + chai + sinon |
| Hardhat test scaffold with one passing dummy contract test | Hardhat + chai |
| Empty Postman collection committed at `/postman/coconet.postman_collection.json` | Postman |
| Placeholder integration test asserting `GET /health` returns 200 | Vitest + supertest |

**BRD mapping:** Phase 1A, 1B, 1C from PLAN.md (scoped down)

---

### Block 2 — Onboarding (1–2 weeks)
**Goal:** 5 orgs registered, approved, and in the system.

| Deliverable | Tech |
|---|---|
| `onboarding-cc` chaincode: `createOrganization`, `updateOrganizationStatus`, `assignRole` | Fabric + TypeScript |
| `/api/onboarding/organizations` routes (POST, GET, PUT status) | Express |
| ~~Fabric CA enrollment for each org~~ — **Deferred to Ring 11** (cryptogen admin identities used instead; chaincode currently sees org-level MSP only, not per-user) | Fabric CA |
| Tata, Bharat, HDFC, Platform, Auditor registered + approved | API calls |
| Maker-checker threshold setup (basic) | `setMakerCheckerThreshold` |

**BRD mapping:** Phase 1D, partial

**Verification:** Postman collection `01_Onboarding.postman_collection.json` registers all 5 orgs and approves them.

---

### Block 3 — Trade Documents (3 weeks)
**Goal:** PO + Invoice flow working with 3-way match.

| Deliverable | Tech |
|---|---|
| `trade-doc-cc`: `createPO`, `acknowledgePO`, `submitInvoice`, `runThreeWayMatch`, `approveInvoice` | Fabric + TypeScript |
| State machine enforcement for PO + Invoice | Chaincode logic |
| Document hash service (SHA-256) | API service |
| `/api/trade-docs/purchase-orders` + `/api/trade-docs/invoices` routes | Express |
| MinIO upload for raw documents | MinIO SDK |
| GRN — minimal version (just acceptance, skip inspection nuances) | Chaincode + routes |

**BRD mapping:** Phase 2A, 2B (scoped down)

**Verification:** Postman runs steps 1, 2, 7 (simplified), 8, 9 of the Tata/Bharat/HDFC flow.

---

### Block 4 — Finance (2–3 weeks)
**Goal:** Pre-shipment loan + invoice discounting working with asset locking.

| Deliverable | Tech |
|---|---|
| `finance-cc`: `createFinanceRequest`, `validateEligibility`, `submitQuote`, `approveFinancing`, `lockAsset`, `disburseFunds`, `recordRepayment` | Fabric + TypeScript |
| Rule-01 (invoice eligibility) + Rule-02 (duplicate prevention) | Chaincode |
| State machine for Finance Request | Chaincode |
| `/api/finance/pre-shipment` + `/api/finance/invoice-discounting` routes | Express |
| Net settlement logic for loan + interest deduction at discounting | Service layer |

**BRD mapping:** Phase 4A, 4B (pre-shipment + invoice discounting only)

**Verification:** Postman runs steps 3, 3A, 5, 10, 10A of the example.

---

### Block 5 — Escrow + Bridge (3 weeks)
**Goal:** Escrow created, funded, conditions evaluated, auto-released. Cross-chain working.

| Deliverable | Tech |
|---|---|
| `EscrowFactory.sol`: `createEscrowInstruction` | Solidity + Hardhat |
| `EscrowVault.sol`: `fundEscrow`, `release` (with inline 2 conditions: invoice approved + funded) | Solidity + Hardhat |
| Bridge service: listens to `InvoiceApproved` Fabric event → calls Polygon `markCondition`; listens to `FundsReleased` Polygon event → writes to a stub `audit-cc` | Node + ethers + fabric-gateway |
| `/api/escrow/instructions` routes (create, fund, status) | Express |
| Correlation key `escrowPaymentId` shared across both chains | Service |

**BRD mapping:** Phase 5A (subset), 5B (subset), 5C (subset)

**Verification:** Postman runs steps 11, 12, 13 — escrow created, funded, auto-released to HDFC.

---

### Block 6 — Wire It Together + Demo (2 weeks)
**Goal:** The full 14-step Tata / Bharat / HDFC flow runs green from one Postman click.

| Deliverable | Tech |
|---|---|
| Master Postman collection: all 14 steps as named requests, run-in-order | Postman |
| `vitest` integration test that spins up Fabric + Polygon and runs the full flow | Vitest + supertest |
| README with one-command setup (`docker compose up && npm run demo`) | Markdown + scripts |
| Block explorer setup (Hyperledger Explorer + Blockscout) | Compose |
| Demo script for sir | Markdown |

**MVP COMPLETE.** Demoable end-to-end. ~14–17 weeks in.

---

## 4. Expansion Rings — Post-MVP Path (~14–16 weeks)

Each ring is independently shippable. After every ring, the integration test must still pass.

### Ring 1 — Real audit-cc (1–2 weeks)
- `audit-cc` chaincode with `logEvent` properly stored
- Auto-invocation from all other chaincodes on every state transition
- `generateAuditPack` function
- BRD mapping: Phase 6B
- **Why first:** NFR-05 — every action must be auditable. Easier to add now than retrofit.

### Ring 2 — Provenance + Rule-04 (2 weeks)
- `provenance-cc` with item, batch, custody, inspection, exception events
- Rule-04: exception event → finance hold
- BRD mapping: Phase 3
- **Why second:** Required by Rule-04 hooks already referenced in `finance-cc`.

### Ring 3 — Disputes + Rule-0C (2 weeks)
- `dispute-cc` with raise / respond / escalate / resolve
- Bridge: dispute raised → Polygon `EscrowVault.holdFunds`
- Rule-0C: refund priority on dispute before release
- BRD mapping: Phase 6A
- **Why third:** Closes the escrow happy-path with a sad-path. High BRD priority.

### Ring 4 — All 3 PDCs (1–2 weeks)
- `financingTermsPDC` (lender + supplier)
- `escrowAmountsPDC` (buyer treasury)
- `sanctionsResultPDC` (platform)
- Move existing financing terms / escrow amount fields into PDCs
- BRD mapping: NFR-06, BR-06
- **Why fourth:** Privacy story. Refactor easier with one slice working than mid-build.

### Ring 5 — Add lender + auditor channels (1–2 weeks)
- Create `lender-channel`, `auditor-channel`
- Move finance request creation to `lender-channel`
- Auditor reads from `auditor-channel`
- BRD mapping: BR-06
- **Why fifth:** Real channel separation. Requires PDCs from Ring 4 to make sense.

### Ring 6 — FundingManager + Reserved + CreditBacked (2 weeks)
- `FundingManager.sol` extracted as separate contract
- Reserved funding model implementation
- CreditBacked funding model implementation
- BRD mapping: FR-ESC-02, Rule-0A
- **Why sixth:** Completes the funding model spec.

### Ring 7 — ReleaseConditionEvaluator + 6 conditions (1–2 weeks)
- `ReleaseConditionEvaluator.sol` extracted as separate contract
- All 6 conditions: delivery, invoice approval, sanctions, senior approval, funding, no active dispute
- BRD mapping: FR-ESC-03, Rule-0B
- **Why seventh:** Completes Rule-0B fully.

### Ring 8 — Remaining linked asset types (2–3 weeks)
- PO-linked escrow
- GRN-linked escrow
- FinanceRequest-linked escrow
- Milestone-linked escrow with tranches
- BRD mapping: Section 26A
- **Why eighth:** Each is a small variant of existing Invoice flow.

### Ring 9 — Remaining 5 finance products (3–4 weeks)
- Post-shipment finance
- Dynamic discounting / early payment
- Warehouse receipt finance (+ `warehouse-receipt` data model + state machine)
- Distributor / dealer finance
- PO finance with milestone tranches
- BRD mapping: Phase 4 (full)
- **Why ninth:** Variations on existing patterns; lower architectural risk.

### Ring 10 — Sanctions screening at all 5 checkpoints (1 week)
- At onboarding, PO creation, finance approval, escrow creation, escrow release
- Results into `sanctionsResultPDC`
- Mock sanctions API for solo
- BRD mapping: cross-cutting (Section 15 of CLAUDE.md)
- **Why tenth:** Cross-cutting — easier once chaincodes are stable.

### Ring 11 — Maker-checker engine (Rule-06) across all chaincodes (2–3 weeks)
- **Fabric CA setup + per-user enrollment** (deferred from Block 2) — 5 CA containers in docker-compose, user wallet storage, enrollment endpoints. Required prerequisite — without distinct per-user identities, two-signature enforcement is impossible at the chaincode layer. ~2–3 days on its own.
- Configurable thresholds per org + transaction type (storage already done in Block 2)
- Two-signature enforcement on chaincode — read `ctx.clientIdentity.getID()`, reject if maker.id == checker.id
- Update every chaincode state transition to record `submitted_by` (user id + MSP) — satisfies NFR-05 cryptographically (currently satisfied at API/JWT layer only)
- BRD mapping: BR-09, Rule-06, NFR-05
- **Why eleventh:** Repetitive but mechanical *once the CA prerequisite is in place*. Better with stable chaincodes.

### Ring 12 — Adapters + OpenAPI + Postman polish (2 weeks)
- 6 mocked adapters with idempotency
- OpenAPI / Swagger UI auto-generated from routes
- Final Postman collection cleanup
- Documentation polish
- BRD mapping: Phase 7A (mocked), NFR-08
- **Why last:** Polish layer. Doesn't need to block earlier rings.

---

## 5. Timeline Summary

| Phase | Duration | Cumulative |
|---|---|---|
| Block 1 — Foundation | 3–4 weeks | 4 weeks |
| Block 2 — Onboarding | 1–2 weeks | 6 weeks |
| Block 3 — Trade Docs | 3 weeks | 9 weeks |
| Block 4 — Finance | 2–3 weeks | 12 weeks |
| Block 5 — Escrow + Bridge | 3 weeks | 15 weeks |
| Block 6 — Wire & Demo | 2 weeks | **17 weeks (MVP)** |
| Ring 1 — Audit | 1–2 weeks | 19 weeks |
| Ring 2 — Provenance | 2 weeks | 21 weeks |
| Ring 3 — Disputes | 2 weeks | 23 weeks |
| Ring 4 — PDCs | 1–2 weeks | 25 weeks |
| Ring 5 — Channels | 1–2 weeks | 27 weeks |
| Ring 6 — Funding models | 2 weeks | 29 weeks |
| Ring 7 — Release Evaluator | 1–2 weeks | 31 weeks |
| Ring 8 — Asset types | 2–3 weeks | 34 weeks |
| Ring 9 — Finance products | 3–4 weeks | 38 weeks |
| Ring 10 — Sanctions | 1 week | 39 weeks |
| Ring 11 — Maker-checker (incl. Fabric CA) | 2–3 weeks | 42 weeks |
| Ring 12 — Adapters + polish | 2 weeks | **44 weeks (Full BRD backend)** |

**MVP at ~4 months. Full BRD backend at ~10–11 months solo, full-time.** (Full PLAN.md spec was 12 months for 11 people; solo trades parallel-team breadth for sequential single-track depth.)

---

## 6. Working Style Rules

1. **Postman first.** Define each step's request before writing the chaincode. Postman = spec + test.
2. **Integration test from Block 6 onward.** A `vitest` test runs the full 14-step flow. Must stay green after every ring.
3. **Refactor between rings, not during.** Build a ring → make it work → refactor → start next. Don't leave half-finished refactors.
4. **One ring at a time.** No parallel rings. No "I'll start Ring 5 while finishing Ring 3."
5. **Keep both PLAN.md and MVP-PLAN.md in sync.** PLAN.md is the spec; MVP-PLAN.md tracks status.
6. **Weekly checkpoint.** End of each week: did the integration test stay green? If no, fix before adding code.
7. **Block 8 hardening (NFRs) is out of scope for solo.** Document this honestly — don't pretend 99.9% uptime is achievable on a laptop.

---

## 7. Status Tracking

Mark each block / ring as `[ ]` `[~]` `[x]` (not started / in progress / done):

### MVP Blocks
- [x] Block 1 — Foundation
- [~] Block 2 — Onboarding
- [ ] Block 3 — Trade Docs
- [ ] Block 4 — Finance
- [ ] Block 5 — Escrow + Bridge
- [ ] Block 6 — Wire & Demo

### Expansion Rings
- [ ] Ring 1 — Audit
- [ ] Ring 2 — Provenance
- [ ] Ring 3 — Disputes
- [ ] Ring 4 — PDCs
- [ ] Ring 5 — Channels
- [ ] Ring 6 — Funding models
- [ ] Ring 7 — Release Evaluator
- [ ] Ring 8 — Asset types
- [ ] Ring 9 — Finance products
- [ ] Ring 10 — Sanctions
- [ ] Ring 11 — Maker-checker
- [ ] Ring 12 — Adapters + polish

---

## 8. References

- [PLAN.md](PLAN.md) — Full BRD spec (unchanged; the *what*)
- [CLAUDE.md](CLAUDE.md) — Project context for Claude Code
- BRD/SRS v1.1 (12 April 2026) — Authoritative requirements
