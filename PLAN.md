# Permissioned Blockchain Platform — Build Plan
## Based strictly on: Permissioned_blockchain_escrow_final_BRD_SRS (v1.1, 12 April 2026)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Permissioned Blockchain (workflow) | Hyperledger Fabric |
| Permissioned Blockchain (escrow/payments) | Polygon Supernet (CDK) |
| Chaincode language | TypeScript |
| Smart Contract language | Solidity |
| API Server | Express.js (TypeScript) |
| Frontend Portals | Next.js (TypeScript) |
| Off-chain DB (queries) | MongoDB |
| Off-chain DB (reporting) | PostgreSQL |
| Document Storage | S3 / MinIO |
| PKI | Hyperledger Fabric CA |
| Monitoring | Prometheus + Grafana |

---

## Chain Responsibility Split

### Hyperledger Fabric — Identity, Documents, Provenance, Finance, Disputes, Audit

| Chaincode | BRD Reference | Responsibility |
|---|---|---|
| `onboarding-cc` | FR-ONB-01 to FR-ONB-04, BR-01 | KYC/KYB, membership, roles, maker-checker |
| `provenance-cc` | FR-PROV-01 to FR-PROV-04, BR-03 | Item/lot/batch, custody, inspection, exception events |
| `trade-doc-cc` | FR-DOC-01 to FR-DOC-04, BR-02 | PO, GRN, Invoice, 3-way/4-way match |
| `finance-cc` | FR-FIN-01 to FR-FIN-04, BR-04, BR-05 | All 7 finance products, eligibility, asset locking |
| `dispute-cc` | FR-RSK-01 to FR-RSK-04, BR-11 | Dispute lifecycle, holdbacks, overrides, escalation |
| `audit-cc` | FR-REP-01 to FR-REP-04, BR-08 | Audit trails, evidence packs, observer access |

### Polygon Supernet — Programmable Money Escrow

| Smart Contract | BRD Reference | Responsibility |
|---|---|---|
| `EscrowFactory.sol` | FR-ESC-01, BR-12 | Create escrow payment instructions |
| `EscrowVault.sol` | FR-ESC-04, BR-12 | Hold funds, release/hold/refund/reversal |
| `ReleaseConditionEvaluator.sol` | FR-ESC-03, Rule-0B | Evaluate all release conditions |
| `FundingManager.sol` | FR-ESC-02, Rule-0A | Prefunded/Reserved/CreditBacked funding models |

### Bridge Service — Fabric ↔ Polygon
- Fabric events → update Polygon release conditions
- Polygon events → write settlement confirmation back to Fabric audit-cc
- Correlation key: `escrowPaymentId` shared across both chains

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      UI Layer                               │
│  Buyer-Supplier Portal | Lender Portal | Admin/Auditor UI   │
│  (Next.js / TypeScript)                                     │
└────────────────────────┬────────────────────────────────────┘
                         │ REST / Event APIs
┌────────────────────────▼────────────────────────────────────┐
│              API Layer (Express.js / TypeScript)            │
│                                                             │
│  /api/onboarding     /api/provenance    /api/trade-docs     │
│  /api/finance        /api/escrow        /api/disputes       │
│  /api/reports        /api/notifications /api/auth           │
│                                                             │
│  Middleware: auth | rbac | validation | error | logging     │
│                                                             │
│  Routes → Controllers → Services → Fabric SDK / ethers.js  │
└──────────┬──────────────────────────────┬───────────────────┘
           │ Fabric SDK (Node.js)          │ ethers.js
┌──────────▼──────────┐      ┌────────────▼──────────────────┐
│  Hyperledger Fabric │      │     Polygon Supernet          │
│                     │      │     (Permissioned EVM)        │
│  Channels:          │      │                               │
│  - buyer-supplier   │◄────►│  EscrowFactory.sol            │
│  - lender           │Bridge│  EscrowVault.sol              │
│  - auditor          │      │  ReleaseConditionEvaluator.sol│
│                     │      │  FundingManager.sol           │
│  Chaincodes (TS):   │      │                               │
│  - onboarding-cc    │      │  Validators: Buyer, Lender,   │
│  - provenance-cc    │      │  Platform orgs                │
│  - trade-doc-cc     │      └───────────────────────────────┘
│  - finance-cc       │
│  - dispute-cc       │
│  - audit-cc         │
│                     │
│  PDCs:              │
│  - financingTerms   │
│  - escrowAmounts    │
│  - sanctionsResult  │
└──────────┬──────────┘
           │
┌──────────▼────────────────────────────────────────────────┐
│                 Off-chain Services                         │
│  MongoDB | PostgreSQL | S3/MinIO | OCR | eSign | PKI      │
│  Sanctions API | Monitoring                               │
└───────────────────────────────────────────────────────────┘
           │
┌──────────▼────────────────────────────────────────────────┐
│              Integration Adapters                          │
│  ERP | WMS | TMS | Banking | DMS | Notification           │
└───────────────────────────────────────────────────────────┘
```

---

## Project Folder Structure

```
/project-root
│
├── /fabric-network/
│   ├── /config/
│   ├── /crypto-config/
│   ├── /channel-artifacts/
│   └── /docker-compose/
│
├── /chaincodes/
│   ├── /onboarding-cc/
│   ├── /provenance-cc/
│   ├── /trade-doc-cc/
│   ├── /finance-cc/
│   ├── /dispute-cc/
│   └── /audit-cc/
│
├── /contracts/
│   ├── EscrowFactory.sol
│   ├── EscrowVault.sol
│   ├── ReleaseConditionEvaluator.sol
│   └── FundingManager.sol
│
├── /api/
│   ├── app.ts
│   ├── server.ts
│   ├── /routes/
│   │   ├── onboarding.routes.ts
│   │   ├── provenance.routes.ts
│   │   ├── trade-doc.routes.ts
│   │   ├── finance.routes.ts
│   │   ├── escrow.routes.ts
│   │   ├── dispute.routes.ts
│   │   ├── report.routes.ts
│   │   ├── notification.routes.ts
│   │   └── auth.routes.ts
│   ├── /controllers/
│   │   ├── onboarding.controller.ts
│   │   ├── provenance.controller.ts
│   │   ├── trade-doc.controller.ts
│   │   ├── finance.controller.ts
│   │   ├── escrow.controller.ts
│   │   ├── dispute.controller.ts
│   │   ├── report.controller.ts
│   │   └── auth.controller.ts
│   ├── /services/
│   │   ├── onboarding.service.ts
│   │   ├── provenance.service.ts
│   │   ├── trade-doc.service.ts
│   │   ├── finance.service.ts
│   │   ├── escrow.service.ts
│   │   ├── dispute.service.ts
│   │   ├── report.service.ts
│   │   ├── bridge.service.ts
│   │   └── notification.service.ts
│   ├── /middleware/
│   │   ├── auth.middleware.ts
│   │   ├── rbac.middleware.ts
│   │   ├── validate.middleware.ts
│   │   ├── error.middleware.ts
│   │   └── logger.middleware.ts
│   ├── /fabric/
│   │   ├── gateway.ts
│   │   ├── onboarding.fabric.ts
│   │   ├── provenance.fabric.ts
│   │   ├── trade-doc.fabric.ts
│   │   ├── finance.fabric.ts
│   │   ├── dispute.fabric.ts
│   │   └── audit.fabric.ts
│   ├── /polygon/
│   │   ├── provider.ts
│   │   ├── escrow-factory.polygon.ts
│   │   ├── escrow-vault.polygon.ts
│   │   ├── condition-evaluator.polygon.ts
│   │   └── funding-manager.polygon.ts
│   ├── /adapters/                       // Mocked where no external system exists (solo build)
│   │   ├── erp.adapter.ts                // Mocked
│   │   ├── wms.adapter.ts                // Mocked
│   │   ├── tms.adapter.ts                // Mocked
│   │   ├── banking.adapter.ts            // Mocked
│   │   ├── dms.adapter.ts                // Mocked
│   │   └── notification.adapter.ts       // Mocked
│   ├── /models/
│   │   ├── organization.model.ts
│   │   ├── purchase-order.model.ts
│   │   ├── grn.model.ts
│   │   ├── invoice.model.ts
│   │   ├── provenance-event.model.ts
│   │   ├── finance-request.model.ts
│   │   ├── escrow-payment.model.ts
│   │   └── warehouse-receipt.model.ts
│   ├── /validators/
│   │   ├── onboarding.validator.ts
│   │   ├── trade-doc.validator.ts
│   │   ├── finance.validator.ts
│   │   └── escrow.validator.ts
│   └── /config/
│       ├── fabric.config.ts
│       ├── polygon.config.ts
│       ├── db.config.ts
│       └── env.config.ts
│
├── /portals/                        // Out of scope for solo build
│   ├── /buyer-supplier/             // Out of scope for solo build
│   ├── /lender/                     // Out of scope for solo build
│   └── /admin-auditor/              // Out of scope for solo build
│
└── /scripts/
```

---

## Data Models (BRD Sections 21–27)

### Organization Master (Section 21)
| Field | Type | Mandatory |
|---|---|---|
| organization_id | String | Yes |
| organization_name | String | Yes |
| organization_type | Enum: Buyer/Supplier/Lender/Warehouse/Logistics/Insurer/Auditor/Admin | Yes |
| registration_number | String | Yes |
| tax_id | String | Conditional |
| country_code | String | Yes |
| status | Enum: Pending/Approved/Suspended/Closed | Yes |
| risk_tier | Enum | No |
| bank_account_ref | String | No |

### Purchase Order (Section 22)
| Field | Type | Mandatory |
|---|---|---|
| po_id | String | Yes |
| buyer_id | String | Yes |
| supplier_id | String | Yes |
| po_date | Date | Yes |
| currency | String | Yes |
| gross_value | Decimal | Yes |
| delivery_terms | String | No |
| milestone_plan_id | String | No |
| po_status | Enum: Issued/Acknowledged/Amended/Locked/Fulfilled/Closed | Yes |
| document_hash | String | Yes |

### GRN / Acceptance (Section 23)
| Field | Type | Mandatory |
|---|---|---|
| grn_id | String | Yes |
| po_id | String | Yes |
| shipment_id | String | No |
| received_qty | Decimal | Yes |
| accepted_qty | Decimal | No |
| rejected_qty | Decimal | No |
| receipt_date | DateTime | Yes |
| inspection_status | Enum: Pending/Passed/Failed/Conditional | Yes |
| acceptance_status | Enum: Pending/Accepted/Partially Accepted/Rejected | Yes |

### Invoice / Receivable (Section 24)
| Field | Type | Mandatory |
|---|---|---|
| invoice_id | String | Yes |
| supplier_id | String | Yes |
| buyer_id | String | Yes |
| po_id | String | Yes |
| grn_id | String | Conditional |
| invoice_date | Date | Yes |
| due_date | Date | Yes |
| net_amount | Decimal | Yes |
| approval_status | Enum: Submitted/Matched/Approved/Rejected/Disputed | Yes |
| assignment_status | Enum: Unassigned/Assigned/Released | Yes |
| document_hash | String | Yes |

### Provenance Event (Section 25)
| Field | Type | Mandatory |
|---|---|---|
| event_id | String | Yes |
| event_type | Enum: Object/Transformation/Aggregation/Inspection/Location/Exception | Yes |
| batch_id | String | Yes |
| actor_org_id | String | Yes |
| location_id | String | No |
| event_timestamp | DateTime | Yes |
| event_status | Enum: Captured/Validated/Shared/Superseded | Yes |
| sensor_ref | String | No |
| document_hash | String | No |
| exception_flag | Boolean | No |

### Finance Request (Section 26)
| Field | Type | Mandatory |
|---|---|---|
| finance_request_id | String | Yes |
| asset_type | Enum: Invoice/PO/WarehouseReceipt/Shipment/ProgramPool | Yes |
| asset_id | String | Yes |
| requestor_org_id | String | Yes |
| lender_id | String | No |
| requested_amount | Decimal | Yes |
| approved_amount | Decimal | No |
| advance_rate | Decimal | No |
| discount_rate | Decimal | No |
| tenor_days | Integer | No |
| security_interest_state | Enum: None/Perfected/Released/Enforced | Yes |
| finance_status | Enum: Requested/UnderReview/Approved/Disbursed/Settled/Defaulted | Yes |

### Escrow Payment Instruction (Section 26A)
| Field | Type | Mandatory |
|---|---|---|
| escrow_payment_id | String | Yes |
| buyer_id | String | Yes |
| supplier_id | String | Yes |
| linked_asset_type | Enum: PO/GRN/Invoice/FinanceRequest/Milestone | Yes |
| linked_asset_id | String | Yes |
| funding_model | Enum: Prefunded/Reserved/CreditBacked | Yes |
| escrow_amount | Decimal | Yes |
| release_conditions | JSON | Yes |
| release_status | Enum: Created/Funded/Held/PartiallyReleased/Released/Refunded/Reversed | Yes |
| beneficiary_account_ref | String | No |
| expiry_at | DateTime | No |

### Warehouse Receipt (Section 27)
| Field | Type | Mandatory |
|---|---|---|
| warehouse_receipt_id | String | Yes |
| warehouse_id | String | Yes |
| depositor_org_id | String | Yes |
| commodity_or_item_ref | String | Yes |
| qty_or_weight | Decimal | Yes |
| quality_grade | String | No |
| receipt_issue_date | Date | Yes |
| receipt_status | Enum: Active/Pledged/Released/Cancelled | Yes |
| lien_state | Enum: None/Active/Released | Yes |
| document_hash | String | Yes |

---

## State Machines (BRD Section 29)

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

## Business Rules (BRD Section 20)

| Rule | Name | Logic | Enforced In |
|---|---|---|---|
| Rule-0A | Escrow Funding Confirmation | Payment cannot enter release evaluation until escrow funded/confirmed | EscrowVault.sol + FundingManager.sol |
| Rule-0B | Conditional Release | Money releases only when ALL commercial + compliance + financing + approval conditions = true | ReleaseConditionEvaluator.sol |
| Rule-0C | Refund/Reversal Priority | Dispute/cancellation before release → escrow refunds per program rules | EscrowVault.sol + dispute-cc |
| Rule-01 | Invoice Eligibility | Invoice must link to valid supplier, buyer, PO, and GRN/acceptance | finance-cc + trade-doc-cc |
| Rule-02 | Duplicate Financing Prevention | No active lien/assignment on same asset | finance-cc |
| Rule-03 | Advance Rate | Based on program, asset type, buyer quality, event completeness | finance-cc |
| Rule-04 | Exception Hold | Disputes, quality failures, chain-of-custody breaks → financing on hold | provenance-cc → finance-cc |
| Rule-05 | Release Control | Warehouse release requires lien-free status or approved override | provenance-cc + dispute-cc |
| Rule-06 | Threshold Approval | High-value transactions require multi-level approval | All chaincodes + services |

---

## Non-Functional Requirements (BRD Section 19)

| NFR | Category | Requirement |
|---|---|---|
| NFR-01 | Security | Encryption in transit + at rest for all off-chain data |
| NFR-02 | Availability | 99.9%+ uptime |
| NFR-03 | Performance | Trade-event confirmation ≤ 5 seconds under expected load |
| NFR-04 | Scalability | Multi-anchor, multi-supplier, multi-lender across programs |
| NFR-05 | Auditability | All critical actions timestamped, signed, traceable to user and org |
| NFR-06 | Privacy | Bilateral financing data not visible to non-participating members (PDCs) |
| NFR-07 | Recoverability | Backup, restore, disaster-recovery procedures |
| NFR-08 | Interoperability | Documented APIs + integration adapters for enterprise systems |

---

## Phase 1: Foundation
**Duration: 6 weeks | Weeks 1–6**
**Goal: Fabric network + Polygon Supernet running + Express.js scaffold + Onboarding working**

### 1A. Hyperledger Fabric Network Setup (Week 1–3)
- Fabric network on Kubernetes
- Raft ordering service (3 orderer nodes minimum)
- 3 channels:
  - `buyer-supplier-channel`
  - `lender-channel`
  - `auditor-channel`
- Org MSPs: Buyer, Supplier, Lender, Warehouse, Logistics, Auditor, Platform
- Fabric CA per org
- TLS certificates
- PDC collections:
  - `financingTermsPDC` — lender + supplier only
  - `escrowAmountsPDC` — buyer treasury only
  - `sanctionsResultPDC` — platform only
- Peer nodes per org
- Test channel communication

### 1B. Polygon Supernet Setup (Week 2–4)
- Initialize Polygon CDK chain
- Permissioned validator set: Buyer org, Lender org, Platform org
- IBFT 2.0 consensus
- JSON-RPC endpoint
- Block time: 2 seconds target
- Blockscout block explorer
- Test basic transaction flow

### 1C. Express.js Server Scaffold (Week 3–4)
- Express.js + TypeScript setup
- Register all 9 route files
- Global middleware stack:
  - `logger.middleware.ts` — request/response logging
  - `auth.middleware.ts` — JWT verification
  - `rbac.middleware.ts` — role-based access control
  - `validate.middleware.ts` — request body validation
  - `error.middleware.ts` — centralized error handling
- Fabric Gateway connection setup (`fabric/gateway.ts`)
- Polygon provider setup (`polygon/provider.ts`)
- MongoDB + PostgreSQL connection setup
- `GET /health` endpoint

### 1D. Onboarding Chaincode + Routes (Week 4–6)

**Chaincode: `onboarding-cc` (TypeScript)**
- `createOrganization(orgId, name, type, regNumber, taxId, country)`
- `updateOrganizationStatus(orgId, status)`
- `assignRole(userId, orgId, role)`
- `setMakerCheckerThreshold(orgId, txType, threshold)`
- `getProgramEligibility(orgId)`
- `updateRiskTier(orgId, tier)`

**Express Routes: `/api/onboarding`**
```
POST   /api/onboarding/organizations
GET    /api/onboarding/organizations/:id
PUT    /api/onboarding/organizations/:id/status
POST   /api/onboarding/organizations/:id/users
PUT    /api/onboarding/organizations/:id/roles
POST   /api/onboarding/organizations/:id/enroll
GET    /api/onboarding/organizations/:id/eligibility
PUT    /api/onboarding/organizations/:id/risk-tier
POST   /api/onboarding/maker-checker/thresholds
```

**Deliverable:** Organizations onboard, get approved, get Fabric certificates, get roles assigned.

---

## Phase 2: Trade Document Core
**Duration: 6 weeks | Weeks 7–12**
**Goal: Full PO → GRN → Invoice flow on Fabric with 3-way/4-way match**

### 2A. Trade Document Chaincode (Week 7–10)

**Chaincode: `trade-doc-cc` (TypeScript)**

PO functions:
- `createPO(poId, buyerId, supplierId, currency, grossValue, deliveryTerms, milestonePlanId)`
- `acknowledgePO(poId, supplierId)`
- `amendPO(poId, changes, justification)`
- `lockPO(poId)` / `fulfillPO(poId)` / `closePO(poId)`
- State machine enforcement: Draft → Issued → Acknowledged → Amended → Locked → Fulfilled → Closed

GRN functions:
- `createGRN(grnId, poId, shipmentId, receivedQty)`
- `submitInspection(grnId, status, acceptedQty, rejectedQty)`
- `acceptGRN(grnId)` / `partiallyAcceptGRN(grnId, qty)` / `rejectGRN(grnId)`

Invoice functions:
- `submitInvoice(invoiceId, supplierId, buyerId, poId, grnId, amount, dueDate, docHash)`
- `runThreeWayMatch(invoiceId)` — PO + GRN + Invoice
- `runFourWayMatch(invoiceId)` — PO + GRN + Invoice + Payment
- `approveInvoice(invoiceId)` / `rejectInvoice(invoiceId)` / `disputeInvoice(invoiceId)`
- State machine: Draft → Submitted → Matched → Approved → Eligible → Assigned → Settled / Disputed → Closed
- Duplicate document detection (FR-DOC-04)
- Immutable document hash (FR-DOC-02)

### 2B. Trade Doc Routes (Week 8–12)

**Express Routes: `/api/trade-docs`**
```
POST   /api/trade-docs/purchase-orders
GET    /api/trade-docs/purchase-orders/:id
PUT    /api/trade-docs/purchase-orders/:id/acknowledge
PUT    /api/trade-docs/purchase-orders/:id/amend
PUT    /api/trade-docs/purchase-orders/:id/lock
PUT    /api/trade-docs/purchase-orders/:id/fulfill

POST   /api/trade-docs/grn
GET    /api/trade-docs/grn/:id
PUT    /api/trade-docs/grn/:id/inspect
PUT    /api/trade-docs/grn/:id/accept
PUT    /api/trade-docs/grn/:id/reject

POST   /api/trade-docs/invoices
GET    /api/trade-docs/invoices/:id
GET    /api/trade-docs/invoices/:id/match-result
PUT    /api/trade-docs/invoices/:id/approve
PUT    /api/trade-docs/invoices/:id/reject
PUT    /api/trade-docs/invoices/:id/dispute

POST   /api/trade-docs/documents/upload
GET    /api/trade-docs/documents/:hash/verify
```

**Deliverable:** Full PO → GRN → Invoice → Match → Approval working end-to-end on Fabric.

---

## Phase 3: Provenance & Traceability
**Duration: 4 weeks | Weeks 13–16**
**Goal: Supply chain events captured on Fabric, linked to trade docs, exceptions auto-flag finance**

### 3A. Provenance Chaincode (Week 13–15)

**Chaincode: `provenance-cc` (TypeScript)**
- `registerItem(itemId, description, batchId, originOrgId)`
- `registerLot(lotId, itemIds[], quantity)`
- `recordTransformation(eventId, inputBatchIds[], outputBatchId, actorOrgId)`
- `recordCustodyEvent(eventId, batchId, fromOrgId, toOrgId, locationId, timestamp)`
- `recordInspectionEvent(eventId, batchId, result, actorOrgId, docHash)`
- `recordLocationEvent(eventId, batchId, locationId, timestamp, sensorRef)`
- `recordException(eventId, batchId, description, actorOrgId)` → sets `exceptionFlag: true` → triggers finance hold (Rule-04)
- `generateChainOfCustodyTrace(batchId)` — FR-PROV-04
- `linkToFinance(batchId, financeRequestId)` — FR-PROV-03
- State: Captured → Validated → Shared → Superseded

### 3B. Provenance Routes (Week 14–16)

**Express Routes: `/api/provenance`**
```
POST   /api/provenance/items
POST   /api/provenance/lots
POST   /api/provenance/events/custody
POST   /api/provenance/events/inspection
POST   /api/provenance/events/location
POST   /api/provenance/events/exception
GET    /api/provenance/batches/:id/trace
GET    /api/provenance/batches/:id/recall
POST   /api/provenance/iot/ingest
POST   /api/provenance/documents/ocr
```

**Deliverable:** Full provenance trail on-chain, exceptions auto-flag financing eligibility.

---

## Phase 4: Finance Module — All 7 Products
**Duration: 8 weeks | Weeks 17–24**
**Goal: All finance products from BRD Section 5 operational on Fabric**

### Finance Products Covered (BRD Section 5)
1. Purchase Order Finance
2. Pre-shipment Finance
3. Post-shipment Finance
4. Invoice Discounting / Bill Discounting / Receivables Finance
5. Dynamic Discounting / Early Payment Programs
6. Warehouse Receipt Financing
7. Distributor and Dealer Financing

### 4A. Finance Chaincode (Week 17–22)

**Chaincode: `finance-cc` (TypeScript)**

Core functions:
- `createFinanceRequest(requestId, assetType, assetId, requestorOrgId, requestedAmount)`
- `validateEligibility(requestId)` — Rule-01, Rule-02, Rule-04
- `assignLender(requestId, lenderId)`
- `submitQuote(requestId, advanceRate, discountRate, tenorDays)`
- `approveFinancing(requestId, approvedAmount)` — maker-checker if above threshold (Rule-06)
- `lockAsset(assetId, financeRequestId)` — FR-FIN-03, Rule-02
- `disburseFunds(requestId, disbursementRef)`
- `recordRepayment(requestId, amount, paymentRef)`
- `markDefaulted(requestId)` / `markRecovered(requestId)` / `closeFinanceRequest(requestId)`
- State: Requested → Validating → Under Review → Offered → Accepted → Disbursed → Repaid / Defaulted → Recovered → Closed
- Advance rate calculation (Rule-03): program + asset type + buyer quality + event completeness
- Security interest state: None → Perfected → Released → Enforced

**PO Finance:**
- `createMilestonePlan(planId, poId, tranches[])`
- `approveTranche(planId, trancheIndex, proofDocHash)`
- `releaseTrancheFinancing(planId, trancheIndex)`

**Pre-shipment Finance:**
- `requestPreShipmentFinance(requestId, poId, amount)`
- `linkShipmentProof(requestId, shipmentId, docHash)`

**Post-shipment Finance:**
- `requestPostShipmentFinance(requestId, invoiceId, grnId)`
- Validates GRN accepted before eligibility

**Invoice Discounting / Bill Discounting:**
- Uses core `createFinanceRequest` with `assetType: Invoice`
- Validates Rule-01

**Dynamic Discounting / Early Payment:**
- `createEarlyPaymentOffer(invoiceId, discountRate, expiryDate)`
- `acceptEarlyPaymentOffer(invoiceId, supplierId)`

**Warehouse Receipt Financing:**
- `registerWarehouseReceipt(wrId, warehouseId, depositorId, commodityRef, qty, qualityGrade, docHash)`
- `perfectLien(wrId, lenderId)`
- `blockRelease(wrId)`
- `releaseLien(wrId, lenderId)`
- State: Active → Pledged → Released → Cancelled
- Lien: None → Active → Released

**Distributor / Dealer Finance:**
- `createDistributorFinanceRequest(requestId, distributorId, anchorId, invoiceIds[])`
- `validateDistributorEligibility(distributorId)`

**PDC:** Financing terms → `financingTermsPDC`

### 4B. Finance Routes (Week 18–24)

**Express Routes: `/api/finance`**
```
POST   /api/finance/po-finance
POST   /api/finance/po-finance/:id/milestone-plan
PUT    /api/finance/po-finance/:id/tranches/:index/approve

POST   /api/finance/pre-shipment
PUT    /api/finance/pre-shipment/:id/shipment-proof

POST   /api/finance/post-shipment

POST   /api/finance/invoice-discounting
POST   /api/finance/early-payment/offer
PUT    /api/finance/early-payment/:id/accept

POST   /api/finance/warehouse-receipt
PUT    /api/finance/warehouse-receipt/:id/lien/perfect
PUT    /api/finance/warehouse-receipt/:id/lien/release

POST   /api/finance/distributor

GET    /api/finance/:id/eligibility
PUT    /api/finance/:id/quote
PUT    /api/finance/:id/approve
PUT    /api/finance/:id/disburse
PUT    /api/finance/:id/repay
GET    /api/finance/corporate-analytics
GET    /api/finance/programs/:id/limits
```

**Deliverable:** All 7 finance products operational, eligibility enforced, asset locking working, maker-checker active.

---

## Phase 5: Programmable Money Escrow (Polygon Supernet)
**Duration: 8 weeks | Weeks 25–32**
**Goal: Full escrow module on Polygon with Fabric bridge**

### 5A. Polygon Smart Contracts (Week 25–29)

**`FundingManager.sol`**
```solidity
function depositPrefund(string calldata escrowPaymentId) external payable
function reserveFunds(string calldata escrowPaymentId, uint256 amount) external
function authorizeCreditBacked(string calldata escrowPaymentId, string calldata creditRef) external
function confirmFunding(string calldata escrowPaymentId) external
function getFundingStatus(string calldata escrowPaymentId) external view returns (FundingModel)
// Enforces Rule-0A: no release evaluation until funding confirmed
```

**`EscrowFactory.sol`**
```solidity
function createEscrowInstruction(
  string calldata escrowPaymentId,
  address buyerId,
  address supplierId,
  LinkedAssetType linkedAssetType,
  string calldata linkedAssetId,
  FundingModel fundingModel,
  uint256 escrowAmount,
  bytes calldata releaseConditions,
  uint256 expiryAt
) external
function getEscrowInstruction(string calldata escrowPaymentId) external view
function listByBuyer(address buyerId) external view returns (string[] memory)
function listBySupplier(address supplierId) external view returns (string[] memory)
```

**`ReleaseConditionEvaluator.sol`**
```solidity
// Receives condition updates from Bridge service
function updateDeliveryAcceptance(string calldata escrowPaymentId, bool status) external onlyBridge
function updateDisputeStatus(string calldata escrowPaymentId, bool cleared) external onlyBridge
function updateFinancingStatus(string calldata escrowPaymentId, bool status) external onlyBridge
function updateSanctionsResult(string calldata escrowPaymentId, bool cleared) external onlyBridge
function updateMakerCheckerApproval(string calldata escrowPaymentId, bool approved) external onlyBridge
function checkTimeTrigger(string calldata escrowPaymentId) internal view returns (bool)
function evaluateAll(string calldata escrowPaymentId) external view returns (bool)
// Rule-0B: returns true only when ALL conditions true
```

**`EscrowVault.sol`**
```solidity
function fullRelease(string calldata escrowPaymentId, address supplierBank) external
function partialRelease(string calldata escrowPaymentId, uint256 amount, address supplierBank) external
function splitSettlement(string calldata escrowPaymentId, Split[] calldata splits) external
function holdFunds(string calldata escrowPaymentId, string calldata reason) external
function refundBuyer(string calldata escrowPaymentId) external        // Rule-0C
function reverseFunds(string calldata escrowPaymentId, string calldata reason) external  // Rule-0C
function getAuditHistory(string calldata escrowPaymentId) external view returns (AuditLog[] memory)
// State: Created → Funded → Reserved → Held → PendingRelease
//        → PartiallyReleased → Released / Refunded / Reversed → Closed
```

### 5B. Fabric-Polygon Bridge Service (Week 27–31)

**`bridge.service.ts`**

Fabric → Polygon direction:
- Listen to Fabric block events
- On `InvoiceApproved` → call `updateDeliveryAcceptance(true)`
- On `GRNAccepted` → call `updateDeliveryAcceptance(true)`
- On `DisputeResolved` → call `updateDisputeStatus(true)`
- On `FinancingDisbursed` → call `updateFinancingStatus(true)`
- On `SanctionsClearanceDone` → call `updateSanctionsResult(true)`
- On `MakerCheckerApproved` → call `updateMakerCheckerApproval(true)`
- After each update: call `evaluateAll()` → if true → trigger `fullRelease()`

Polygon → Fabric direction:
- Listen to `FundsReleased` event → write to `audit-cc` → notify buyer + supplier
- Listen to `FundsHeld` event → write to `audit-cc` → notify buyer + supplier
- Listen to `FundsRefunded` event → write to `audit-cc` → notify buyer + supplier
- Listen to `FundsReversed` event → write to `audit-cc` → notify buyer + supplier

Correlation key: `escrowPaymentId` shared across both chains.

### 5C. Escrow Routes (Week 28–32)

**Express Routes: `/api/escrow`**
```
POST   /api/escrow/instructions
GET    /api/escrow/instructions/:id
GET    /api/escrow/instructions/buyer/:buyerId
GET    /api/escrow/instructions/supplier/:supplierId

POST   /api/escrow/instructions/:id/fund
GET    /api/escrow/instructions/:id/funding-status

GET    /api/escrow/instructions/:id/conditions
GET    /api/escrow/instructions/:id/status

POST   /api/escrow/instructions/:id/hold
POST   /api/escrow/instructions/:id/release
POST   /api/escrow/instructions/:id/partial-release
POST   /api/escrow/instructions/:id/split-settlement
POST   /api/escrow/instructions/:id/refund
POST   /api/escrow/instructions/:id/reverse

GET    /api/escrow/instructions/:id/audit
```

**PDC:** Escrow amounts → `escrowAmountsPDC` (buyer treasury only)

**Deliverable:** Buyer creates escrow → funds it → Polygon evaluates conditions from Fabric events → auto-releases/holds/refunds → full audit trail on both chains.

---

## Phase 6: Risk, Dispute & Audit
**Duration: 5 weeks | Weeks 33–37**
**Goal: Full dispute lifecycle, risk controls, audit evidence packs**

### 6A. Dispute Chaincode (Week 33–35)

**Chaincode: `dispute-cc` (TypeScript)**
- `raiseDispute(disputeId, entityType, entityId, raisedByOrgId, reason, docHash)`
- `respondToDispute(disputeId, response, respondingOrgId, docHash)`
- `escalateDispute(disputeId, escalatedTo)`
- `resolveDispute(disputeId, resolution, resolvedBy)`
- `holdback(disputeId, entityId, amount)` — FR-RSK-03
- `overrideHoldback(disputeId, justification, approvedBy)` — FR-RSK-04
- `suspendEligibility(orgId, reason)` — FR-RSK-02
- `downgradeEligibility(orgId, newTier)` — FR-RSK-02
- Exposure, concentration, utilization checks — FR-RSK-01
- On dispute raised → emit event → Bridge notifies Polygon to hold escrow

### 6B. Audit Chaincode (Week 34–36)

**Chaincode: `audit-cc` (TypeScript)**
- `logEvent(entityType, entityId, action, actorOrgId, prevState, newState, timestamp)`
- Auto-called by all other chaincodes on every state transition (NFR-05)
- `generateAuditPack(entityId, entityType)` — FR-REP-02
- `getTransactionDrillDown(txId)` — FR-REP-01
- `getExposureSummary(programId)` — FR-REP-03
- Observer query functions for regulators — FR-REP-04

### 6C. Dispute + Report Routes (Week 34–37)

**Express Routes: `/api/disputes`**
```
POST   /api/disputes
GET    /api/disputes/:id
PUT    /api/disputes/:id/respond
PUT    /api/disputes/:id/escalate
PUT    /api/disputes/:id/resolve
POST   /api/disputes/:id/holdback
PUT    /api/disputes/:id/holdback/override
PUT    /api/organizations/:id/suspend-eligibility
PUT    /api/organizations/:id/downgrade-eligibility
GET    /api/risk/exposure/:programId
```

**Express Routes: `/api/reports`**
```
GET    /api/reports/audit-pack/:entityType/:entityId
GET    /api/reports/exposure/:programId
GET    /api/reports/transactions/:id/drilldown
GET    /api/reports/dashboard
GET    /api/reports/observer/:entityId
```

**Deliverable:** Full dispute lifecycle, auto-escrow hold on dispute, audit packs downloadable, regulator observer access working.

---

## Phase 7: Integrations & Portals
**Duration: 8 weeks | Weeks 37–44**
**Goal: All 6 integration adapters + all 3 portals complete**

### 7A. Integration Adapters (Week 37–42)
<!-- Solo build note: All 6 adapters implemented as mocks where there's no real external system to talk to. Interface + contract + idempotency stay BRD-compliant; backing implementation is a stub returning realistic responses. -->

All adapters implement per BRD Section 28:
- Idempotent processing (idempotency key per request)
- Correlation IDs passed through all calls
- Error response standards
- State callbacks for escrow funding, hold, release, refund, settlement

**`erp.adapter.ts`**
- Inbound: sync POs from ERP → platform
- Outbound: invoice approval, payment confirmation → ERP

**`wms.adapter.ts`**
- Inbound: GRN events, warehouse receipt status
- Outbound: warehouse release authorization

**`tms.adapter.ts`**
- Inbound: dispatch, transit, delivery, POD events
- Outbound: delivery status updates to platform

**`banking.adapter.ts`**
- Inbound: escrow prefunding confirmation callback
- Inbound: disbursement confirmation from lender
- Outbound: payment instruction to bank for supplier settlement

**`dms.adapter.ts`**
- Inbound: document ingestion from external DMS
- Outbound: document hash verification

**`notification.adapter.ts`**
- Events: payment confirmation, dispute alert, maker-checker request, escrow status, eligibility change
- Channels: email / webhook / SMS

**Express Routes: adapter webhooks**
```
POST   /api/adapters/erp/webhook
POST   /api/adapters/wms/webhook
POST   /api/adapters/tms/webhook
POST   /api/adapters/banking/callback
POST   /api/adapters/dms/webhook
```

### 7B. UI Portals (Week 38–44)   <!-- Out of scope for solo build -->
**(Next.js / TypeScript)**   <!-- Out of scope for solo build -->

**Portal 1: Buyer-Supplier Shared Workspace**   <!-- Out of scope for solo build -->
- PO creation, acknowledgement, amendment
- GRN submission + delivery acceptance
- Invoice submission + approval
- Provenance event timeline view
- Dispute raising + resolution
- Escrow payment status + condition tracker
- Maker-checker approval queue
- Notification centre

**Portal 2: Lender Portal**   <!-- Out of scope for solo build -->
- Finance opportunity feed (all 7 products)
- Underwriting dashboard
- Quote + approval management with maker-checker
- Disbursement tracking
- Portfolio exposure view (FR-REP-03)
- Repayment + overdue monitoring

**Portal 3: Admin / Auditor UI**   <!-- Out of scope for solo build -->
- Organization onboarding management
- Program configuration
- Audit evidence pack download (FR-REP-02)
- Regulator observer view — read-only (FR-REP-04)
- Fabric + Polygon network status

**Deliverable:** All integrations live. <!-- Portals out of scope for solo build; demos via Postman + Swagger UI + block explorers. -->

---

## Phase 8: NFRs, Security & Production Readiness
**Duration: 4 weeks | Weeks 45–48**

| NFR | Action |
|---|---|
| NFR-01 Security | TLS on all channels, encryption at rest for MongoDB/PostgreSQL/S3, PKI certificates |
| NFR-02 Availability 99.9% | Multi-peer Fabric, Polygon validator redundancy, load balancer, health checks |
| NFR-03 Performance ≤5s | Load test all trade-event flows, optimize chaincode queries, index MongoDB |
| NFR-04 Scalability | Multi-anchor, multi-supplier, multi-lender load test |
| NFR-05 Auditability | Verify audit-cc captures every state transition with actor + signature |
| NFR-06 Privacy | Verify PDCs — financing terms not visible to non-participants |
| NFR-07 Recoverability | Backup Fabric ledger + MongoDB + PostgreSQL, test DR restore |
| NFR-08 Interoperability | OpenAPI/Swagger docs for all Express routes, adapter test suite |

---

## Phase Summary Timeline

| Phase | What | Duration | Weeks |
|---|---|---|---|
| 1 | Fabric + Polygon setup + Express scaffold + Onboarding | 6 weeks | 1–6 |
| 2 | Trade Document core (PO / GRN / Invoice / 3-way / 4-way match) | 6 weeks | 7–12 |
| 3 | Provenance & Traceability | 4 weeks | 13–16 |
| 4 | Finance Module — all 7 products | 8 weeks | 17–24 |
| 5 | Programmable Money Escrow (Polygon + Bridge) | 8 weeks | 25–32 |
| 6 | Risk, Dispute & Audit | 5 weeks | 33–37 |
| 7 | Integrations + all 3 Portals | 8 weeks | 37–44 |
| 8 | NFRs, Security, Production Readiness | 4 weeks | 45–48 |

**Total: ~48 weeks (~12 months)**

---

## Team Required

| Role | Count | Works On |
|---|---|---|
| Fabric Chaincode Dev (TypeScript) | 2 | All 6 chaincodes, Phases 1–6 |
| Solidity Dev (Polygon) | 1 | 4 escrow contracts, Phase 5 |
| Express.js Backend Dev (TypeScript) | 3 | All routes/controllers/services, Phases 1–7 |
| Next.js Frontend Dev (TypeScript) | 2 | 3 portals, Phase 7 |
| Blockchain DevOps (K8s + Fabric + Polygon) | 1 | Phases 1 and 8 |
| QA Engineer | 1 | All phases |
| Solution Architect / Tech Lead | 1 | All phases |

**Total: 11 people**

---

## Build Count Summary

| Layer | Count |
|---|---|
| Fabric Channels | 3 |
| Fabric PDCs | 3 |
| Fabric Chaincodes | 6 |
| Polygon Smart Contracts | 4 |
| Finance Products | 7 |
| Express.js Route Files | 9 |
| Data Models | 8 |
| State Machines | 7 |
| Business Rules | 9 |
| Integration Adapters | 6 |
| UI Portals | 3 |
| NFRs | 8 |
| BRs (Business Requirements) | 12 |

---

*All items in this plan map directly to BRD/SRS v1.1 (12 April 2026).*
*Nothing outside BRD scope is included. Nothing within BRD scope is omitted.*
