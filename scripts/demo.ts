/**
 * demo.ts — end-to-end MVP walkthrough (Tata / Bharat / HDFC) against the live API.
 *
 * Runs the implemented slice in order: onboarding → PO → acknowledge → GRN →
 * invoice → 3-way match → approve → pre-shipment finance (locks PO) → invoice
 * discounting + net settlement → escrow create + fund → approve invoice → the
 * bridge auto-releases on Polygon. Asserts each step; prints a settlement summary.
 *
 * Prereq: the stack is up (npm run demo:reset) and the API is running (npm run dev).
 * Usage:  npm run demo
 *
 * Steps 4–6 (provenance/warehouse/dispatch, Ring 2), dispute (Ring 3) and the full
 * audit pack (Ring 1) are narrated in DEMO.md but not executed here.
 */
const BASE = process.env.DEMO_BASE ?? 'http://localhost:3000';
const RUN = Date.now().toString(36).toUpperCase(); // unique suffix → clean every run
const id = (p: string) => `DEMO-${p}-${RUN}`;

// ₹/$ at 1 USD = ₹92 (escrow settles in USD; finance stays in INR units).
const FX = 92;
const inrUsd = (inr: number) => `₹${inr.toLocaleString('en-IN')} / $${Math.round(inr / FX).toLocaleString('en-US')}`;

let stepNo = 0;
function ok(msg: string) { console.log(`\x1b[32m  ✓ ${msg}\x1b[0m`); }
function head(msg: string) { console.log(`\n\x1b[36m[${++stepNo}] ${msg}\x1b[0m`); }
function fail(msg: string): never { console.error(`\x1b[31m  ✗ ${msg}\x1b[0m`); process.exit(1); }

interface ApiResp { success?: boolean; data?: any; error?: any; pending_approval?: boolean; }

// ─── Identity ─────────────────────────────────────────────────────────────────
// The API requires authentication, and each action is restricted to the party
// whose action it is. The demo therefore signs in as the real cast from
// EXAMPLE-FLOW and switches actor per phase — which also proves the
// authorisation model end to end rather than asserting it in a unit test.
const tokens = new Map<string, string>();
let actor = 'platform';

function actingAs(name: string) { actor = name; }

async function login(username: string): Promise<void> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, secret: `${username}-dev-secret` }),
  });
  const json = (await res.json()) as ApiResp;
  if (!res.ok || !json.data?.token) fail(`login as ${username} failed: ${JSON.stringify(json.error ?? json)}`);
  tokens.set(username, json.data.token);
}

async function call(method: string, path: string, body?: unknown): Promise<ApiResp> {
  const headers: Record<string, string> = {};
  if (body) headers['content-type'] = 'application/json';
  const token = tokens.get(actor);
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: ApiResp = {};
  try { json = (await res.json()) as ApiResp; } catch { /* empty */ }
  return { ...json, ...(json.success === undefined ? { success: res.ok } : {}) } as ApiResp & { status?: number };
}

// Assert a successful response and return its data; tolerate "already exists" (502/409)
// for idempotent setup calls when `tolerateExists` is set.
async function expectOk(method: string, path: string, body: unknown, tolerateExists = false): Promise<any> {
  const r = await call(method, path, body);
  if (r.success) return r.data;
  const code = r.error?.code;
  if (tolerateExists && (code === 'FABRIC_ERROR' || code === 'CONFLICT')) return null; // already there
  fail(`${method} ${path} → ${JSON.stringify(r.error ?? r)}`);
}

/**
 * Maker-checker, end to end (BR-09). The maker's call parks the transition and
 * answers 202; a second user in the same org calls the SAME endpoint and the
 * transition commits. Both halves are asserted, because a gate that silently
 * stopped firing would otherwise look exactly like a passing demo.
 */
async function makerChecker(
  maker: string, checker: string, method: string, path: string, body?: unknown,
): Promise<any> {
  actingAs(maker);
  const proposed = await call(method, path, body);
  if (!proposed.success) fail(`${method} ${path} (maker) → ${JSON.stringify(proposed.error ?? proposed)}`);
  if (!proposed.pending_approval) {
    fail(`${path} completed on one signature — the threshold is not gating it`);
  }
  ok(`proposed by ${maker} → PendingApproval (${proposed.data.tx_type})`);

  actingAs(checker);
  const signed = await call(method, path);
  if (!signed.success) fail(`${method} ${path} (checker) → ${JSON.stringify(signed.error ?? signed)}`);
  if (signed.pending_approval) fail(`${path} still pending after ${checker} signed`);
  ok(`countersigned by ${checker}`);
  return signed.data;
}

/** The maker cannot be their own checker — asserted against the live chain. */
async function assertSelfApprovalRefused(maker: string, method: string, path: string, body?: unknown) {
  actingAs(maker);
  const first = await call(method, path, body);
  if (!first.pending_approval) fail(`${path} was not gated — cannot test self-approval`);
  const again = await call(method, path);
  if (again.success) fail(`${maker} approved their own proposal on ${path}`);
  ok(`${maker} refused as their own checker: ${String(again.error?.message ?? '').slice(0, 60)}`);
}

async function setThreshold(orgId: string, txType: string, amount: number) {
  await expectOk('PUT', `/api/onboarding/organizations/${orgId}/maker-checker-thresholds/${txType}`,
    { threshold: amount });
}

async function ensureOrg(orgId: string, body: Record<string, unknown>) {
  await expectOk('POST', '/api/onboarding/organizations', body, true);
  // approve (idempotent: if already Approved the chaincode rejects → tolerate)
  await call('PUT', `/api/onboarding/organizations/${orgId}/status`, { status: 'Approved' });
}

async function main() {
  console.log(`\n\x1b[1mCocoNet MVP demo — run ${RUN}\x1b[0m  (${BASE})`);

  for (const u of ['platform', 'rajesh', 'priya', 'suresh', 'kavitha', 'amit', 'nandita']) await login(u);
  actingAs('platform');

  head('Onboarding — ensure Tata (buyer), Bharat (supplier), HDFC (lender) exist + approved');
  await ensureOrg('tata-001', { org_id: 'tata-001', legal_name: 'Tata Motors Ltd', org_type: 'Buyer', msp_id: 'BuyerMSP', registration_number: 'L28920MH1945PLC004520', gstin: '27AAACT2727Q1ZW', pan: 'AAACT2727Q', country: 'IN', contact_email: 'procurement@tatamotors.com', registered_address: 'Bombay House, Mumbai 400001' });
  await ensureOrg('bharat-001', { org_id: 'bharat-001', legal_name: 'Bharat Stampings Pvt Ltd', org_type: 'Supplier', msp_id: 'SupplierMSP', registration_number: 'U28910MH2002PTC135421', gstin: '27AABCB1234C1ZX', pan: 'AABCB1234C', country: 'IN', contact_email: 'sales@bharatstampings.com', registered_address: 'MIDC Phase II, Pune 411019' });
  await ensureOrg('hdfc-001', { org_id: 'hdfc-001', legal_name: 'HDFC Bank Ltd', org_type: 'Lender', msp_id: 'LenderMSP', registration_number: 'L65920MH1994PLC080618', gstin: '27AAACH2702H1Z9', pan: 'AAACH2702H', country: 'IN', contact_email: 'tradefinance@hdfcbank.com', registered_address: 'HDFC Bank House, Mumbai 400013' });
  ok('3 orgs ready (Approved)');

  head('Maker-checker thresholds (BR-09, Rule-06)');
  // An unset threshold is zero, which means "two signatures for everything" —
  // the safe default, but it makes every path look the same. These figures let
  // one run show both: Tata's ₹2.5cr order and ₹2.47cr invoice breach their
  // thresholds, while goods receipt sits under a deliberately high one.
  await setThreshold('tata-001', 'PO_ISSUE', 5000000);
  await setThreshold('tata-001', 'INVOICE_APPROVE', 5000000);
  await setThreshold('tata-001', 'GRN_ACCEPT', 300000000);
  await setThreshold('hdfc-001', 'FINANCE_APPROVE', 5000000);
  ok('Tata: PO ₹50L, invoice ₹50L, GRN ₹30cr · HDFC: financing ₹50L');

  const PO = id('PO'), GRN = id('GRN');
  const FRPRE = id('FRPRE'), INVD = id('INVD'), FRDISC = id('FRDISC');
  const INVE = id('INVE'), ESC = id('ESC');

  head('Step 1–2 — Purchase Order drafted, issued under two signatures, acknowledged');
  actingAs('rajesh');          // Tata procurement manager
  let po = await expectOk('POST', '/api/trade-docs/purchase-orders', { po_id: PO, buyer_id: 'tata-001', supplier_id: 'bharat-001', currency: 'INR', gross_value: 25000000, item_description: 'Pressed Steel Body Panels', quantity: 10000, price_per_unit: 2500, delivery_terms: '45 days, Pune', payment_terms: '30 days', doc_hash: `po-${RUN}` });
  po.status === 'Draft' || fail(`PO status ${po.status}, expected Draft`); ok(`PO ${PO} drafted (${inrUsd(25000000)})`);
  // Rajesh proposes; Priya, the senior procurement head, countersigns.
  po = await makerChecker('rajesh', 'priya', 'PUT', `/api/trade-docs/purchase-orders/${PO}/issue`);
  po.status === 'Issued' || fail(`PO status ${po.status}`); ok(`PO → Issued`);
  actingAs('suresh');          // Bharat sales director
  po = await expectOk('PUT', `/api/trade-docs/purchase-orders/${PO}/acknowledge`, { supplier_id: 'bharat-001' });
  po.status === 'Acknowledged' || fail(`PO ${po.status}`); ok('PO → Acknowledged');

  head('Step 3–3A — Pre-shipment finance (advance, locks the PO)');
  actingAs('kavitha');         // Bharat finance manager
  await expectOk('POST', '/api/finance/pre-shipment', { request_id: FRPRE, po_id: PO, requestor_org_id: 'bharat-001', requested_amount: 12000000, lender_id: 'hdfc-001' });
  actingAs('amit');            // HDFC relationship manager
  const elig = await expectOk('PUT', `/api/finance/${FRPRE}/validate-eligibility`, undefined);
  elig.eligibility?.passed === true || fail('pre-shipment eligibility failed'); ok('eligibility passed (Rule-01 cross-read + Rule-02)');
  await expectOk('PUT', `/api/finance/${FRPRE}/quote`, { advance_rate: 0.48, interest_rate: 0.12, tenor_days: 45 });
  // HDFC's credit decision needs its credit head as well as the RM.
  await assertSelfApprovalRefused('amit', 'PUT', `/api/finance/${FRPRE}/approve`, { approved_amount: 12000000 });
  const approved = await makerChecker('amit', 'nandita', 'PUT', `/api/finance/${FRPRE}/approve`, { approved_amount: 12000000 });
  approved.approved_amount === 12000000 || fail(`approved ${approved.approved_amount}, expected the figure Amit proposed`);
  ok(`facility approved at the maker's figure (${inrUsd(12000000)})`);
  actingAs('kavitha');         // the supplier accepts the offer
  const acc = await expectOk('PUT', `/api/finance/${FRPRE}/accept`, undefined);
  acc.security_interest_state === 'Perfected' || fail('lien not perfected'); ok(`accepted → lien Perfected, PO locked (${inrUsd(12000000)} advance)`);
  actingAs('amit');            // the lender disburses
  const disb = await expectOk('PUT', `/api/finance/${FRPRE}/disburse`, { disbursement_ref: `NEFT-${RUN}` });
  disb.status === 'Disbursed' || fail('not disbursed'); ok('pre-shipment loan Disbursed');

  head('Step 7–9 — GRN accepted, invoice raised, 3-way match, approved');
  actingAs('rajesh');          // the buyer records what arrived
  await expectOk('POST', '/api/trade-docs/grn', { grn_id: GRN, po_id: PO, received_qty: 10000 });
  // Below Tata's GRN threshold, so one signature carries it — the other half
  // of the gate, and the reason the thresholds above are not all the same.
  const grn = await expectOk('PUT', `/api/trade-docs/grn/${GRN}/accept`, undefined);
  grn.status === 'Accepted' || fail(`GRN ${grn.status}`); ok('GRN accepted on one signature (10,000 units, under ₹30cr)');
  actingAs('kavitha');         // the supplier invoices
  await expectOk('POST', '/api/trade-docs/invoices', { invoice_id: INVD, supplier_id: 'bharat-001', buyer_id: 'tata-001', po_id: PO, grn_id: GRN, amount: 24750000, quantity: 9900, currency: 'INR', due_date: '2024-12-31', doc_hash: `invd-${RUN}` });
  const m = await expectOk('PUT', `/api/trade-docs/invoices/${INVD}/match`, undefined);
  m.match_result?.passed === true || fail('3-way match failed'); ok(`invoice ${inrUsd(24750000)} → 3-way match passed`);
  const approvedInv = await makerChecker('rajesh', 'priya', 'PUT', `/api/trade-docs/invoices/${INVD}/approve`);
  approvedInv.status === 'Approved' || fail(`invoice ${approvedInv.status}`); ok('invoice Approved');

  head('Step 10–10A — Invoice discounting with net settlement');
  actingAs('kavitha');
  await expectOk('POST', '/api/finance/invoice-discounting', { request_id: FRDISC, invoice_id: INVD, requestor_org_id: 'bharat-001', requested_amount: 24255000, lender_id: 'hdfc-001', discount_rate: 0.02 });
  actingAs('amit');
  await expectOk('PUT', `/api/finance/${FRDISC}/validate-eligibility`, undefined);
  await expectOk('PUT', `/api/finance/${FRDISC}/quote`, { discount_rate: 0.02 });
  actingAs('kavitha');
  await expectOk('PUT', `/api/finance/${FRDISC}/accept`, undefined); ok('invoice assigned to HDFC');
  actingAs('amit');
  const settle = await expectOk('PUT', `/api/finance/${FRDISC}/disburse`, { disbursement_ref: `DISC-${RUN}`, pre_shipment_request_id: FRPRE });
  const s = settle.settlement;
  s.net_to_supplier === 12077466 || fail(`net ${s.net_to_supplier} != 12077466`);
  ok(`gross ${inrUsd(s.gross_disbursement)}  −  settled ${inrUsd(s.settled_amount)}`);
  ok(`net to Bharat: ${inrUsd(s.net_to_supplier)}  (pre-shipment loan auto-repaid)`);

  head('Step 11–13 — Escrow created, funded, conditions, auto-released (cross-chain)');
  actingAs('kavitha');
  await expectOk('POST', '/api/trade-docs/invoices', { invoice_id: INVE, supplier_id: 'bharat-001', buyer_id: 'tata-001', po_id: PO, grn_id: GRN, amount: 24750000, quantity: 9900, currency: 'INR', due_date: '2024-12-31', doc_hash: `inve-${RUN}` });
  await expectOk('PUT', `/api/trade-docs/invoices/${INVE}/match`, undefined);
  actingAs('rajesh');          // escrow is buyer-funded (BR-12)
  await expectOk('POST', '/api/escrow/instructions', { escrow_payment_id: ESC, buyer_org_id: 'tata-001', beneficiary_org_id: 'hdfc-001', linked_invoice_id: INVE, amount_usd: 269022 });
  const funded = await expectOk('POST', `/api/escrow/instructions/${ESC}/fund`, undefined);
  funded.status === 'Funded' || fail('escrow not funded'); ok('escrow funded ($269,022 USDC locked in vault on Polygon)');
  await makerChecker('rajesh', 'priya', 'PUT', `/api/trade-docs/invoices/${INVE}/approve`);
  ok('invoice approved on Fabric → bridge picking up InvoiceApproved...');

  // Poll for the bridge-driven release.
  let released = false;
  for (let i = 0; i < 20; i++) {
    const st = await call('GET', `/api/escrow/instructions/${ESC}/status`);
    if (st.data?.status === 'Released') { released = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  released || fail('escrow did not auto-release within 40s');
  ok('bridge flipped condition on Polygon → escrow auto-RELEASED to HDFC ($269,022)');

  head('Sad path — escrow refunded to buyer before release (Rule-0C)');
  const ESCR = id('ESCR');
  actingAs('rajesh');
  await expectOk('POST', '/api/escrow/instructions', { escrow_payment_id: ESCR, buyer_org_id: 'tata-001', beneficiary_org_id: 'hdfc-001', linked_invoice_id: id('INVR'), amount_usd: 50000 });
  const rfunded = await expectOk('POST', `/api/escrow/instructions/${ESCR}/fund`, undefined);
  rfunded.status === 'Funded' || fail('refund-demo escrow not funded'); ok('a second escrow funded ($50,000 USDC locked)');
  const refunded = await expectOk('POST', `/api/escrow/instructions/${ESCR}/refund`, undefined);
  refunded.status === 'Refunded' || fail(`expected Refunded, got ${refunded.status}`);
  ok('escrow REFUNDED to buyer (Tata) before release — funds returned, not paid out');

  console.log('\n\x1b[1m──────────── SETTLEMENT SUMMARY ────────────\x1b[0m');
  console.log(`  Pre-shipment advance to Bharat:  ${inrUsd(12000000)}`);
  console.log(`  Invoice (9,900 units):           ${inrUsd(24750000)}`);
  console.log(`  Discounting gross:               ${inrUsd(24255000)}`);
  console.log(`  Net to Bharat (after loan):      ${inrUsd(12077466)}`);
  console.log(`  Escrow released to HDFC:         $269,022  (₹2,47,50,000)`);
  console.log('\x1b[32m\n✓ MVP end-to-end flow complete.\x1b[0m\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
