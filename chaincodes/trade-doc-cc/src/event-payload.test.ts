import * as chai from 'chai';
import sinon from 'sinon';
import { TradeDocChaincode } from './trade-doc.chaincode';

const { expect } = chai;

// ─── Event payload contract (PRIVACY-DESIGN.md §3.2) ──────────────────────────
// Chaincode events are delivered to EVERY channel member and are immutable once
// in a block. A commercial value emitted here is leaked permanently — there is no
// retroactive fix. Payloads therefore carry identifiers, statuses and hashes only.
//
// This guard is a whitelist, not a blacklist: a key nobody listed is a failure.
// That is deliberate — it catches fields added later by someone who has not read
// the design doc.
const ALLOWED_KEYS = new Set([
  'po_id', 'grn_id', 'invoice_id',           // entity identifiers (deal code is derived from these)
  'buyer_id', 'supplier_id', 'assigned_to',  // party org ids
  'status',                                  // state-machine position
  'doc_hash',                                // document fingerprint (already one-way)
  'changed_fields',                          // amendment field NAMES, never their values
  'failed_checks',                           // 3-way match check names, never the figures
]);

function collectKeys(value: unknown, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const v of value) collectKeys(v, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.push(k);
      collectKeys(v, into);
    }
  }
  return into;
}

function makeCtx(state: Record<string, Buffer> = {}, opts: { msp?: string; transient?: unknown } = {}) {
  // Private collections live in their own keyspace and are only readable by a
  // peer of the owning org — the mock keeps them separate for the same reason.
  const priv: Record<string, Buffer> = {};
  const transientMap = new Map<string, Buffer>();
  if (opts.transient !== undefined) {
    transientMap.set('payload', Buffer.from(JSON.stringify(opts.transient)));
  }
  const stub = {
    getState: sinon.stub().callsFake(async (key: string) => state[key] ?? Buffer.alloc(0)),
    putState: sinon.stub().callsFake(async (key: string, val: Buffer) => { state[key] = val; }),
    deleteState: sinon.stub().callsFake(async (key: string) => { delete state[key]; }),
    getPrivateData: sinon.stub().callsFake(async (_c: string, key: string) => priv[key] ?? Buffer.alloc(0)),
    putPrivateData: sinon.stub().callsFake(async (_c: string, key: string, val: Buffer) => { priv[key] = val; }),
    getTransient: sinon.stub().returns(transientMap),
    setEvent: sinon.stub(),
    getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
  };
  const clientIdentity = { getMSPID: sinon.stub().returns(opts.msp ?? 'PlatformMSP') };
  const setTransient = (value: unknown) =>
    transientMap.set('payload', Buffer.from(JSON.stringify(value)));
  return { stub, clientIdentity, __private: priv, __setTransient: setTransient } as any;
}

// Every setEvent call made on this ctx, decoded.
function emitted(ctx: any): { name: string; payload: Record<string, unknown> }[] {
  return ctx.stub.setEvent.getCalls().map((c: any) => ({
    name: c.args[0],
    payload: JSON.parse(Buffer.from(c.args[1]).toString()),
  }));
}

function assertNoCommercialData(events: { name: string; payload: Record<string, unknown> }[]) {
  expect(events.length, 'flow emitted no events — the guard would vacuously pass').to.be.greaterThan(0);
  for (const { name, payload } of events) {
    for (const key of collectKeys(payload)) {
      expect(
        ALLOWED_KEYS.has(key),
        `event '${name}' payload carries disallowed key '${key}' — see PRIVACY-DESIGN.md §3.2`,
      ).to.equal(true);
    }
  }
}

const po = {
  po_id: 'TM-PO-2024-0892',
  buyer_id: 'tata-001',
  supplier_id: 'bharat-001',
  currency: 'INR',
  gross_value: 25000000,
  item_description: 'Pressed Steel Body Panels',
  quantity: 10000,
  price_per_unit: 2500,
  doc_hash: 'po-hash-0892',
};

const invoice = {
  invoice_id: 'BS-INV-2024-0892',
  supplier_id: 'bharat-001',
  buyer_id: 'tata-001',
  po_id: po.po_id,
  grn_id: 'TM-GRN-2024-0892',
  amount: 24750000,
  quantity: 9900,
  currency: 'INR',
  due_date: '2024-12-31',
  doc_hash: 'inv-hash-0892',
};

const cc = new TradeDocChaincode();

// ─── Private-data test helpers (PRIVACY-DESIGN.md §2.1) ──────────────────────
// createPO now takes identifiers as arguments and commercial figures as
// transient data, so the figures never enter the transaction proposal.
const PARTY_MSPS = ['BuyerMSP', 'SupplierMSP', 'PlatformMSP'];
const TEST_SALT = '0123456789abcdef0123456789abcdef';

function poIndexArgs(po: any) {
  return JSON.stringify({
    po_id: po.po_id, buyer_id: po.buyer_id, supplier_id: po.supplier_id,
    party_msps: PARTY_MSPS, doc_hash: po.doc_hash,
  });
}

function poPrivateArgs(po: any) {
  return {
    currency: po.currency, gross_value: po.gross_value,
    item_description: po.item_description, quantity: po.quantity,
    price_per_unit: po.price_per_unit, delivery_terms: po.delivery_terms ?? '',
    payment_terms: po.payment_terms ?? '', salt: TEST_SALT,
  };
}

/** Submit a PO the way the API does: index as args, figures as transient. */
async function createPO(ctx: any, po: any, overrides: Record<string, unknown> = {}) {
  ctx.__setTransient({ ...poPrivateArgs(po), ...overrides });
  return cc.createPO(ctx, poIndexArgs(po));
}


describe('trade-doc-cc event payload contract', () => {

  it('emits no commercial data across the PO lifecycle', async () => {
    const ctx = makeCtx({});
    await createPO(ctx, po);
    await cc.amendPO(ctx, po.po_id, JSON.stringify({ gross_value: 26000000, quantity: 10400 }), 'revised forecast');
    await cc.acknowledgePO(ctx, po.po_id, 'bharat-001');
    await cc.lockPO(ctx, po.po_id);
    await cc.fulfillPO(ctx, po.po_id);
    assertNoCommercialData(emitted(ctx));
  });

  it('emits no commercial data across the GRN lifecycle', async () => {
    const ctx = makeCtx({});
    await createPO(ctx, po);
    await cc.createGRN(ctx, invoice.grn_id, po.po_id, '9900', 'grn-hash-0892');
    await cc.acceptGRN(ctx, invoice.grn_id);
    assertNoCommercialData(emitted(ctx));
  });

  it('emits no commercial data across the invoice lifecycle', async () => {
    const ctx = makeCtx({});
    await createPO(ctx, po);
    await cc.createGRN(ctx, invoice.grn_id, po.po_id, '9900', '');
    await cc.acceptGRN(ctx, invoice.grn_id);
    await cc.submitInvoice(ctx, JSON.stringify(invoice));
    await cc.runThreeWayMatch(ctx, invoice.invoice_id);
    await cc.approveInvoice(ctx, invoice.invoice_id);
    await cc.assignInvoice(ctx, invoice.invoice_id, 'hdfc-001');
    assertNoCommercialData(emitted(ctx));
  });

  // A failed match builds human-readable reasons such as
  // "Invoice amount 26000000 exceeds PO gross_value 25000000" — the figures of
  // both documents, in free text, to every member of the channel.
  it('emits no commercial data when the 3-way match FAILS', async () => {
    const ctx = makeCtx({});
    await createPO(ctx, po);
    await cc.createGRN(ctx, invoice.grn_id, po.po_id, '100', '');
    await cc.acceptGRN(ctx, invoice.grn_id);
    await cc.submitInvoice(ctx, JSON.stringify({ ...invoice, amount: 99000000 }));
    await cc.runThreeWayMatch(ctx, invoice.invoice_id);

    const names = emitted(ctx).map((e) => e.name);
    expect(names, 'the match must actually fail for this guard to mean anything')
      .to.include('InvoiceMatchFailed');
    assertNoCommercialData(emitted(ctx));
  });

  it('emits no commercial data when an invoice is rejected or disputed', async () => {
    const ctx = makeCtx({});
    await createPO(ctx, po);
    await cc.createGRN(ctx, invoice.grn_id, po.po_id, '9900', '');
    await cc.acceptGRN(ctx, invoice.grn_id);
    await cc.submitInvoice(ctx, JSON.stringify(invoice));
    await cc.rejectInvoice(ctx, invoice.invoice_id, 'short by 100 units, value 250000');
    assertNoCommercialData(emitted(ctx));
  });
});
