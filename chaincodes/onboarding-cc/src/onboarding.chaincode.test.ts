import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import { OnboardingChaincode } from './onboarding.chaincode';

chai.use(chaiAsPromised);
const { expect } = chai;

// Minimal Context + stub mock
function makeCtx(state: Record<string, Buffer> = {}) {
  const stub = {
    getState: sinon.stub().callsFake(async (key: string) => state[key] ?? Buffer.alloc(0)),
    putState: sinon.stub().callsFake(async (key: string, val: Buffer) => { state[key] = val; }),
    setEvent: sinon.stub(),
  };
  return { stub } as any;
}

// Valid Tata Motors fixture — reused everywhere a complete payload is needed
const validTata = {
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

describe('OnboardingChaincode', () => {

  describe('createOrganization', () => {
    it('creates an org with Pending status', async () => {
      const ctx = makeCtx();
      const result = await cc.createOrganization(ctx, JSON.stringify(validTata));
      const org = JSON.parse(result);
      expect(org.status).to.equal('Pending');
      expect(org.org_id).to.equal('tata-001');
      expect(org.msp_id).to.equal('BuyerMSP');
      expect(org.kyb_verified).to.equal(false);
    });

    it('rejects duplicate org_id', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'dup-001' }));
      await expect(
        cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'dup-001', legal_name: 'Y', org_type: 'Supplier' }))
      ).to.be.rejectedWith(/already exists/);
    });

    it('rejects missing org_id', async () => {
      const ctx = makeCtx();
      const { org_id, ...noId } = validTata;
      await expect(
        cc.createOrganization(ctx, JSON.stringify(noId))
      ).to.be.rejectedWith(/org_id is required/);
    });

    it('rejects missing msp_id', async () => {
      const ctx = makeCtx();
      const { msp_id, ...noMsp } = validTata;
      await expect(
        cc.createOrganization(ctx, JSON.stringify(noMsp))
      ).to.be.rejectedWith(/msp_id is required/);
    });

    it('rejects invalid GSTIN format', async () => {
      const ctx = makeCtx();
      await expect(
        cc.createOrganization(ctx, JSON.stringify({ ...validTata, gstin: 'NOT-A-REAL-GSTIN' }))
      ).to.be.rejectedWith(/Invalid GSTIN/);
    });

    it('rejects invalid PAN format', async () => {
      const ctx = makeCtx();
      await expect(
        cc.createOrganization(ctx, JSON.stringify({ ...validTata, pan: 'BADPAN' }))
      ).to.be.rejectedWith(/Invalid PAN/);
    });

    it('rejects invalid contact_email', async () => {
      const ctx = makeCtx();
      await expect(
        cc.createOrganization(ctx, JSON.stringify({ ...validTata, contact_email: 'not-an-email' }))
      ).to.be.rejectedWith(/Invalid contact_email/);
    });

    it('rejects invalid org_type', async () => {
      const ctx = makeCtx();
      await expect(
        cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_type: 'Hacker' }))
      ).to.be.rejectedWith(/Invalid org_type/);
    });

    it('allows two suppliers under the same SupplierMSP (Option A multi-supplier)', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      const bharat = { ...validTata, org_id: 'bharat-001', legal_name: 'Bharat Stampings', org_type: 'Supplier', msp_id: 'SupplierMSP', gstin: '27AABCB1234C1ZX', pan: 'AABCB1234C' };
      const mahForge = { ...validTata, org_id: 'mforge-001', legal_name: 'Maharashtra Forge', org_type: 'Supplier', msp_id: 'SupplierMSP', gstin: '27AABCM5678D1ZY', pan: 'AABCM5678D' };
      await cc.createOrganization(ctx, JSON.stringify(bharat));
      await cc.createOrganization(ctx, JSON.stringify(mahForge));
      const both = [JSON.parse(await cc.getOrganization(ctx, 'bharat-001')), JSON.parse(await cc.getOrganization(ctx, 'mforge-001'))];
      expect(both[0].msp_id).to.equal('SupplierMSP');
      expect(both[1].msp_id).to.equal('SupplierMSP');
    });
  });

  describe('updateOrganizationStatus', () => {
    it('transitions Pending → Approved and flips kyb_verified', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'org-1' }));
      const result = await cc.updateOrganizationStatus(ctx, 'org-1', 'Approved');
      const org = JSON.parse(result);
      expect(org.status).to.equal('Approved');
      expect(org.kyb_verified).to.equal(true);
    });

    it('rejects illegal transition Closed → Approved', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'org-2', org_type: 'Lender' }));
      await cc.updateOrganizationStatus(ctx, 'org-2', 'Closed');
      await expect(
        cc.updateOrganizationStatus(ctx, 'org-2', 'Approved')
      ).to.be.rejectedWith(/Illegal transition/);
    });
  });

  describe('assignRole', () => {
    it('adds role to approved org', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'org-3', org_type: 'Platform' }));
      await cc.updateOrganizationStatus(ctx, 'org-3', 'Approved');
      const result = await cc.assignRole(ctx, 'org-3', 'trade_admin');
      expect(JSON.parse(result).roles).to.include('trade_admin');
    });

    it('rejects role assignment on non-Approved org', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'org-4', org_type: 'Auditor' }));
      await expect(
        cc.assignRole(ctx, 'org-4', 'auditor')
      ).to.be.rejectedWith(/Cannot assign role/);
    });
  });

  describe('setRiskTier', () => {
    it('sets risk tier on Approved org', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'org-5' }));
      await cc.updateOrganizationStatus(ctx, 'org-5', 'Approved');
      const result = await cc.setRiskTier(ctx, 'org-5', 'Standard');
      expect(JSON.parse(result).risk_tier).to.equal('Standard');
    });

    it('rejects risk tier on Pending org', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'org-6' }));
      await expect(
        cc.setRiskTier(ctx, 'org-6', 'Prime')
      ).to.be.rejectedWith(/Cannot set risk tier/);
    });

    it('rejects invalid risk tier value', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ ...validTata, org_id: 'org-7' }));
      await cc.updateOrganizationStatus(ctx, 'org-7', 'Approved');
      await expect(
        cc.setRiskTier(ctx, 'org-7', 'Platinum')
      ).to.be.rejectedWith(/Invalid risk_tier/);
    });
  });
});
