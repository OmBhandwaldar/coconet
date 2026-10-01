import * as chai from 'chai';
import sinon from 'sinon';
import { OnboardingChaincode } from './onboarding.chaincode';

const { expect } = chai;

// ─── Event payload contract (PRIVACY-DESIGN.md §3.2) ──────────────────────────
// Organisation records are legitimately network-wide, so most of this chaincode's
// events are fine as-is. Two are not: an approval threshold is a money amount, and
// a risk tier is the platform's credit judgement of a member — neither belongs in
// an immutable, channel-wide event. Whitelist, not blacklist.
const ALLOWED_KEYS = new Set([
  'org_id',     // entity identifier
  'org_type',   // Buyer / Supplier / Lender — structural
  'msp_id',     // MSP identifier
  'status',     // state-machine position
  'role',       // assigned role name
  'tx_type',    // WHICH transaction type has a threshold, never its value
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

function makeCtx(state: Record<string, Buffer> = {}) {
  const priv: Record<string, Buffer> = {};
  const stub = {
    getPrivateData: sinon.stub().callsFake(async (_c: string, k: string) => priv[k] ?? Buffer.alloc(0)),
    putPrivateData: sinon.stub().callsFake(async (_c: string, k: string, v: Buffer) => { priv[k] = v; }),
    getTxID: sinon.stub().returns('tx-deterministic-salt'),
    getState: sinon.stub().callsFake(async (key: string) => state[key] ?? Buffer.alloc(0)),
    putState: sinon.stub().callsFake(async (key: string, val: Buffer) => { state[key] = val; }),
    setEvent: sinon.stub(),
    getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
  };
  return { stub, clientIdentity: { getMSPID: sinon.stub().returns('PlatformMSP') }, __private: priv } as any;
}

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

const tata = {
  org_id: 'tata-001',
  legal_name: 'Tata Motors Ltd',
  org_type: 'Buyer',
  msp_id: 'BuyerMSP',
  registration_number: 'L28920MH1945PLC004520',
  gstin: '27AAACT2727Q1ZW',
  pan: 'AAACT2727Q',
  country: 'IN',
  contact_email: 'procurement@tatamotors.com',
  registered_address: 'Bombay House, 24 Homi Mody Street, Mumbai 400001',
};

const cc = new OnboardingChaincode();

describe('onboarding-cc event payload contract', () => {

  it('emits no commercial data across the organisation lifecycle', async () => {
    const ctx = makeCtx({});
    await cc.createOrganization(ctx, JSON.stringify(tata));
    await cc.updateOrganizationStatus(ctx, tata.org_id, 'Approved');
    await cc.assignRole(ctx, tata.org_id, 'Buyer');
    await cc.setRiskTier(ctx, tata.org_id, 'Prime');
    await cc.setMakerCheckerThreshold(ctx, tata.org_id, 'PurchaseOrder', '10000000');
    assertNoCommercialData(emitted(ctx));
  });

  // The threshold is the rupee value above which an org needs a second signature.
  // Published channel-wide it tells every counterparty exactly how large a
  // transaction that org will wave through on one approval.
  it('does not publish the maker-checker threshold value', async () => {
    const ctx = makeCtx({});
    await cc.createOrganization(ctx, JSON.stringify(tata));
    await cc.updateOrganizationStatus(ctx, tata.org_id, 'Approved');
    await cc.setMakerCheckerThreshold(ctx, tata.org_id, 'PurchaseOrder', '10000000');

    const ev = emitted(ctx).find((e) => e.name === 'MakerCheckerThresholdSet');
    expect(ev, 'MakerCheckerThresholdSet must be emitted').to.not.equal(undefined);
    expect(JSON.stringify(ev!.payload)).to.not.contain('10000000');
  });

  // The tier is the platform's credit judgement of a member. Broadcasting it
  // tells that member's competitors how the platform rates it.
  it('does not publish the risk tier value', async () => {
    const ctx = makeCtx({});
    await cc.createOrganization(ctx, JSON.stringify(tata));
    await cc.updateOrganizationStatus(ctx, tata.org_id, 'Approved');
    await cc.setRiskTier(ctx, tata.org_id, 'High-touch');

    const ev = emitted(ctx).find((e) => e.name === 'RiskTierAssigned');
    expect(ev, 'RiskTierAssigned must be emitted').to.not.equal(undefined);
    expect(Object.keys(ev!.payload)).to.not.contain('risk_tier');
  });
});

// ─── Organisation private data (PRIVACY-DESIGN.md §2.1) ──────────────────────
// Block 1 took the risk tier and the maker-checker threshold out of events.
// Leaving them in channel public state would have moved the leak rather than
// closed it, because any member's peer reads public state directly — redacting
// them in the API is not a boundary.
describe('onboarding-cc organisation private data', () => {
  it('keeps the risk tier and thresholds out of channel public state', async () => {
    const state: Record<string, Buffer> = {};
    const ctx = makeCtx(state);
    await cc.createOrganization(ctx, JSON.stringify(tata));
    await cc.updateOrganizationStatus(ctx, tata.org_id, 'Approved');
    await cc.setRiskTier(ctx, tata.org_id, 'High-touch');
    await cc.setMakerCheckerThreshold(ctx, tata.org_id, 'PurchaseOrder', '10000000');

    const publicJson = state[`ORG:${tata.org_id}`].toString();
    expect(publicJson, 'public state leaks the risk tier').to.not.contain('High-touch');
    expect(publicJson, 'public state leaks the threshold').to.not.contain('10000000');
    // ...while the facts the network legitimately shares remain.
    const org = JSON.parse(publicJson);
    expect(org.org_id).to.equal(tata.org_id);
    expect(org.org_type).to.equal('Buyer');
    expect(org.status).to.equal('Approved');
  });

  it('hides them from another organisation', async () => {
    const state: Record<string, Buffer> = {};
    const ctx = makeCtx(state);
    await cc.createOrganization(ctx, JSON.stringify(tata));
    await cc.updateOrganizationStatus(ctx, tata.org_id, 'Approved');
    await cc.setRiskTier(ctx, tata.org_id, 'High-touch');

    ctx.clientIdentity.getMSPID.returns('SupplierMSP');
    const seen = JSON.parse(await cc.getOrganization(ctx, tata.org_id));
    expect(seen.org_id).to.equal(tata.org_id);
    expect(seen).to.not.have.property('risk_tier');
    expect(seen).to.not.have.property('maker_checker_thresholds');
  });

  it('shows them to the organisation itself', async () => {
    const state: Record<string, Buffer> = {};
    const ctx = makeCtx(state);
    await cc.createOrganization(ctx, JSON.stringify(tata));
    await cc.updateOrganizationStatus(ctx, tata.org_id, 'Approved');
    await cc.setRiskTier(ctx, tata.org_id, 'High-touch');

    ctx.clientIdentity.getMSPID.returns('BuyerMSP'); // tata's own MSP
    const seen = JSON.parse(await cc.getOrganization(ctx, tata.org_id));
    expect(seen.risk_tier).to.equal('High-touch');
  });

  it('refuses another organisation reading a threshold', async () => {
    const state: Record<string, Buffer> = {};
    const ctx = makeCtx(state);
    await cc.createOrganization(ctx, JSON.stringify(tata));
    await cc.updateOrganizationStatus(ctx, tata.org_id, 'Approved');
    await cc.setMakerCheckerThreshold(ctx, tata.org_id, 'PurchaseOrder', '10000000');

    ctx.clientIdentity.getMSPID.returns('LenderMSP');
    let threw = false;
    try { await cc.getMakerCheckerThreshold(ctx, tata.org_id, 'PurchaseOrder'); }
    catch (e) { threw = true; expect((e as Error).message).to.match(/may not read/); }
    expect(threw, 'a competitor must not read approval limits').to.equal(true);
  });
});
