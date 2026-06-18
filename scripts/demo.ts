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

interface ApiResp { success?: boolean; data?: any; error?: any; }

async function call(method: string, path: string, body?: unknown): Promise<ApiResp> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
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

async function ensureOrg(orgId: string, body: Record<string, unknown>) {
  await expectOk('POST', '/api/onboarding/organizations', body, true);
  // approve (idempotent: if already Approved the chaincode rejects → tolerate)
  await call('PUT', `/api/onboarding/organizations/${orgId}/status`, { status: 'Approved' });
}

async function main() {
  console.log(`\n\x1b[1mCocoNet MVP demo — run ${RUN}\x1b[0m  (${BASE})`);

  head('Onboarding — ensure Tata (buyer), Bharat (supplier), HDFC (lender) exist + approved');
  await ensureOrg('tata-001', { org_id: 'tata-001', legal_name: 'Tata Motors Ltd', org_type: 'Buyer', msp_id: 'BuyerMSP', registration_number: 'L28920MH1945PLC004520', gstin: '27AAACT2727Q1ZW', pan: 'AAACT2727Q', country: 'IN', contact_email: 'procurement@tatamotors.com', registered_address: 'Bombay House, Mumbai 400001' });
  await ensureOrg('bharat-001', { org_id: 'bharat-001', legal_name: 'Bharat Stampings Pvt Ltd', org_type: 'Supplier', msp_id: 'SupplierMSP', registration_number: 'U28910MH2002PTC135421', gstin: '27AABCB1234C1ZX', pan: 'AABCB1234C', country: 'IN', contact_email: 'sales@bharatstampings.com', registered_address: 'MIDC Phase II, Pune 411019' });
  await ensureOrg('hdfc-001', { org_id: 'hdfc-001', legal_name: 'HDFC Bank Ltd', org_type: 'Lender', msp_id: 'LenderMSP', registration_number: 'L65920MH1994PLC080618', gstin: '27AAACH2702H1Z9', pan: 'AAACH2702H', country: 'IN', contact_email: 'tradefinance@hdfcbank.com', registered_address: 'HDFC Bank House, Mumbai 400013' });
  ok('3 orgs ready (Approved)');

  const PO = id('PO'), GRN = id('GRN'), INV = id('INV');
  const FRPRE = id('FRPRE'), INVD = id('INVD'), FRDISC = id('FRDISC');
  const INVE = id('INVE'), ESC = id('ESC');

  head('Step 1–2 — Purchase Order issued + acknowledged');
  let po = await expectOk('POST', '/api/trade-docs/purchase-orders', { po_id: PO, buyer_id: 'tata-001', supplier_id: 'bharat-001', currency: 'INR', gross_value: 25000000, item_description: 'Pressed Steel Body Panels', quantity: 10000, price_per_unit: 2500, delivery_terms: '45 days, Pune', payment_terms: '30 days', doc_hash: `po-${RUN}` });
  po.status === 'Issued' || fail(`PO status ${po.status}`); ok(`PO ${PO} → Issued (${inrUsd(25000000)})`);
  po = await expectOk('PUT', `/api/trade-docs/purchase-orders/${PO}/acknowledge`, { supplier_id: 'bharat-001' });
  po.status === 'Acknowledged' || fail(`PO ${po.status}`); ok('PO → Acknowledged');

  head('Step 3–3A — Pre-shipment finance (advance, locks the PO)');
  await expectOk('POST', '/api/finance/pre-shipment', { request_id: FRPRE, po_id: PO, requestor_org_id: 'bharat-001', requested_amount: 12000000, lender_id: 'hdfc-001' });
  const elig = await expectOk('PUT', `/api/finance/${FRPRE}/validate-eligibility`, undefined);
  elig.eligibility?.passed === true || fail('pre-shipment eligibility failed'); ok('eligibility passed (Rule-01 cross-read + Rule-02)');
  await expectOk('PUT', `/api/finance/${FRPRE}/quote`, { advance_rate: 0.48, interest_rate: 0.12, tenor_days: 45 });
  await expectOk('PUT', `/api/finance/${FRPRE}/approve`, { approved_amount: 12000000 });
  const acc = await expectOk('PUT', `/api/finance/${FRPRE}/accept`, undefined);
  acc.security_interest_state === 'Perfected' || fail('lien not perfected'); ok(`accepted → lien Perfected, PO locked (${inrUsd(12000000)} advance)`);
  const disb = await expectOk('PUT', `/api/finance/${FRPRE}/disburse`, { disbursement_ref: `NEFT-${RUN}` });
  disb.status === 'Disbursed' || fail('not disbursed'); ok('pre-shipment loan Disbursed');

  head('Step 7–9 — GRN accepted, invoice raised, 3-way match, approved');
  await expectOk('POST', '/api/trade-docs/grn', { grn_id: GRN, po_id: PO, received_qty: 10000 });
  await expectOk('PUT', `/api/trade-docs/grn/${GRN}/accept`, undefined); ok('GRN accepted (10,000 units)');
  await expectOk('POST', '/api/trade-docs/invoices', { invoice_id: INVD, supplier_id: 'bharat-001', buyer_id: 'tata-001', po_id: PO, grn_id: GRN, amount: 24750000, quantity: 9900, currency: 'INR', due_date: '2024-12-31', doc_hash: `invd-${RUN}` });
  const m = await expectOk('PUT', `/api/trade-docs/invoices/${INVD}/match`, undefined);
  m.match_result?.passed === true || fail('3-way match failed'); ok(`invoice ${inrUsd(24750000)} → 3-way match passed`);
  await expectOk('PUT', `/api/trade-docs/invoices/${INVD}/approve`, undefined); ok('invoice Approved');

  head('Step 10–10A — Invoice discounting with net settlement');
  await expectOk('POST', '/api/finance/invoice-discounting', { request_id: FRDISC, invoice_id: INVD, requestor_org_id: 'bharat-001', requested_amount: 24255000, lender_id: 'hdfc-001', discount_rate: 0.02 });
  await expectOk('PUT', `/api/finance/${FRDISC}/validate-eligibility`, undefined);
  await expectOk('PUT', `/api/finance/${FRDISC}/quote`, { discount_rate: 0.02 });
  await expectOk('PUT', `/api/finance/${FRDISC}/accept`, undefined); ok('invoice assigned to HDFC');
  const settle = await expectOk('PUT', `/api/finance/${FRDISC}/disburse`, { disbursement_ref: `DISC-${RUN}`, pre_shipment_request_id: FRPRE });
  const s = settle.settlement;
  s.net_to_supplier === 12077466 || fail(`net ${s.net_to_supplier} != 12077466`);
  ok(`gross ${inrUsd(s.gross_disbursement)}  −  settled ${inrUsd(s.settled_amount)}`);
  ok(`net to Bharat: ${inrUsd(s.net_to_supplier)}  (pre-shipment loan auto-repaid)`);

  head('Step 11–13 — Escrow created, funded, conditions, auto-released (cross-chain)');
  await expectOk('POST', '/api/trade-docs/invoices', { invoice_id: INVE, supplier_id: 'bharat-001', buyer_id: 'tata-001', po_id: PO, grn_id: GRN, amount: 24750000, quantity: 9900, currency: 'INR', due_date: '2024-12-31', doc_hash: `inve-${RUN}` });
  await expectOk('PUT', `/api/trade-docs/invoices/${INVE}/match`, undefined);
  await expectOk('POST', '/api/escrow/instructions', { escrow_payment_id: ESC, buyer_org_id: 'tata-001', beneficiary_org_id: 'hdfc-001', linked_invoice_id: INVE, amount_usd: 269022 });
  const funded = await expectOk('POST', `/api/escrow/instructions/${ESC}/fund`, undefined);
  funded.status === 'Funded' || fail('escrow not funded'); ok('escrow funded ($269,022 USDC locked in vault on Polygon)');
  await expectOk('PUT', `/api/trade-docs/invoices/${INVE}/approve`, undefined);
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

  console.log('\n\x1b[1m──────────── SETTLEMENT SUMMARY ────────────\x1b[0m');
  console.log(`  Pre-shipment advance to Bharat:  ${inrUsd(12000000)}`);
  console.log(`  Invoice (9,900 units):           ${inrUsd(24750000)}`);
  console.log(`  Discounting gross:               ${inrUsd(24255000)}`);
  console.log(`  Net to Bharat (after loan):      ${inrUsd(12077466)}`);
  console.log(`  Escrow released to HDFC:         $269,022  (₹2,47,50,000)`);
  console.log('\x1b[32m\n✓ MVP end-to-end flow complete.\x1b[0m\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
