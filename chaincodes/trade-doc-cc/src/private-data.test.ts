import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { TradeDocChaincode } from './trade-doc.chaincode';
import { approvalStub } from './approval-stub';

chai.use(chaiAsPromised);
const { expect } = chai;

// ─── Design 2: channel state is an index, payload is private ─────────────────
// PRIVACY-DESIGN.md §2.1. A channel member who is not party to a deal may see
// that it exists; it must not be able to see what it is worth.

const PARTY_MSPS = ['BuyerMSP', 'SupplierMSP', 'PlatformMSP'];
const SALT = '0123456789abcdef0123456789abcdef';

function makeCtx(state: Record<string, Buffer> = {}, opts: { msp?: string; transient?: unknown } = {}) {
  const priv: Record<string, Buffer> = {};
  const transientMap = new Map<string, Buffer>();
  if (opts.transient !== undefined) transientMap.set('payload', Buffer.from(JSON.stringify(opts.transient)));
  const stub = {
    getState: sinon.stub().callsFake(async (key: string) => state[key] ?? Buffer.alloc(0)),
    putState: sinon.stub().callsFake(async (key: string, val: Buffer) => { state[key] = val; }),
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
  return {
    stub,
    clientIdentity: {
      getMSPID: sinon.stub().returns(opts.msp ?? 'PlatformMSP'),
      getID: sinon.stub().returns(`x509::CN=${opts.msp ?? 'PlatformMSP'}-user`),
    },
    __private: priv,
    __setTransient: (v: unknown) => transientMap.set('payload', Buffer.from(JSON.stringify(v))),
  } as any;
}

const po = {
  po_id: 'TM-PO-2024-0892',
  buyer_id: 'tata-001',
  supplier_id: 'bharat-001',
  party_msps: PARTY_MSPS,
  doc_hash: 'po-hash-0892',
};

const figures = {
  currency: 'INR',
  gross_value: 25000000,
  item_description: 'Pressed Steel Body Panels',
  quantity: 10000,
  price_per_unit: 2500,
  delivery_terms: '45 days, Pune Plant',
  payment_terms: '30 days',
  salt: SALT,
};

const cc = new TradeDocChaincode();

async function draft(ctx: any, overrides: Record<string, unknown> = {}) {
  ctx.__setTransient({ ...figures, ...overrides });
  return cc.createPO(ctx, JSON.stringify(po));
}

/** Create and issue — one signature, since these fixtures are below threshold. */
async function create(ctx: any, overrides: Record<string, unknown> = {}) {
  await draft(ctx, overrides);
  return cc.issuePO(ctx, po.po_id);
}

describe('trade-doc-cc private data', () => {

  it('writes no commercial figure to channel public state', async () => {
    const state: Record<string, Buffer> = {};
    await create(makeCtx(state));

    const publicJson = state['PO:TM-PO-2024-0892'].toString();
    for (const leak of ['25000000', '2500', '10000', 'Pressed Steel']) {
      expect(publicJson, `public state leaks '${leak}'`).to.not.contain(leak);
    }
    // ...while still carrying what the rules and the bridge need.
    const index = JSON.parse(publicJson);
    expect(index.po_id).to.equal('TM-PO-2024-0892');
    expect(index.status).to.equal('Issued');
    expect(index.doc_hash).to.equal('po-hash-0892');
  });

  it('writes the figures to the private collection', async () => {
    const ctx = makeCtx({});
    await create(ctx);
    const stored = JSON.parse(ctx.__private['PO:TM-PO-2024-0892'].toString());
    expect(stored.gross_value).to.equal(25000000);
    expect(stored.price_per_unit).to.equal(2500);
  });

  // The salt is what stops a competitor recovering a round figure by hashing
  // candidate values against the public hash Fabric publishes (§3.3).
  it('refuses a payload with no salt', async () => {
    const ctx = makeCtx({});
    ctx.__setTransient({ ...figures, salt: undefined });
    await expect(cc.createPO(ctx, JSON.stringify(po))).to.be.rejectedWith(/salt is required/);
  });

  it('refuses commercial data passed as an argument instead of transient', async () => {
    const ctx = makeCtx({});
    await expect(cc.createPO(ctx, JSON.stringify({ ...po, ...figures })))
      .to.be.rejectedWith(/Transient 'payload' is required/);
  });

  it('refuses a submitter that is not a party to the deal', async () => {
    const ctx = makeCtx({}, { msp: 'LenderMSP', transient: figures });
    await expect(cc.createPO(ctx, JSON.stringify(po))).to.be.rejectedWith(/not a party/);
  });

  describe('reads', () => {
    it('gives a party the full record', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await create(ctx);
      ctx.clientIdentity.getMSPID.returns('BuyerMSP');
      const read = JSON.parse(await cc.getPurchaseOrder(ctx, po.po_id));
      expect(read.gross_value).to.equal(25000000);
      expect(read.status).to.equal('Issued');
    });

    // The headline property: a lender on the same channel, not party to this
    // deal, sees the order exists and nothing about what it is worth.
    it('gives a non-party the index only', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await create(ctx);
      ctx.clientIdentity.getMSPID.returns('LenderMSP');
      const read = JSON.parse(await cc.getPurchaseOrder(ctx, po.po_id));
      expect(read.po_id).to.equal(po.po_id);
      expect(read.status).to.equal('Issued');
      expect(read).to.not.have.property('gross_value');
      expect(read).to.not.have.property('price_per_unit');
      expect(read).to.not.have.property('item_description');
    });
  });

  it('keeps amended values private and publishes only a count', async () => {
    const state: Record<string, Buffer> = {};
    const ctx = makeCtx(state);
    await create(ctx);
    await cc.amendPO(ctx, po.po_id, JSON.stringify({ gross_value: 26000000 }), 'price revision');

    const publicJson = state['PO:TM-PO-2024-0892'].toString();
    expect(publicJson).to.not.contain('26000000');
    expect(JSON.parse(publicJson).amendment_count).to.equal(1);

    const stored = JSON.parse(ctx.__private['PO:TM-PO-2024-0892'].toString());
    expect(stored.gross_value).to.equal(26000000);
    expect(stored.amendments[0].justification).to.equal('price revision');
  });
});
