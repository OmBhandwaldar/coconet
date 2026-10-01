import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { TradeDocChaincode } from './trade-doc.chaincode';
import { approvalStub } from './approval-stub';

chai.use(chaiAsPromised);
const { expect } = chai;

// Minimal Context + stub mock (mirrors onboarding-cc test harness).
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
    // The maker-checker gate (BR-09) runs on every write path: composite keys
    // for the approval ledger, a range query for the queue, and onboarding-cc
    // for the approving org. Thresholds default high here — these suites are
    // about the documents, not the signatures; maker-checker.test.ts is where
    // the gate itself is exercised.
    ...approvalStub(state, () => opts.msp ?? 'PlatformMSP'),
  };
  const clientIdentity = {
      getMSPID: sinon.stub().returns(opts.msp ?? 'PlatformMSP'),
      getID: sinon.stub().returns(`x509::CN=${opts.msp ?? 'PlatformMSP'}-user`),
    };
  const setTransient = (value: unknown) =>
    transientMap.set('payload', Buffer.from(JSON.stringify(value)));
  return { stub, clientIdentity, __private: priv, __setTransient: setTransient } as any;
}

// Worked-example PO — Tata → Bharat, 10,000 panels @ ₹2,500 = ₹2.5cr (EXAMPLE-FLOW step 1).
const validPO = {
  po_id: 'TM-PO-2024-0892',
  buyer_id: 'tata-001',
  supplier_id: 'bharat-001',
  currency: 'INR',
  gross_value: 25000000,
  item_description: 'Pressed Steel Body Panels',
  quantity: 10000,
  price_per_unit: 2500,
  delivery_terms: '45 days, Pune Plant',
  payment_terms: '30 days after delivery',
  doc_hash: 'po-hash-0892',
};

const validInvoice = {
  invoice_id: 'BS-INV-2024-0892',
  supplier_id: 'bharat-001',
  buyer_id: 'tata-001',
  po_id: 'TM-PO-2024-0892',
  grn_id: 'TM-GRN-2024-0892',
  amount: 25000000,
  quantity: 10000,
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

/** Submit an invoice the way the API does: figures as transient. */
async function submitInvoice(ctx: any, inv: any, overrides: Record<string, unknown> = {}) {
  ctx.__setTransient({
    amount: inv.amount, quantity: inv.quantity, currency: inv.currency ?? 'INR',
    due_date: inv.due_date, salt: TEST_SALT, ...overrides,
  });
  return cc.submitInvoice(ctx, JSON.stringify({
    invoice_id: inv.invoice_id, supplier_id: inv.supplier_id, buyer_id: inv.buyer_id,
    po_id: inv.po_id, grn_id: inv.grn_id, doc_hash: inv.doc_hash,
  }));
}

async function reviseInvoice(ctx: any, id: string, amount: number, quantity: number, docHash = '') {
  ctx.__setTransient({ amount, quantity, salt: TEST_SALT });
  return cc.reviseInvoice(ctx, id, docHash);
}

/** Submit a GRN the way the API does: quantity as transient, never an argument. */
async function createGRN(ctx: any, grnId: string, poId: string, qty: number, docHash = '') {
  ctx.__setTransient({ received_qty: qty, salt: TEST_SALT });
  return cc.createGRN(ctx, grnId, poId, docHash);
}

/** Submit a PO the way the API does: index as args, figures as transient. */
async function draftPO(ctx: any, po: any, overrides: Record<string, unknown> = {}) {
  ctx.__setTransient({ ...poPrivateArgs(po), ...overrides });
  return cc.createPO(ctx, poIndexArgs(po));
}

/**
 * Create and issue, which is what the API does when the order is below the
 * buyer's PO_ISSUE threshold — one signature carries it. These suites keep that
 * path; maker-checker.test.ts drives the two-signature one.
 */
async function createPO(ctx: any, po: any, overrides: Record<string, unknown> = {}) {
  await draftPO(ctx, po, overrides);
  return cc.issuePO(ctx, po.po_id);
}


// Helper: stand up a PO + accepted GRN so an invoice can match.
async function seedPoAndGrn(ctx: any) {
  await createPO(ctx, validPO);
  await createGRN(ctx, validInvoice.grn_id, validPO.po_id, 10000, '');
  await cc.acceptGRN(ctx, validInvoice.grn_id);
}

describe('TradeDocChaincode', () => {

  describe('createPO', () => {
    it('creates a PO in Draft — issuing is a separate, signed act', async () => {
      const ctx = makeCtx();
      const draft = JSON.parse(await draftPO(ctx, validPO));
      expect(draft.status).to.equal('Draft');
      expect(draft.gross_value).to.equal(25000000);

      const po = JSON.parse(await cc.issuePO(ctx, validPO.po_id));
      expect(po.status).to.equal('Issued');
      expect(po.po_id).to.equal('TM-PO-2024-0892');
      expect(po.gross_value).to.equal(25000000);
    });

    it('rejects duplicate po_id', async () => {
      const ctx = makeCtx({});
      await draftPO(ctx, validPO);
      await expect(
        draftPO(ctx, { ...validPO, doc_hash: 'other' })
      ).to.be.rejectedWith(/already exists/);
    });

    it('rejects missing supplier_id', async () => {
      const ctx = makeCtx();
      const { supplier_id, ...noSupplier } = validPO;
      await expect(draftPO(ctx, noSupplier)).to.be.rejectedWith(/supplier_id is required/);
    });

    it('rejects non-positive gross_value', async () => {
      const ctx = makeCtx();
      await expect(
        draftPO(ctx, { ...validPO, gross_value: 0 })
      ).to.be.rejectedWith(/gross_value must be positive/);
    });
  });

  describe('PO state machine', () => {
    it('Issued → Acknowledged by the supplier', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      const po = JSON.parse(await cc.acknowledgePO(ctx, validPO.po_id, 'bharat-001'));
      expect(po.status).to.equal('Acknowledged');
    });

    it('rejects acknowledge by a non-supplier', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      await expect(cc.acknowledgePO(ctx, validPO.po_id, 'someone-else')).to.be.rejectedWith(/Only supplier/);
    });

    it('walks Acknowledged → Locked → Fulfilled → Closed', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      await cc.acknowledgePO(ctx, validPO.po_id, 'bharat-001');
      expect(JSON.parse(await cc.lockPO(ctx, validPO.po_id)).status).to.equal('Locked');
      expect(JSON.parse(await cc.fulfillPO(ctx, validPO.po_id)).status).to.equal('Fulfilled');
      expect(JSON.parse(await cc.closePO(ctx, validPO.po_id)).status).to.equal('Closed');
    });

    it('rejects illegal transition Issued → Fulfilled', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      await expect(cc.fulfillPO(ctx, validPO.po_id)).to.be.rejectedWith(/Illegal PO transition/);
    });

    it('amends an Issued PO and records justification', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      const po = JSON.parse(await cc.amendPO(ctx, validPO.po_id, JSON.stringify({ gross_value: 26000000 }), 'price revision'));
      expect(po.status).to.equal('Amended');
      expect(po.gross_value).to.equal(26000000);
      expect(po.amendments[0].justification).to.equal('price revision');
    });
  });

  describe('GRN', () => {
    it('creates and accepts a GRN, setting accepted_qty', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      await createGRN(ctx, 'grn-1', validPO.po_id, 10000, '');
      const grn = JSON.parse(await cc.acceptGRN(ctx, 'grn-1'));
      expect(grn.status).to.equal('Accepted');
      expect(grn.accepted_qty).to.equal(10000);
    });

    it('rejects GRN against a non-existent PO', async () => {
      const ctx = makeCtx({});
      await expect(createGRN(ctx, 'grn-x', 'NO-SUCH-PO', 10, '')).to.be.rejectedWith(/not found/);
    });

    it('stores and registers an optional GRN doc_hash', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      const grn = JSON.parse(await createGRN(ctx, 'grn-h', validPO.po_id, 10000, 'grn-hash-xyz'));
      expect(grn.doc_hash).to.equal('grn-hash-xyz');
      // A later document reusing that hash is blocked (FR-DOC-04).
      await expect(
        submitInvoice(ctx, { ...validInvoice, grn_id: 'grn-h', doc_hash: 'grn-hash-xyz' })
      ).to.be.rejectedWith(/Duplicate document hash/);
    });
  });

  describe('submitInvoice + duplicate detection', () => {
    it('submits an invoice in Submitted status', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      const inv = JSON.parse(await submitInvoice(ctx, validInvoice));
      expect(inv.status).to.equal('Submitted');
      expect(inv.invoice_id).to.equal('BS-INV-2024-0892');
    });

    it('rejects a duplicate document hash (FR-DOC-04)', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, validInvoice);
      await expect(
        submitInvoice(ctx, { ...validInvoice, invoice_id: 'BS-INV-DUP' })
      ).to.be.rejectedWith(/Duplicate document hash/);
    });

    it('rejects an invoice whose doc_hash collides with a PO', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await expect(
        submitInvoice(ctx, { ...validInvoice, doc_hash: 'po-hash-0892' })
      ).to.be.rejectedWith(/Duplicate document hash/);
    });
  });

  describe('runThreeWayMatch', () => {
    it('passes when amount ≤ PO and qty ≤ accepted GRN, moving to Matched', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, validInvoice);
      const inv = JSON.parse(await cc.runThreeWayMatch(ctx, validInvoice.invoice_id));
      expect(inv.status).to.equal('Matched');
      expect(inv.match_result.passed).to.equal(true);
      expect(inv.match_result.checks).to.deep.equal({
        po_link: true, grn_link: true, amount_within_po: true, qty_within_grn: true,
      });
    });

    it('fails when invoice amount exceeds PO gross_value (stays Submitted)', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, { ...validInvoice, amount: 30000000 });
      const inv = JSON.parse(await cc.runThreeWayMatch(ctx, validInvoice.invoice_id));
      expect(inv.status).to.equal('Submitted');
      expect(inv.match_result.passed).to.equal(false);
      expect(inv.match_result.checks.amount_within_po).to.equal(false);
    });

    it('fails when invoice quantity exceeds accepted GRN quantity', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      await createGRN(ctx, validInvoice.grn_id, validPO.po_id, 8000, '');
      await cc.acceptGRN(ctx, validInvoice.grn_id);
      await submitInvoice(ctx, validInvoice); // qty 10000 > accepted 8000
      const inv = JSON.parse(await cc.runThreeWayMatch(ctx, validInvoice.invoice_id));
      expect(inv.match_result.passed).to.equal(false);
      expect(inv.match_result.checks.qty_within_grn).to.equal(false);
    });
  });

  describe('reviseInvoice', () => {
    it('corrects a failed Submitted invoice and re-matches to Matched', async () => {
      const ctx = makeCtx({});
      await createPO(ctx, validPO);
      await createGRN(ctx, validInvoice.grn_id, validPO.po_id, 8000, '');
      await cc.acceptGRN(ctx, validInvoice.grn_id);
      await submitInvoice(ctx, validInvoice); // qty 10000 > accepted 8000 → fails
      let inv = JSON.parse(await cc.runThreeWayMatch(ctx, validInvoice.invoice_id));
      expect(inv.status).to.equal('Submitted');

      inv = JSON.parse(await reviseInvoice(ctx, validInvoice.invoice_id, 20000000, 8000, ''));
      expect(inv.status).to.equal('Matched');
      expect(inv.quantity).to.equal(8000);
      expect(inv.amount).to.equal(20000000);
      expect(inv.match_result.passed).to.equal(true);
    });

    it('refuses to revise a non-Submitted (Matched) invoice', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, validInvoice);
      await cc.runThreeWayMatch(ctx, validInvoice.invoice_id); // → Matched
      await expect(reviseInvoice(ctx, validInvoice.invoice_id, 100, 100, ''))
        .to.be.rejectedWith(/Only a Submitted invoice can be revised/);
    });
  });

  describe('approve / reject / dispute', () => {
    async function matchedInvoice(ctx: any) {
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, validInvoice);
      await cc.runThreeWayMatch(ctx, validInvoice.invoice_id);
    }

    it('approves a Matched invoice', async () => {
      const ctx = makeCtx({});
      await matchedInvoice(ctx);
      const inv = JSON.parse(await cc.approveInvoice(ctx, validInvoice.invoice_id));
      expect(inv.status).to.equal('Approved');
    });

    it('refuses to approve an unmatched (Submitted) invoice', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, validInvoice);
      await expect(cc.approveInvoice(ctx, validInvoice.invoice_id)).to.be.rejectedWith(/Illegal invoice transition/);
    });

    it('disputes a Matched invoice', async () => {
      const ctx = makeCtx({});
      await matchedInvoice(ctx);
      const inv = JSON.parse(await cc.disputeInvoice(ctx, validInvoice.invoice_id, 'quality issue'));
      expect(inv.status).to.equal('Disputed');
    });

    it('rejects (closes) a Submitted invoice', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, validInvoice);
      const inv = JSON.parse(await cc.rejectInvoice(ctx, validInvoice.invoice_id, 'wrong buyer'));
      expect(inv.status).to.equal('Closed');
    });
  });

  describe('assignInvoice', () => {
    async function approvedInvoice(ctx: any) {
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, validInvoice);
      await cc.runThreeWayMatch(ctx, validInvoice.invoice_id);
      await cc.approveInvoice(ctx, validInvoice.invoice_id);
    }

    it('assigns an Approved invoice to a lender', async () => {
      const ctx = makeCtx({});
      await approvedInvoice(ctx);
      const inv = JSON.parse(await cc.assignInvoice(ctx, validInvoice.invoice_id, 'hdfc-001', 'LenderMSP'));
      expect(inv.status).to.equal('Assigned');
      expect(inv.assignment_status).to.equal('Assigned');
      expect(inv.assigned_to).to.equal('hdfc-001');
    });

    it('rejects a second assignment (locked against further assignment)', async () => {
      const ctx = makeCtx({});
      await approvedInvoice(ctx);
      await cc.assignInvoice(ctx, validInvoice.invoice_id, 'hdfc-001', 'LenderMSP');
      await expect(cc.assignInvoice(ctx, validInvoice.invoice_id, 'icici-001', 'LenderMSP')).to.be.rejectedWith(/already assigned/);
    });

    it('rejects assigning a Submitted (unapproved) invoice', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await submitInvoice(ctx, validInvoice);
      await expect(cc.assignInvoice(ctx, validInvoice.invoice_id, 'hdfc-001', 'LenderMSP')).to.be.rejectedWith(/Illegal invoice transition/);
    });
  });
});
