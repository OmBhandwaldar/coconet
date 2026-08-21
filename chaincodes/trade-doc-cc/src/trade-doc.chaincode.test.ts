import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { TradeDocChaincode } from './trade-doc.chaincode';

chai.use(chaiAsPromised);
const { expect } = chai;

// Minimal Context + stub mock (mirrors onboarding-cc test harness).
function makeCtx(state: Record<string, Buffer> = {}) {
  const stub = {
    getState: sinon.stub().callsFake(async (key: string) => state[key] ?? Buffer.alloc(0)),
    putState: sinon.stub().callsFake(async (key: string, val: Buffer) => { state[key] = val; }),
    setEvent: sinon.stub(),
    getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
  };
  return { stub } as any;
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

// Helper: stand up a PO + accepted GRN so an invoice can match.
async function seedPoAndGrn(ctx: any) {
  await cc.createPO(ctx, JSON.stringify(validPO));
  await cc.createGRN(ctx, validInvoice.grn_id, validPO.po_id, '10000', '');
  await cc.acceptGRN(ctx, validInvoice.grn_id);
}

describe('TradeDocChaincode', () => {

  describe('createPO', () => {
    it('creates a PO directly in Issued status', async () => {
      const ctx = makeCtx();
      const po = JSON.parse(await cc.createPO(ctx, JSON.stringify(validPO)));
      expect(po.status).to.equal('Issued');
      expect(po.po_id).to.equal('TM-PO-2024-0892');
      expect(po.gross_value).to.equal(25000000);
    });

    it('rejects duplicate po_id', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      await expect(
        cc.createPO(ctx, JSON.stringify({ ...validPO, doc_hash: 'other' }))
      ).to.be.rejectedWith(/already exists/);
    });

    it('rejects missing supplier_id', async () => {
      const ctx = makeCtx();
      const { supplier_id, ...noSupplier } = validPO;
      await expect(cc.createPO(ctx, JSON.stringify(noSupplier))).to.be.rejectedWith(/supplier_id is required/);
    });

    it('rejects non-positive gross_value', async () => {
      const ctx = makeCtx();
      await expect(
        cc.createPO(ctx, JSON.stringify({ ...validPO, gross_value: 0 }))
      ).to.be.rejectedWith(/gross_value must be positive/);
    });
  });

  describe('PO state machine', () => {
    it('Issued → Acknowledged by the supplier', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      const po = JSON.parse(await cc.acknowledgePO(ctx, validPO.po_id, 'bharat-001'));
      expect(po.status).to.equal('Acknowledged');
    });

    it('rejects acknowledge by a non-supplier', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      await expect(cc.acknowledgePO(ctx, validPO.po_id, 'someone-else')).to.be.rejectedWith(/Only supplier/);
    });

    it('walks Acknowledged → Locked → Fulfilled → Closed', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      await cc.acknowledgePO(ctx, validPO.po_id, 'bharat-001');
      expect(JSON.parse(await cc.lockPO(ctx, validPO.po_id)).status).to.equal('Locked');
      expect(JSON.parse(await cc.fulfillPO(ctx, validPO.po_id)).status).to.equal('Fulfilled');
      expect(JSON.parse(await cc.closePO(ctx, validPO.po_id)).status).to.equal('Closed');
    });

    it('rejects illegal transition Issued → Fulfilled', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      await expect(cc.fulfillPO(ctx, validPO.po_id)).to.be.rejectedWith(/Illegal PO transition/);
    });

    it('amends an Issued PO and records justification', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      const po = JSON.parse(await cc.amendPO(ctx, validPO.po_id, JSON.stringify({ gross_value: 26000000 }), 'price revision'));
      expect(po.status).to.equal('Amended');
      expect(po.gross_value).to.equal(26000000);
      expect(po.amendments[0].justification).to.equal('price revision');
    });
  });

  describe('GRN', () => {
    it('creates and accepts a GRN, setting accepted_qty', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      await cc.createGRN(ctx, 'grn-1', validPO.po_id, '10000', '');
      const grn = JSON.parse(await cc.acceptGRN(ctx, 'grn-1'));
      expect(grn.status).to.equal('Accepted');
      expect(grn.accepted_qty).to.equal(10000);
    });

    it('rejects GRN against a non-existent PO', async () => {
      const ctx = makeCtx({});
      await expect(cc.createGRN(ctx, 'grn-x', 'NO-SUCH-PO', '10', '')).to.be.rejectedWith(/not found/);
    });

    it('stores and registers an optional GRN doc_hash', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      const grn = JSON.parse(await cc.createGRN(ctx, 'grn-h', validPO.po_id, '10000', 'grn-hash-xyz'));
      expect(grn.doc_hash).to.equal('grn-hash-xyz');
      // A later document reusing that hash is blocked (FR-DOC-04).
      await expect(
        cc.submitInvoice(ctx, JSON.stringify({ ...validInvoice, grn_id: 'grn-h', doc_hash: 'grn-hash-xyz' }))
      ).to.be.rejectedWith(/Duplicate document hash/);
    });
  });

  describe('submitInvoice + duplicate detection', () => {
    it('submits an invoice in Submitted status', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      const inv = JSON.parse(await cc.submitInvoice(ctx, JSON.stringify(validInvoice)));
      expect(inv.status).to.equal('Submitted');
      expect(inv.invoice_id).to.equal('BS-INV-2024-0892');
    });

    it('rejects a duplicate document hash (FR-DOC-04)', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await cc.submitInvoice(ctx, JSON.stringify(validInvoice));
      await expect(
        cc.submitInvoice(ctx, JSON.stringify({ ...validInvoice, invoice_id: 'BS-INV-DUP' }))
      ).to.be.rejectedWith(/Duplicate document hash/);
    });

    it('rejects an invoice whose doc_hash collides with a PO', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await expect(
        cc.submitInvoice(ctx, JSON.stringify({ ...validInvoice, doc_hash: 'po-hash-0892' }))
      ).to.be.rejectedWith(/Duplicate document hash/);
    });
  });

  describe('runThreeWayMatch', () => {
    it('passes when amount ≤ PO and qty ≤ accepted GRN, moving to Matched', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await cc.submitInvoice(ctx, JSON.stringify(validInvoice));
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
      await cc.submitInvoice(ctx, JSON.stringify({ ...validInvoice, amount: 30000000 }));
      const inv = JSON.parse(await cc.runThreeWayMatch(ctx, validInvoice.invoice_id));
      expect(inv.status).to.equal('Submitted');
      expect(inv.match_result.passed).to.equal(false);
      expect(inv.match_result.checks.amount_within_po).to.equal(false);
    });

    it('fails when invoice quantity exceeds accepted GRN quantity', async () => {
      const ctx = makeCtx({});
      await cc.createPO(ctx, JSON.stringify(validPO));
      await cc.createGRN(ctx, validInvoice.grn_id, validPO.po_id, '8000', '');
      await cc.acceptGRN(ctx, validInvoice.grn_id);
      await cc.submitInvoice(ctx, JSON.stringify(validInvoice)); // qty 10000 > accepted 8000
      const inv = JSON.parse(await cc.runThreeWayMatch(ctx, validInvoice.invoice_id));
      expect(inv.match_result.passed).to.equal(false);
      expect(inv.match_result.checks.qty_within_grn).to.equal(false);
    });
  });

  describe('approve / reject / dispute', () => {
    async function matchedInvoice(ctx: any) {
      await seedPoAndGrn(ctx);
      await cc.submitInvoice(ctx, JSON.stringify(validInvoice));
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
      await cc.submitInvoice(ctx, JSON.stringify(validInvoice));
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
      await cc.submitInvoice(ctx, JSON.stringify(validInvoice));
      const inv = JSON.parse(await cc.rejectInvoice(ctx, validInvoice.invoice_id, 'wrong buyer'));
      expect(inv.status).to.equal('Closed');
    });
  });

  describe('assignInvoice', () => {
    async function approvedInvoice(ctx: any) {
      await seedPoAndGrn(ctx);
      await cc.submitInvoice(ctx, JSON.stringify(validInvoice));
      await cc.runThreeWayMatch(ctx, validInvoice.invoice_id);
      await cc.approveInvoice(ctx, validInvoice.invoice_id);
    }

    it('assigns an Approved invoice to a lender', async () => {
      const ctx = makeCtx({});
      await approvedInvoice(ctx);
      const inv = JSON.parse(await cc.assignInvoice(ctx, validInvoice.invoice_id, 'hdfc-001'));
      expect(inv.status).to.equal('Assigned');
      expect(inv.assignment_status).to.equal('Assigned');
      expect(inv.assigned_to).to.equal('hdfc-001');
    });

    it('rejects a second assignment (locked against further assignment)', async () => {
      const ctx = makeCtx({});
      await approvedInvoice(ctx);
      await cc.assignInvoice(ctx, validInvoice.invoice_id, 'hdfc-001');
      await expect(cc.assignInvoice(ctx, validInvoice.invoice_id, 'icici-001')).to.be.rejectedWith(/already assigned/);
    });

    it('rejects assigning a Submitted (unapproved) invoice', async () => {
      const ctx = makeCtx({});
      await seedPoAndGrn(ctx);
      await cc.submitInvoice(ctx, JSON.stringify(validInvoice));
      await expect(cc.assignInvoice(ctx, validInvoice.invoice_id, 'hdfc-001')).to.be.rejectedWith(/Illegal invoice transition/);
    });
  });
});
