import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { TradeDocChaincode } from './trade-doc.chaincode';

chai.use(chaiAsPromised);
const { expect } = chai;

// ─── BR-09 / Rule-06: two signatures above the threshold ─────────────────────
// The cast is EXAMPLE-FLOW's. Tata Motors runs procurement with a maker and a
// checker, and the API signs each of them under a distinct X.509 identity
// (User1@buyer / User2@buyer, wired in Block 3) — which is what makes
// "checker != maker" an assertion about a real credential rather than a claim
// the client makes about itself.
//
//   Rajesh  — Procurement Manager,      maker
//   Priya   — Senior Procurement Head,  checker
//   Suresh  — Bharat Stampings' sales,  not a Tata employee at all
//
// Tata's threshold is ₹10,00,000; the deal is ₹2.47 crore, so every step of it
// needs both signatures.

const RAJESH = 'x509::CN=User1@buyer.coconet.local::CN=ca.buyer.coconet.local';
const PRIYA  = 'x509::CN=User2@buyer.coconet.local::CN=ca.buyer.coconet.local';
const SURESH = 'x509::CN=User1@supplier.coconet.local::CN=ca.supplier.coconet.local';

const THRESHOLD = 1000000;
const PARTY_MSPS = ['BuyerMSP', 'SupplierMSP', 'PlatformMSP'];
const SALT = '0123456789abcdef0123456789abcdef';

const PO = 'TM-PO-2024-0892';
const GRN = 'TM-GRN-2024-0892';
const INV = 'BS-INV-2024-0892';

/**
 * One ledger, many signers — the whole point. `as(identity, msp)` returns a
 * context over shared state, so what one identity writes the next one reads.
 *
 * Endorsement for a private-data chaincode is PlatformMSP-only
 * (PRIVACY-DESIGN.md §3.6), so the endorsing peer always holds the collection;
 * the mock reflects that by letting every context read it.
 */
function makeOrg(thresholds: Record<string, number> = {}) {
  const state: Record<string, Buffer> = {};
  const priv: Record<string, Buffer> = {};

  return function as(id: string, msp = 'BuyerMSP') {
    const transientMap = new Map<string, Buffer>();
    const stub = {
      getState: sinon.stub().callsFake(async (k: string) => state[k] ?? Buffer.alloc(0)),
      putState: sinon.stub().callsFake(async (k: string, v: Buffer) => { state[k] = v; }),
      deleteState: sinon.stub().callsFake(async (k: string) => { delete state[k]; }),
      getPrivateData: sinon.stub().callsFake(async (_c: string, k: string) => priv[k] ?? Buffer.alloc(0)),
      putPrivateData: sinon.stub().callsFake(async (_c: string, k: string, v: Buffer) => { priv[k] = v; }),
      getTransient: sinon.stub().returns(transientMap),
      setEvent: sinon.stub(),
      getTxID: sinon.stub().returns(`tx-${Math.random().toString(16).slice(2)}`),
      getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
      createCompositeKey: (obj: string, attrs: string[]) => `\u0000${obj}\u0000${attrs.join('\u0000')}\u0000`,
      getStateByPartialCompositeKey: sinon.stub().callsFake(async (obj: string) => {
        const prefix = `\u0000${obj}\u0000`;
        const rows = Object.entries(state)
          .filter(([k]) => k.startsWith(prefix))
          .map(([key, value]) => ({ key, value }));
        return (async function* () { for (const r of rows) yield r; })();
      }),
      // onboarding-cc's threshold lookup, cross-chaincode.
      invokeChaincode: sinon.stub().callsFake(async (_cc: string, args: string[]) => {
        const [fn, orgId, txType] = args;
        if (fn !== 'getMakerCheckerThreshold') return { status: 200, payload: Buffer.from('') };
        return {
          status: 200,
          payload: Buffer.from(JSON.stringify({
            org_id: orgId, tx_type: txType, threshold: thresholds[txType] ?? 0,
          })),
        };
      }),
    };
    return {
      stub,
      clientIdentity: {
        getMSPID: sinon.stub().returns(msp),
        getID: sinon.stub().returns(id),
      },
      __setTransient: (v: unknown) => transientMap.set('payload', Buffer.from(JSON.stringify(v))),
      __state: state,
    } as any;
  };
}

const cc = new TradeDocChaincode();

const ALL_GATES = {
  PO_ISSUE: THRESHOLD,
  GRN_ACCEPT: THRESHOLD,
  INVOICE_APPROVE: THRESHOLD,
};

async function draftPO(ctx: any) {
  ctx.__setTransient({
    currency: 'INR', gross_value: 25000000, item_description: 'Pressed Steel Body Panels',
    quantity: 10000, price_per_unit: 2500, delivery_terms: '45 days', payment_terms: '30 days',
    salt: SALT,
  });
  return cc.createPO(ctx, JSON.stringify({
    po_id: PO, buyer_id: 'tata-001', supplier_id: 'bharat-001',
    party_msps: PARTY_MSPS, doc_hash: 'po-hash-0892',
  }));
}

/** Drive a PO all the way to an invoice awaiting its buyer's approval. */
async function seedToMatchedInvoice(as: (id: string, msp?: string) => any) {
  await draftPO(as(RAJESH));
  await cc.issuePO(as(RAJESH), PO);
  await cc.issuePO(as(PRIYA), PO);
  await cc.acknowledgePO(as(SURESH, 'SupplierMSP'), PO, 'bharat-001');

  const grn = as(RAJESH);
  grn.__setTransient({ received_qty: 10000, salt: SALT });
  await cc.createGRN(grn, GRN, PO, 'grn-hash');
  await cc.acceptGRN(as(RAJESH), GRN);
  await cc.acceptGRN(as(PRIYA), GRN);

  const inv = as(SURESH, 'SupplierMSP');
  inv.__setTransient({ amount: 24750000, quantity: 9900, currency: 'INR', due_date: '2024-12-31', salt: SALT });
  await cc.submitInvoice(inv, JSON.stringify({
    invoice_id: INV, supplier_id: 'bharat-001', buyer_id: 'tata-001',
    po_id: PO, grn_id: GRN, doc_hash: 'inv-hash',
  }));
  await cc.runThreeWayMatch(as(RAJESH), INV);
}

describe('maker-checker (BR-09, Rule-06)', () => {
  describe('a PO above the threshold', () => {
    let as: (id: string, msp?: string) => any;

    beforeEach(async () => {
      as = makeOrg(ALL_GATES);
      await draftPO(as(RAJESH));
    });

    it('is created in Draft, not Issued — issuing is the act that needs signing', async () => {
      const po = JSON.parse(await cc.getPurchaseOrder(as(RAJESH), PO));
      expect(po.status).to.equal('Draft');
    });

    it('does not move when only the maker has signed', async () => {
      const res = JSON.parse(await cc.issuePO(as(RAJESH), PO));
      expect(res.pending_approval.tx_type).to.equal('PO_ISSUE');
      expect(res.pending_approval.entity_id).to.equal(PO);

      const po = JSON.parse(await cc.getPurchaseOrder(as(RAJESH), PO));
      expect(po.status).to.equal('Draft');
    });

    it('moves once a second identity in the same org signs', async () => {
      await cc.issuePO(as(RAJESH), PO);
      await cc.issuePO(as(PRIYA), PO);

      const po = JSON.parse(await cc.getPurchaseOrder(as(PRIYA), PO));
      expect(po.status).to.equal('Issued');
    });

    it('refuses the maker as their own checker', async () => {
      await cc.issuePO(as(RAJESH), PO);
      await expect(cc.issuePO(as(RAJESH), PO)).to.be.rejectedWith(/checker must be a different user/);

      const po = JSON.parse(await cc.getPurchaseOrder(as(RAJESH), PO));
      expect(po.status).to.equal('Draft');
    });

    it('refuses a checker from another organisation', async () => {
      await cc.issuePO(as(RAJESH), PO);
      await expect(cc.issuePO(as(SURESH, 'SupplierMSP'), PO))
        .to.be.rejectedWith(/may not approve/);
    });

    it('records who proposed and who approved, for NFR-05', async () => {
      await cc.issuePO(as(RAJESH), PO);
      await cc.issuePO(as(PRIYA), PO);

      const approval = JSON.parse(await cc.getApproval(as(RAJESH), 'PO_ISSUE', PO));
      expect(approval.status).to.equal('Approved');
      expect(approval.maker_id).to.equal(RAJESH);
      expect(approval.checker_id).to.equal(PRIYA);
    });

    it('lets a checker reject with a reason, leaving the PO in Draft', async () => {
      await cc.issuePO(as(RAJESH), PO);
      await cc.rejectApproval(as(PRIYA), 'PO_ISSUE', PO, 'Budget not released this quarter');

      const po = JSON.parse(await cc.getPurchaseOrder(as(RAJESH), PO));
      expect(po.status).to.equal('Draft');
      const approval = JSON.parse(await cc.getApproval(as(RAJESH), 'PO_ISSUE', PO));
      expect(approval.status).to.equal('Rejected');
      expect(approval.reason).to.equal('Budget not released this quarter');
    });

    it('refuses a rejection without a reason', async () => {
      await cc.issuePO(as(RAJESH), PO);
      await expect(cc.rejectApproval(as(PRIYA), 'PO_ISSUE', PO, ''))
        .to.be.rejectedWith(/reason is required/);
    });
  });

  describe('below the threshold', () => {
    it('issues on one signature', async () => {
      // Tata raises its PO threshold above this order's value.
      const as = makeOrg({ ...ALL_GATES, PO_ISSUE: 30000000 });
      await draftPO(as(RAJESH));
      await cc.issuePO(as(RAJESH), PO);

      const po = JSON.parse(await cc.getPurchaseOrder(as(RAJESH), PO));
      expect(po.status).to.equal('Issued');
      await expect(cc.getApproval(as(RAJESH), 'PO_ISSUE', PO)).to.be.rejectedWith(/No approval record/);
    });
  });

  describe('fail-closed threshold lookup', () => {
    it('aborts rather than issuing on one signature when onboarding-cc is unreachable', async () => {
      const as = makeOrg(ALL_GATES);
      await draftPO(as(RAJESH));

      const ctx = as(RAJESH);
      ctx.stub.invokeChaincode = sinon.stub().resolves({ status: 500, message: 'onboarding-cc down' });
      await expect(cc.issuePO(ctx, PO)).to.be.rejectedWith(/threshold lookup .* failed/);

      const po = JSON.parse(await cc.getPurchaseOrder(as(RAJESH), PO));
      expect(po.status).to.equal('Draft');
    });

    it('treats an unset threshold as zero — everything needs two signatures', async () => {
      const as = makeOrg({}); // no thresholds configured at all
      await draftPO(as(RAJESH));
      const res = JSON.parse(await cc.issuePO(as(RAJESH), PO));
      expect(res.pending_approval.status).to.equal('PendingApproval');
    });
  });

  describe('GRN acceptance', () => {
    it('needs both signatures and holds the goods until it has them', async () => {
      const as = makeOrg(ALL_GATES);
      await draftPO(as(RAJESH));
      await cc.issuePO(as(RAJESH), PO);
      await cc.issuePO(as(PRIYA), PO);
      await cc.acknowledgePO(as(SURESH, 'SupplierMSP'), PO, 'bharat-001');

      const grn = as(RAJESH);
      grn.__setTransient({ received_qty: 10000, salt: SALT });
      await cc.createGRN(grn, GRN, PO, 'grn-hash');

      await cc.acceptGRN(as(RAJESH), GRN);
      expect(JSON.parse(await cc.getGRN(as(RAJESH), GRN)).status).to.equal('Received');

      await cc.acceptGRN(as(PRIYA), GRN);
      expect(JSON.parse(await cc.getGRN(as(RAJESH), GRN)).status).to.equal('Accepted');
    });
  });

  describe('invoice approval', () => {
    let as: (id: string, msp?: string) => any;

    beforeEach(async () => {
      as = makeOrg(ALL_GATES);
      await seedToMatchedInvoice(as);
    });

    it('holds a matched invoice at Matched until the checker signs', async () => {
      await cc.approveInvoice(as(RAJESH), INV);
      expect(JSON.parse(await cc.getInvoice(as(RAJESH), INV)).status).to.equal('Matched');

      await cc.approveInvoice(as(PRIYA), INV);
      expect(JSON.parse(await cc.getInvoice(as(RAJESH), INV)).status).to.equal('Approved');
    });

    it('will not let the supplier approve its own invoice', async () => {
      await expect(cc.approveInvoice(as(SURESH, 'SupplierMSP'), INV))
        .to.be.rejectedWith(/may not approve/);
    });
  });

  describe('the approval queue', () => {
    it('lists what this organisation owes a decision on', async () => {
      const as = makeOrg(ALL_GATES);
      await seedToMatchedInvoice(as);
      await cc.approveInvoice(as(RAJESH), INV);

      const queue = JSON.parse(await cc.listPendingApprovals(as(PRIYA)));
      expect(queue).to.have.lengthOf(1);
      expect(queue[0].tx_type).to.equal('INVOICE_APPROVE');
      expect(queue[0].entity_id).to.equal(INV);
    });

    it('does not show one organisation the other side\'s queue', async () => {
      const as = makeOrg(ALL_GATES);
      await seedToMatchedInvoice(as);
      await cc.approveInvoice(as(RAJESH), INV);

      const supplierQueue = JSON.parse(await cc.listPendingApprovals(as(SURESH, 'SupplierMSP')));
      expect(supplierQueue).to.have.lengthOf(0);
    });

    it('keeps the amount under approval off the channel', async () => {
      const as = makeOrg(ALL_GATES);
      await seedToMatchedInvoice(as);
      await cc.approveInvoice(as(RAJESH), INV);

      const channel = JSON.stringify(as(RAJESH).__state);
      expect(channel).to.not.include('24750000');
    });
  });
});
