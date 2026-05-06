# EXAMPLE-FLOW.md — Worked Example (Test Fixture)

This file is the **frozen reference flow** the MVP must reproduce end-to-end. Names, amounts, and ordering here are authoritative — the Postman collection, integration test, and demo script all replay this flow.

Two parts:
1. **Company Onboarding — User Experience** — what an org goes through from sign-up to active
2. **End-to-End Trade Flow** — the 14-step Tata / Bharat / HDFC deal

---

## Part 1 — Company Onboarding — User Experience

### Stage 1: Account Creation
Company admin enters: legal name, country, company type (buyer / supplier / lender / warehouse / logistics), business email, password. Email is verified via a one-time link. Company is created in Pending status, no transactions yet, but dashboard is accessible to continue onboarding.

### Stage 2: Company Profile
Guided wizard with a visible progress bar. Admin fills: registration number, tax ID, registered address, year of incorporation, industry, turnover band, employee count. Progress auto-saves, admin can close and return anytime.

### Stage 3: Document Upload
Drag-and-drop upload for standard KYB documents, incorporation certificate, tax registration, board resolution, audited financials, authorized signatory list. Each uploaded document gets a unique fingerprint stored on the platform. If format is wrong, the screen explains why and how to fix it.

### Stage 4: Beneficial Ownership & Signatories
Admin lists all parties owning more than 25% and all authorized signatories with their contact details. Sanctions and watchlist screening runs automatically in the background, no action needed from the admin.

### Stage 5: Bank Account Linking
Admin enters the company bank account for payments. Uploads a bank statement or cancelled cheque as proof. Account is verified and marked trusted.

> **Note:** The `bank_account_ref` field is in the BRD (Section 21). The specific verification method is an implementation decision — not mandated by the BRD.

### Stage 6: Submit & Platform Review
Admin clicks Submit for Review. Dashboard shows a clear status banner with estimated timeline. Platform admin team reviews documents, sanctions results, and risk profile. If anything is incomplete, admin receives an in-platform message and email specifying exactly what to correct. Admin updates only the flagged item and resubmits.

### Stage 7: Approval & Activation
**Time:** Instant on approval

On approval:
- Company status changes to Active
- Welcome email sent to admin
- Unique digital identity generated for the company, used to sign every future transaction. Fully managed by the platform, never exposed to the admin.
- Risk tier assigned (e.g. Prime / Standard / High-touch) based on financials and background check
- Full working dashboard unlocked

### Stage 8: Add Team Members
Admin invites users by email and assigns each a role: Maker, Checker, Viewer, Finance Manager, Operations. Each user gets an email with a join link and sets their own password. Admin also configures maker-checker thresholds, e.g. any transaction above a set amount requires a Checker before it executes.

### Stage 9: Connect Trading Partners
Admin searches for existing buyers, suppliers, or banks on the platform and sends connection requests. Counterparty accepts. Once connected, both parties can transact. If a trading partner is not yet on the platform, admin sends them an invitation link to begin their own onboarding.

### Stage 10: Program Enrollment (Optional)
**Time:** 10 minutes

Admin selects which financing programs the company wants access to:
- PO Finance
- Pre-shipment Finance
- Post-shipment Finance
- Invoice Discounting
- Dynamic Discounting / Early Payment
- Warehouse Receipt Financing
- Distributor / Dealer Finance

Can be skipped and completed later.

### Stage 11: System Integrations (Optional)
Connect ERP, warehouse system, logistics system, and notification channels (email / webhook / SMS). Each integration has a step-by-step guide and a test mode before going live. Entirely optional, the platform works fully through the dashboard without any integrations.

---

## Part 2 — End-to-End Trade Flow — Corrected Version

### Entities Involved

| Entity | Role |
|---|---|
| Tata Motors | Buyer |
| Bharat Stampings | Supplier |
| HDFC Bank | Lender |
| SecureStore Warehousing | Warehouse Operator |
| BlueDart Logistics | Logistics Provider |

### People

| Person | Org | Role |
|---|---|---|
| Rajesh | Tata Motors | Procurement Manager (Maker) |
| Priya | Tata Motors | Senior Procurement Head (Checker) |
| Rahul | Tata Motors | Accounts Payable Officer (Maker for invoice) |
| Suresh | Bharat Stampings | Sales Director |
| Kavitha | Bharat Stampings | Finance Manager |
| Amit | HDFC Bank | Relationship Manager (Maker) |
| Nandita | HDFC Bank | Credit Head (Checker) |
| Dinesh | SecureStore | Warehouse Operator |

---

### Step 1 — Purchase Order Created

Rajesh (Tata Motors) logs into the platform.
Opens: Purchase Orders → Create New.

Fills:
- Supplier: Bharat Stampings
- Item: Pressed Steel Body Panels
- Quantity: 10,000 units
- Price per unit: ₹2,500
- Total value: ₹2,50,00,000
- Delivery date: 45 days
- Delivery location: Pune Plant
- Payment terms: 30 days after delivery

PO document uploaded — unique fingerprint stored on the platform.
Submits for internal approval.

Platform runs sanctions screening on both Tata Motors and Bharat Stampings → all clear ✓

Priya (Tata Motors) receives notification — "PO worth ₹2.5 crore awaiting your approval".
Reviews all details. Approves.

**Result:** PO status → Issued. Document hash stored. Bharat Stampings notified instantly.

---

### Step 2 — Purchase Order Acknowledged

Suresh (Bharat Stampings) receives notification.
Opens PO, reviews: quantity, price, delivery date, payment terms.
Clicks: Acknowledge Order.
Acknowledgement timestamp + signature recorded.

**Result:** PO status → Acknowledged. Tamper-proof record of agreed terms.

---

### Step 3 — Pre-Shipment Finance Requested

Kavitha (Bharat Stampings) logs into the platform.
Opens: Finance → Pre-Shipment Finance → Apply.

Fills:
- Linked PO: TM-PO-2024-0892
- Finance amount requested: ₹1,20,00,000
- Purpose: Raw material procurement

Submits to HDFC Bank.

Platform verifies:
- Bharat Stampings is enrolled in Pre-Shipment Finance program ✓
- No active lien on this PO (Rule-02) ✓
- Sanctions screening on all parties → clear ✓

Amit (HDFC Bank) receives the request.
Reviews: PO, risk tier (Standard), Tata Motors' buyer quality score.
Platform auto-calculates advance rate: 48%.
Submits recommendation for approval.

Nandita (HDFC Bank) receives notification — "Finance request ₹1.2 crore awaiting approval".
Reviews credit summary. Approves.

---

### Step 3A — Offer and Acceptance

HDFC Bank sends formal offer to Bharat Stampings:
- Advance amount: ₹1,20,00,000
- Interest rate: 12% p.a.
- Tenor: 45 days
- Security: Perfected lien on PO TM-PO-2024-0892
- Disbursement on acceptance

Kavitha (Bharat Stampings) receives offer notification.
Reviews terms. Clicks: Accept Offer.

Platform actions:
- Perfects security interest on PO → `security_interest_state: Perfected`
- PO locked against any other lender (Rule-02)
- HDFC disburses ₹1,20,00,000 to Bharat Stampings' bank account

**Result:** Finance status → Disbursed. PO status → Locked. Asset locking active.

---

### Step 4 — Production Tracked

Bharat Stampings operations team records each stage, each event linked to both the PO and the active finance request:

| # | Event | Detail | Day |
|---|---|---|---|
| 1 | Raw Material Receipt | Steel coils, 45 tonnes, from Jindal Steel | Day 1 |
| 2 | Quality Inspection | Passed Grade A, certificate uploaded | Day 2 |
| 3 | Transformation | Steel coils → Pressed panels, Batch #BS-2024-PP-01 | Day 3–16 |
| 4 | Final Quality Check | All 10,000 units passed | Day 17 |

Each event is signed by the recording actor and visible to Tata Motors and HDFC Bank in real time.

**Result:** Full production trail permanently saved and tied to the finance request.

---

### Step 5 — Goods Moved to Warehouse

Dinesh (SecureStore) logs into the platform.

Records Custody Transfer:
- Batch: #BS-2024-PP-01
- Items: 10,000 pressed steel panels
- From: Bharat Stampings Factory
- To: SecureStore Facility, Pune
- Condition: Good

Issues warehouse receipt: #WR-2024-0456 (status: Active, lien: None).

---

### Step 6 — Dispatch and Delivery

BlueDart coordinator logs into the platform.
- Records: Dispatch event, Day 19
- Records: Transit checkpoints, Day 19–20
- Records: Delivery event + Proof of Delivery signature from Tata Motors gate security, Day 20

**Result:** Full transit trail on platform. Tata Motors notified of arrival.

---

### Step 7 — Goods Inspected and Accepted

Tata Motors receiving team runs physical inspection.
- 9,900 panels: passed
- 100 panels: rejected (surface defects)

Receiving team member records in platform:
- GRN created: Received 10,000 / Accepted 9,900 / Rejected 100
- Rejection reason noted
- Inspection status: Conditional

Priya (Tata Motors) reviews and confirms partial acceptance.

---

### Step 7A — Handling of Rejected Goods

Tata Motors and Bharat Stampings jointly decide:
- 100 rejected panels returned to Bharat Stampings via BlueDart
- BlueDart records return custody transfer
- Credit note logic not needed — invoice will reflect only accepted quantity
- PO marked as fulfilled at 9,900 units (no replacement shipment required) — both parties agree

**Result:** GRN finalized. Bharat Stampings notified to invoice only for accepted quantity.

---

### Step 8 — Invoice Raised

Kavitha (Bharat Stampings) logs into the platform.
Opens: Invoices → Create New.

Platform pre-fills from GRN: 9,900 units × ₹2,500 = ₹2,47,50,000.
Adds invoice number BS-INV-2024-1102, invoice date, due date (Day 51).
Uploads invoice PDF — fingerprint stored. Submits.

Platform runs **3-way match** automatically:
- PO price vs Invoice price → Match ✓
- GRN accepted qty vs Invoice qty → Match ✓
- Duplicate check → Not a duplicate ✓

**Result:** Invoice status → Matched.

---

### Step 9 — Invoice Approved

Rahul (Tata Motors, AP) receives notification.
Reviews matched invoice. Submits approval (Maker).

Priya (Tata Motors) receives notification.
Reviews. Approves (Checker).

**Result:** Invoice status → Approved → Eligible (ready for financing assignment or escrow).

---

### Step 10 — Invoice Discounting by HDFC Bank

Kavitha (Bharat Stampings) logs into the platform.
Opens: Finance → Invoice Discounting → Apply.

Fills:
- Linked invoice: BS-INV-2024-1102
- Discount rate: 2%
- Expected early payment: ₹2,42,55,000

Submits to HDFC Bank.

Platform verifies:
- Invoice status: Approved ✓
- 3-way match: Passed ✓
- No duplicate financing (Rule-02) ✓
- Sanctions screening on all parties → clear ✓

Amit (HDFC Bank) reviews and submits approval (Maker).
Nandita (HDFC Bank) reviews and gives final sign-off (Checker).

---

### Step 10A — Disbursement with Pre-Shipment Loan Net Settlement

Platform calculates:
- Gross invoice discounting disbursement: ₹2,42,55,000
- Pre-shipment loan outstanding: ₹1,20,00,000 + accrued interest ₹1,77,534 = ₹1,21,77,534
- **Net paid to Bharat Stampings: ₹1,20,77,466**
- Pre-shipment loan automatically settled → status: Repaid → Closed
- Security interest on PO released → `security_interest_state: Released`

Platform actions on invoice:
- Assignment status: Assigned to HDFC Bank
- Security interest state: Perfected
- Invoice locked against further assignment

**Result:** Bharat Stampings receives ₹1,20,77,466 in cash. Pre-shipment loan fully closed. HDFC owns the full invoice worth ₹2,47,50,000.

---

### Step 11 — Escrow Created and Funded

Rajesh (Tata Motors) logs into the platform.
Opens: Payments → Create Escrow.

Fills:
- Linked asset: Invoice BS-INV-2024-1102
- Amount: ₹2,47,50,000
- Funding model: Prefunded
- Sole beneficiary: HDFC Bank — ₹2,47,50,000 (platform detects HDFC owns the invoice)
- Expiry: Day 60

Platform runs sanctions screening on escrow parties → clear ✓
Tata Motors deposits ₹2,47,50,000 from their bank account into the escrow vault.

Platform sets **6 release conditions:**
1. Delivery confirmed
2. Invoice approved by buyer
3. Sanctions clearance confirmed
4. Senior officer approval given
5. Escrow funded (Rule-0A)
6. No active dispute (Rule-0C)

**Result:** Escrow status → Funded. HDFC Bank can see the money is secured and waiting.

---

### Step 12 — Conditions Verified

| Condition | Status | How |
|---|---|---|
| Delivery confirmed | ✓ True | GRN with 9,900 accepted recorded |
| Invoice approved | ✓ True | Priya's approval already recorded |
| Sanctions clearance | ✓ True | Final screening at escrow → clear |
| Escrow funded | ✓ True | Deposit confirmed |
| No active dispute | ✓ True | No dispute raised |
| Senior officer approval | Pending | Notification sent to Priya |

Priya (Tata Motors) receives notification — "Escrow release pending your approval".
Reviews escrow summary — all other conditions already met.
Gives final approval.

**Result:** All 6 conditions → True.

---

### Step 13 — Payment Auto-Released

Platform releases escrow automatically — no manual action needed:
- HDFC Bank receives ₹2,47,50,000 — full invoice value (they own the invoice)
- Bharat Stampings receives ₹0 from escrow — already paid in Step 10A

**HDFC Bank profit recognition:**
- Paid Bharat Stampings: ₹2,42,55,000 (invoice discounting)
- Received from escrow: ₹2,47,50,000
- Profit on discounting: ₹4,95,000
- Plus interest earned on pre-shipment loan: ₹1,77,534
- **Total profit on this deal: ₹6,72,534**

Notifications sent:
- Tata Motors: "Payment of ₹2,47,50,000 released from escrow"
- Bharat Stampings: "Invoice BS-INV-2024-1102 settled"
- HDFC Bank: "₹2,47,50,000 received — invoice collection complete"

**Final statuses:**
- Escrow → Released
- Invoice → Settled → Closed
- Finance Request (pre-shipment) → Repaid → Closed
- Finance Request (invoice discounting) → Settled → Closed
- Purchase Order → Fulfilled → Closed

---

### Step 14 — Audit Record Available

Any authorized party can pull up a complete evidence pack:
- Original PO + Priya's approval + document hash
- Bharat Stampings' acknowledgement with timestamp
- Sanctions screening results at PO creation
- Pre-shipment finance request, offer, acceptance, asset locking
- All 4 production events linked to finance request
- Warehouse receipt from SecureStore
- BlueDart dispatch, transit, delivery with POD signature
- GRN — 9,900 accepted, 100 rejected with return shipment record
- Invoice + document hash + 3-way match result
- Tata Motors' maker-checker approval trail
- Invoice discounting request, approval, net settlement calculation
- Pre-shipment loan closure record
- Escrow instruction, funding, all 6 condition verifications with timestamps
- Final payment release record + HDFC's profit recognition

**Observer access:** Available for regulators (SEBI, RBI) as read-only snapshot on demand.

All tamper-proof. All permanently saved.

---

## Final Money Breakdown

| Entity | Paid Out | Received | Net |
|---|---|---|---|
| Tata Motors | ₹2,47,50,000 (into escrow) | 9,900 panels worth ₹2,47,50,000 | Even — paid fair value |
| Bharat Stampings | ₹1,21,77,534 (pre-shipment loan + interest) + ₹4,95,000 (discount cost) | ₹1,20,00,000 (pre-shipment loan) + ₹2,42,55,000 (invoice discounting) | Net ₹2,40,77,466 — sold ₹2.47 cr goods, paid ₹6.72L for financing |
| HDFC Bank | ₹1,20,00,000 (pre-shipment loan) + ₹2,42,55,000 (invoice discounting) | ₹1,21,77,534 (pre-shipment recovery) + ₹2,47,50,000 (escrow) | ₹6,72,534 profit (₹4.95L discount + ₹1.77L interest) |

---

## Full Flow Summary

| Step | Action |
|---|---|
| 1 | Rajesh creates PO → Priya approves |
| 2 | Suresh acknowledges PO |
| 3 | Kavitha applies for pre-shipment → Amit & Nandita approve |
| 3A | HDFC offers → Kavitha accepts → ₹1.2 cr disbursed → PO locked |
| 4 | Production events recorded (linked to finance request) |
| 5 | Dinesh (SecureStore) issues warehouse receipt |
| 6 | BlueDart delivers with POD signature |
| 7 | Tata Motors inspects — 9,900 accepted, 100 rejected → Priya confirms |
| 7A | 100 rejected panels returned to Bharat Stampings |
| 8 | Kavitha raises invoice → 3-way match passes |
| 9 | Rahul approves → Priya signs off |
| 10 | Kavitha offers invoice to HDFC → Amit & Nandita approve |
| 10A | Platform nets pre-shipment loan → Bharat gets ₹1.20 cr → loan closed |
| 11 | Rajesh creates escrow (beneficiary: HDFC) → funds ₹2.47 cr |
| 12 | All 6 conditions verified → Priya gives release approval |
| 13 | HDFC receives ₹2.47 cr → profit ₹6.72L realized |
| 14 | Audit evidence pack permanently available |

---

## How to Use This File

- **Building a chaincode function?** Search this file for the matching step. The story tells you who calls what, in what order, with what data.
- **Writing a Postman request?** Use the field names + values from the matching step verbatim — the integration test asserts these exact amounts.
- **Adding a new ring post-MVP?** Don't change this flow. Extend it in a new section if needed (e.g. "Dispute path variant" for Ring 3).
- **MVP demo:** Steps 4 and 7A are simplified or skipped (Block 3 has minimal GRN; provenance is Ring 2). The 14-step Postman collection covers steps 1, 2, 3, 3A, 5 (simplified), 7, 8, 9, 10, 10A, 11, 12, 13, 14.
