import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { FinanceChaincode } from './finance.chaincode';

chai.use(chaiAsPromised);
const { expect } = chai;

// Context mock. `cross` maps a trade-doc-cc function name → the object its query
// should return; any other (write) cross-invoke defaults to status 200.
function makeCtx(state: Record<string, Buffer> = {}, cross: Record<string, unknown> = {}) {
  const invokeChaincode = sinon.stub().callsFake(async (_cc: string, args: string[]) => {
    const fn = args[0];
    if (Object.prototype.hasOwnProperty.call(cross, fn)) {
      return { status: 200, payload: Buffer.from(JSON.stringify(cross[fn])) };
    }
    return { status: 200, payload: Buffer.from('') }; // lockPO / assignInvoice
  });
  const stub = {
    getState: sinon.stub().callsFake(async (key: string) => state[key] ?? Buffer.alloc(0)),
    putState: sinon.stub().callsFake(async (key: string, val: Buffer) => { state[key] = val; }),
    deleteState: sinon.stub().callsFake(async (key: string) => { delete state[key]; }),
    setEvent: sinon.stub(),
    getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
    invokeChaincode,
  };
  return { ctx: { stub } as any, invokeChaincode };
}

const preShip = {
  request_id: 'FR-PRE-001',
  product_type: 'PreShipment',
  asset_type: 'PO',
  asset_id: 'TM-PO-2024-0892',
  requestor_org_id: 'bharat-001',
  lender_id: 'hdfc-001',
  requested_amount: 12000000,
};

const disc = {
  request_id: 'FR-DISC-001',
  product_type: 'InvoiceDiscounting',
  asset_type: 'Invoice',
  asset_id: 'BS-INV-2024-1102',
  requestor_org_id: 'bharat-001',
  lender_id: 'hdfc-001',
  requested_amount: 24255000,
};

const ackedPO = { status: 'Acknowledged' };
const approvedInvoice = { status: 'Approved', match_result: { passed: true } };

const cc = new FinanceChaincode();

describe('FinanceChaincode', () => {

  describe('createFinanceRequest', () => {
    it('creates a request in Requested status', async () => {
      const { ctx } = makeCtx();
      const fr = JSON.parse(await cc.createFinanceRequest(ctx, JSON.stringify(preShip)));
      expect(fr.status).to.equal('Requested');
      expect(fr.security_interest_state).to.equal('None');
    });

    it('rejects an invalid product_type', async () => {
      const { ctx } = makeCtx();
      await expect(
        cc.createFinanceRequest(ctx, JSON.stringify({ ...preShip, product_type: 'Mortgage' }))
      ).to.be.rejectedWith(/Invalid product_type/);
    });

    it('rejects a duplicate request_id', async () => {
      const { ctx } = makeCtx();
      await cc.createFinanceRequest(ctx, JSON.stringify(preShip));
      await expect(cc.createFinanceRequest(ctx, JSON.stringify(preShip))).to.be.rejectedWith(/already exists/);
    });
  });

  describe('validateEligibility — Rule-01 (cross-chaincode read)', () => {
    it('passes for an Acknowledged PO (pre-shipment)', async () => {
      const { ctx, invokeChaincode } = makeCtx({}, { getPurchaseOrder: ackedPO });
      await cc.createFinanceRequest(ctx, JSON.stringify(preShip));
      const fr = JSON.parse(await cc.validateEligibility(ctx, preShip.request_id));
      expect(fr.status).to.equal('Under Review');
      expect(fr.eligibility.passed).to.equal(true);
      expect(invokeChaincode.calledWithMatch('trade-doc-cc', ['getPurchaseOrder', preShip.asset_id])).to.equal(true);
    });

    it('passes for an Approved + matched invoice (discounting)', async () => {
      const { ctx } = makeCtx({}, { getInvoice: approvedInvoice });
      await cc.createFinanceRequest(ctx, JSON.stringify(disc));
      const fr = JSON.parse(await cc.validateEligibility(ctx, disc.request_id));
      expect(fr.eligibility.passed).to.equal(true);
      expect(fr.eligibility.checks.three_way_match_passed).to.equal(true);
    });

    it('rejects an un-approved (Submitted) invoice — Rule-01', async () => {
      const { ctx } = makeCtx({}, { getInvoice: { status: 'Submitted', match_result: { passed: false } } });
      await cc.createFinanceRequest(ctx, JSON.stringify(disc));
      await expect(cc.validateEligibility(ctx, disc.request_id)).to.be.rejectedWith(/Rule-01|financeable/);
    });
  });

  describe('full pre-shipment flow', () => {
    async function offered() {
      const { ctx, invokeChaincode } = makeCtx({}, { getPurchaseOrder: ackedPO });
      await cc.createFinanceRequest(ctx, JSON.stringify(preShip));
      await cc.validateEligibility(ctx, preShip.request_id);
      await cc.submitQuote(ctx, preShip.request_id, JSON.stringify({ advance_rate: 0.48, interest_rate: 0.12, tenor_days: 45 }));
      return { ctx, invokeChaincode };
    }

    it('Offered → Accepted locks the PO via cross-invoke + perfects the lien', async () => {
      const { ctx, invokeChaincode } = await offered();
      await cc.approveFinancing(ctx, preShip.request_id, '12000000');
      const fr = JSON.parse(await cc.acceptOffer(ctx, preShip.request_id));
      expect(fr.status).to.equal('Accepted');
      expect(fr.security_interest_state).to.equal('Perfected');
      expect(invokeChaincode.calledWithMatch('trade-doc-cc', ['lockPO', preShip.asset_id])).to.equal(true);
    });

    it('disburses then records repayment, releasing the lien', async () => {
      const { ctx } = await offered();
      await cc.acceptOffer(ctx, preShip.request_id);
      await cc.disburseFunds(ctx, preShip.request_id, 'NEFT-001', '');
      const fr = JSON.parse(await cc.recordRepayment(ctx, preShip.request_id, '12177534', 'NETSETTLE-001'));
      expect(fr.status).to.equal('Repaid');
      expect(fr.security_interest_state).to.equal('Released');
    });

    it('rejects disburse before accept (illegal transition)', async () => {
      const { ctx } = await offered();
      await expect(cc.disburseFunds(ctx, preShip.request_id, 'X', '')).to.be.rejectedWith(/Illegal finance transition/);
    });
  });

  describe('Rule-02 — duplicate financing prevention', () => {
    it('blocks a second lock on the same asset across two lenders', async () => {
      const state: Record<string, Buffer> = {};
      const { ctx } = makeCtx(state, { getPurchaseOrder: ackedPO });
      // Lender A finances the PO.
      await cc.createFinanceRequest(ctx, JSON.stringify(preShip));
      await cc.validateEligibility(ctx, preShip.request_id);
      await cc.submitQuote(ctx, preShip.request_id, JSON.stringify({ interest_rate: 0.12 }));
      await cc.acceptOffer(ctx, preShip.request_id);

      // Lender B tries to finance the same PO.
      const second = { ...preShip, request_id: 'FR-PRE-002', lender_id: 'icici-001' };
      await cc.createFinanceRequest(ctx, JSON.stringify(second));
      // validateEligibility now sees the active lien.
      await expect(cc.validateEligibility(ctx, 'FR-PRE-002')).to.be.rejectedWith(/active lien|Rule-02/);
    });

    it('rejects acceptOffer when a competing lien appears on the asset', async () => {
      const state: Record<string, Buffer> = {};
      const { ctx } = makeCtx(state, { getPurchaseOrder: ackedPO });
      await cc.createFinanceRequest(ctx, JSON.stringify(preShip));
      await cc.validateEligibility(ctx, preShip.request_id);
      await cc.submitQuote(ctx, preShip.request_id, JSON.stringify({ interest_rate: 0.12 }));
      // Simulate a lien landing between eligibility and acceptance (race / concurrent lender).
      state[`LOCK:PO:${preShip.asset_id}`] = Buffer.from(JSON.stringify({ request_id: 'other' }));
      await expect(cc.acceptOffer(ctx, preShip.request_id)).to.be.rejectedWith(/already locked|Rule-02/);
    });
  });
});
