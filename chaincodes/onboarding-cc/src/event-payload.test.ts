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
  const stub = {
    getState: sinon.stub().callsFake(async (key: string) => state[key] ?? Buffer.alloc(0)),
    putState: sinon.stub().callsFake(async (key: string, val: Buffer) => { state[key] = val; }),
    setEvent: sinon.stub(),
    getTxTimestamp: sinon.stub().returns({ seconds: { low: 1735689600 }, nanos: 0 }),
  };
  return { stub } as any;
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
