import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { FinanceChaincode } from './finance.chaincode';
import { approvalStub } from './approval-stub';

chai.use(chaiAsPromised);
const { expect } = chai;

// ─── BR-09 / Rule-06 on the lending side ─────────────────────────────────────
// HDFC approves a ₹2.42 crore discounting facility. Two people sign it:
//
//   Amit    — Relationship Manager, maker
//   Nandita — Credit Head,          checker
//
// This is where the second signature matters most, because approveFinancing is
// the one gated transition that carries a figure rather than just moving a
// status. So the thing being asserted is not only "two people signed" but
// "they signed the same number": the maker's transient payload is stored with
// the approval and replayed when the checker commits, so a checker cannot sign
// one amount and write another.

const AMIT = 'x509::CN=User1@lender.coconet.local::CN=ca.lender.coconet.local';
const NANDITA = 'x509::CN=User2@lender.coconet.local::CN=ca.lender.coconet.local';
const KAVITHA = 'x509::CN=User2@supplier.coconet.local::CN=ca.supplier.coconet.local';

const SALT = '0123456789abcdef0123456789abcdef';
const PARTIES = ['SupplierMSP', 'LenderMSP', 'PlatformMSP'];
const FR = 'FR-DISC-001';
const APPROVED = 24255000;

const approvedInvoice = { status: 'Approved', match_result: { passed: true } };

/** One ledger, several signers; onboarding-cc answers for HDFC. */
function makeDesk(thresholds: Record<string, number>) {
  const state: Record<string, Buffer> = {};
  const priv: Record<string, Buffer> = {};

  return function as(id: string, msp = 'LenderMSP') {
    const transientMap = new Map<string, Buffer>();
    const approvals = approvalStub(state, () => msp, {
      thresholds,
      orgMsp: 'LenderMSP',
      entitledMsps: ['LenderMSP', 'PlatformMSP'],
    });
    const stub = {
      getState: sinon.stub().callsFake(async (k: string) => state[k] ?? Buffer.alloc(0)),
      putState: sinon.stub().callsFake(async (k: string, v: Buffer) => { state[k] = v; }),
      deleteState: sinon.stub().callsFake(async (k: string) => { delete state[k]; }),
      getPrivateData: sinon.stub().callsFake(async (_c: string, k: string) => priv[k] ?? Buffer.alloc(0)),
      putPrivateData: sinon.stub().callsFake(async (_c: string, k: string, v: Buffer) => { priv[k] = v; }),
      getTransient: sinon.stub().returns(transientMap),
      setEvent: sinon.stub(),
      getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
      ...approvals,
      // trade-doc-cc for the asset, onboarding-cc for the approving org.
      invokeChaincode: sinon.stub().callsFake(async (ccName: string, args: string[]) => {
        if (ccName === 'onboarding-cc') return approvals.invokeChaincode(ccName, args);
        if (args[0] === 'getInvoice') {
          return { status: 200, payload: Buffer.from(JSON.stringify(approvedInvoice)) };
        }
        return { status: 200, payload: Buffer.from('') };
      }),
    };
    return {
      stub,
      clientIdentity: { getMSPID: sinon.stub().returns(msp), getID: sinon.stub().returns(id) },
      __setTransient: (v: unknown) => transientMap.set('payload', Buffer.from(JSON.stringify(v))),
      __state: state,
    } as any;
  };
}

const cc = new FinanceChaincode();

/** Drive a discounting request to Offered, where approval is the next act. */
async function seedToOffered(as: (id: string, msp?: string) => any) {
  const ctx = as(AMIT);
  ctx.__setTransient({ requested_amount: APPROVED, discount_rate: 0.02, salt: SALT });
  await cc.createFinanceRequest(ctx, JSON.stringify({
    request_id: FR, product_type: 'InvoiceDiscounting', asset_type: 'Invoice',
    asset_id: 'BS-INV-2024-1102', requestor_org_id: 'bharat-001',
    lender_id: 'hdfc-001', lender_msp: 'LenderMSP', party_msps: PARTIES,
  }));
  await cc.validateEligibility(as(AMIT), FR);
  const q = as(AMIT);
  q.__setTransient({ discount_rate: 0.02, tenor_days: 45, salt: SALT });
  await cc.submitQuote(q, FR);
}

async function propose(ctx: any, amount: number) {
  ctx.__setTransient({ approved_amount: amount });
  return cc.approveFinancing(ctx, FR);
}

describe('maker-checker on financing approval (BR-09)', () => {
  describe('above HDFC\'s threshold', () => {
    let as: (id: string, msp?: string) => any;

    beforeEach(async () => {
      as = makeDesk({ FINANCE_APPROVE: 5000000 });
      await seedToOffered(as);
    });

    it('records no approved amount on one signature', async () => {
      const res = JSON.parse(await propose(as(AMIT), APPROVED));
      expect(res.pending_approval.tx_type).to.equal('FINANCE_APPROVE');

      const fr = JSON.parse(await cc.getFinanceRequest(as(AMIT), FR));
      expect(fr.approved_amount).to.equal(undefined);
    });

    it('commits the amount once the credit head signs', async () => {
      await propose(as(AMIT), APPROVED);
      await cc.approveFinancing(as(NANDITA), FR);

      const fr = JSON.parse(await cc.getFinanceRequest(as(AMIT), FR));
      expect(fr.approved_amount).to.equal(APPROVED);
    });

    it('commits the amount the MAKER proposed, not one the checker supplies', async () => {
      await propose(as(AMIT), APPROVED);

      // Nandita signs off a larger facility than Amit proposed. The figure
      // under approval came from storage, so hers is ignored.
      const nandita = as(NANDITA);
      nandita.__setTransient({ approved_amount: 90000000 });
      await cc.approveFinancing(nandita, FR);

      const fr = JSON.parse(await cc.getFinanceRequest(as(AMIT), FR));
      expect(fr.approved_amount).to.equal(APPROVED);
    });

    it('needs no transient from the checker at all', async () => {
      await propose(as(AMIT), APPROVED);
      await cc.approveFinancing(as(NANDITA), FR); // no __setTransient

      const fr = JSON.parse(await cc.getFinanceRequest(as(AMIT), FR));
      expect(fr.approved_amount).to.equal(APPROVED);
    });

    it('refuses the relationship manager as their own credit head', async () => {
      await propose(as(AMIT), APPROVED);
      await expect(cc.approveFinancing(as(AMIT), FR))
        .to.be.rejectedWith(/checker must be a different user/);
    });

    it('refuses the supplier a say in the lender\'s credit decision', async () => {
      await propose(as(AMIT), APPROVED);
      await expect(cc.approveFinancing(as(KAVITHA, 'SupplierMSP'), FR))
        .to.be.rejectedWith(/may not approve/);
    });

    it('keeps the approved amount off the channel while it is pending', async () => {
      await propose(as(AMIT), APPROVED);
      expect(JSON.stringify(as(AMIT).__state)).to.not.include(String(APPROVED));
    });

    it('lets the credit head refuse, leaving the request at Offered', async () => {
      await propose(as(AMIT), APPROVED);
      await cc.rejectApproval(as(NANDITA), 'FINANCE_APPROVE', FR, 'Buyer concentration limit reached');

      const fr = JSON.parse(await cc.getFinanceRequest(as(AMIT), FR));
      expect(fr.status).to.equal('Offered');
      expect(fr.approved_amount).to.equal(undefined);
    });
  });

  // ─── What a code review found, after the first pass passed ─────────────────
  describe('holes the first implementation left', () => {
    it('refuses an empty body from a maker rather than approving zero', async () => {
      // proposedAmount() returned 0 for an absent transient so the checker
      // would not have to send one. With approved_amount optional at the API,
      // an empty body then slipped through the gate as 0 <= threshold and
      // persisted a facility of nothing, plus a FinanceApproved event.
      const as = makeDesk({ FINANCE_APPROVE: 5000000 });
      await seedToOffered(as);

      const ctx = as(AMIT);
      ctx.__setTransient({});
      await expect(cc.approveFinancing(ctx, FR)).to.be.rejectedWith(/Invalid approved amount/);

      const fr = JSON.parse(await cc.getFinanceRequest(as(AMIT), FR));
      expect(fr.approved_amount).to.equal(undefined);
    });

    it('will not let one user replay the approval and reset the agreed figure', async () => {
      // approveFinancing leaves the request at Offered, so unlike every other
      // gated transition its own state machine does not reject a replay. The
      // gate is the only thing standing between a lender and quietly rewriting
      // an approved facility to a sub-threshold amount on one signature.
      const as = makeDesk({ FINANCE_APPROVE: 5000000 });
      await seedToOffered(as);
      await propose(as(AMIT), APPROVED);
      await cc.approveFinancing(as(NANDITA), FR);

      await expect(propose(as(AMIT), 1000)).to.be.rejectedWith(/already been approved/);
      const fr = JSON.parse(await cc.getFinanceRequest(as(AMIT), FR));
      expect(fr.approved_amount).to.equal(APPROVED);
    });

    it('preserves a refusal against a re-proposal', async () => {
      const as = makeDesk({ FINANCE_APPROVE: 5000000 });
      await seedToOffered(as);
      await propose(as(AMIT), APPROVED);
      await cc.rejectApproval(as(NANDITA), 'FINANCE_APPROVE', FR, 'Buyer concentration limit');

      await expect(propose(as(AMIT), 20000000)).to.be.rejectedWith(/was refused by/);
      const approval = JSON.parse(await cc.getApproval(as(AMIT), 'FINANCE_APPROVE', FR));
      expect(approval.reason).to.equal('Buyer concentration limit');
    });
  });

  describe('below the threshold', () => {
    it('approves on one signature', async () => {
      const as = makeDesk({ FINANCE_APPROVE: 50000000 });
      await seedToOffered(as);
      await propose(as(AMIT), APPROVED);

      const fr = JSON.parse(await cc.getFinanceRequest(as(AMIT), FR));
      expect(fr.approved_amount).to.equal(APPROVED);
    });

    it('still requires a figure from the maker', async () => {
      const as = makeDesk({ FINANCE_APPROVE: 50000000 });
      await seedToOffered(as);
      await expect(propose(as(AMIT), 0)).to.be.rejectedWith(/Invalid approved amount/);
    });
  });
});
