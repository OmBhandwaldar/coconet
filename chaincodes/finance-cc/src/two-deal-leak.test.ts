import * as chai from 'chai';
import sinon from 'sinon';
import { FinanceChaincode } from './finance.chaincode';

const { expect } = chai;

// ─── The scenario this architecture exists for (PRIVACY-DESIGN.md §1.1) ──────
// Bharat Stampings sells to two buyers and finances with two competing lenders:
//
//   Deal A — Tata     buys from Bharat, HDFC  discounts at 2.0%
//   Deal B — Mahindra buys from Bharat, ICICI discounts at 3.5%
//
// Under the role-scoped PDCs originally specified, both lenders were members of
// one financingTermsPDC, so ICICI would hold HDFC's pricing for a shared client.
// These tests assert that no longer happens.

const SALT_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SALT_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

// One shared ledger: public state is common, and the private store is the
// platform org's single collection — exactly the production arrangement.
function makeNetwork() {
  const state: Record<string, Buffer> = {};
  const priv: Record<string, Buffer> = {};

  return function as(msp: string) {
    const transientMap = new Map<string, Buffer>();
    const stub = {
      getState: sinon.stub().callsFake(async (k: string) => state[k] ?? Buffer.alloc(0)),
      putState: sinon.stub().callsFake(async (k: string, v: Buffer) => { state[k] = v; }),
      deleteState: sinon.stub().callsFake(async (k: string) => { delete state[k]; }),
      // A peer only reaches the collection when its org holds it. Non-custodian
      // orgs get nothing back, which is the dissemination boundary.
      getPrivateData: sinon.stub().callsFake(async (_c: string, k: string) =>
        (msp === 'PlatformMSP' ? (priv[k] ?? Buffer.alloc(0)) : Buffer.alloc(0))),
      putPrivateData: sinon.stub().callsFake(async (_c: string, k: string, v: Buffer) => { priv[k] = v; }),
      getTransient: sinon.stub().returns(transientMap),
      setEvent: sinon.stub(),
      getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
      invokeChaincode: sinon.stub().callsFake(async () => ({ status: 200, payload: Buffer.from('') })),
    };
    return {
      stub,
      clientIdentity: { getMSPID: sinon.stub().returns(msp) },
      __setTransient: (v: unknown) => transientMap.set('payload', Buffer.from(JSON.stringify(v))),
      __publicState: state,
    } as any;
  };
}

const cc = new FinanceChaincode();

async function createDeal(
  as: (msp: string) => any,
  id: string, lenderId: string, lenderMsp: string, amount: number, rate: number, salt: string,
) {
  // Written by the platform, which custodies the canonical payload.
  const ctx = as('PlatformMSP');
  ctx.__setTransient({ requested_amount: amount, discount_rate: rate, salt });
  await cc.createFinanceRequest(ctx, JSON.stringify({
    request_id: id, product_type: 'InvoiceDiscounting', asset_type: 'Invoice',
    asset_id: `INV-${id}`, requestor_org_id: 'bharat-001',
    lender_id: lenderId, lender_msp: lenderMsp,
    party_msps: ['SupplierMSP', lenderMsp, 'PlatformMSP'],
  }));
  return ctx;
}

describe('two deals, two competing lenders', () => {
  let as: (msp: string) => any;

  beforeEach(async () => {
    as = makeNetwork();
    await createDeal(as, 'FR-A', 'hdfc-001', 'HDFCMSP', 24255000, 0.02, SALT_A);
    await createDeal(as, 'FR-B', 'icici-001', 'ICICIMSP', 17400000, 0.035, SALT_B);
  });

  it('lets each lender read its own pricing', async () => {
    const hdfc = JSON.parse(await cc.getFinanceRequest(as('PlatformMSP'), 'FR-A'));
    expect(hdfc.discount_rate).to.equal(0.02);
    expect(hdfc.requested_amount).to.equal(24255000);
  });

  // The headline property.
  it("does not let ICICI read HDFC's discount rate", async () => {
    const seen = JSON.parse(await cc.getFinanceRequest(as('ICICIMSP'), 'FR-A'));
    expect(seen).to.not.have.property('discount_rate');
    expect(seen).to.not.have.property('requested_amount');
    expect(seen).to.not.have.property('approved_amount');
  });

  it("does not let HDFC read ICICI's discount rate", async () => {
    const seen = JSON.parse(await cc.getFinanceRequest(as('HDFCMSP'), 'FR-B'));
    expect(seen).to.not.have.property('discount_rate');
    expect(seen).to.not.have.property('requested_amount');
  });

  // A competitor may still see that financing exists — Rule-02 depends on it.
  it('still shows a non-party that the deal exists and its state', async () => {
    const seen = JSON.parse(await cc.getFinanceRequest(as('ICICIMSP'), 'FR-A'));
    expect(seen.request_id).to.equal('FR-A');
    expect(seen.asset_id).to.equal('INV-FR-A');
    expect(seen.status).to.equal('Requested');
  });

  // Channel state is replicated to every member, so the figures must not be in
  // it at all — not merely filtered out on the way back from a query.
  it('keeps both deals figures out of channel public state entirely', () => {
    const ctx = as('ICICIMSP');
    const publicState = JSON.stringify(ctx.__publicState);
    for (const leak of ['0.02', '0.035', '24255000', '17400000']) {
      expect(publicState, `public state contains '${leak}'`).to.not.contain(leak);
    }
  });

  it('refuses a competing lender attempting to write to a deal it is not party to', async () => {
    const ctx = as('ICICIMSP');
    ctx.__setTransient({ requested_amount: 1, salt: SALT_A });
    let threw = false;
    try {
      await cc.createFinanceRequest(ctx, JSON.stringify({
        request_id: 'FR-C', product_type: 'InvoiceDiscounting', asset_type: 'Invoice',
        asset_id: 'INV-FR-A', requestor_org_id: 'bharat-001',
        lender_id: 'hdfc-001', lender_msp: 'HDFCMSP',
        party_msps: ['SupplierMSP', 'HDFCMSP', 'PlatformMSP'],
      }));
    } catch (e) {
      threw = true;
      expect((e as Error).message).to.match(/not a party/);
    }
    expect(threw, 'a non-party write must be refused').to.equal(true);
  });
});
