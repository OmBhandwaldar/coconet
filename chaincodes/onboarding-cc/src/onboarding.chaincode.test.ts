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

const cc = new OnboardingChaincode();

describe('OnboardingChaincode', () => {

  describe('createOrganization', () => {
    it('creates an org with Pending status', async () => {
      const ctx = makeCtx();
      const result = await cc.createOrganization(ctx, JSON.stringify({
        org_id: 'tata-001',
        legal_name: 'Tata Motors Ltd',
        org_type: 'Buyer',
      }));
      const org = JSON.parse(result);
      expect(org.status).to.equal('Pending');
      expect(org.org_id).to.equal('tata-001');
    });

    it('rejects duplicate org_id', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ org_id: 'dup-001', legal_name: 'X', org_type: 'Buyer' }));
      await expect(
        cc.createOrganization(ctx, JSON.stringify({ org_id: 'dup-001', legal_name: 'Y', org_type: 'Supplier' }))
      ).to.be.rejectedWith(/already exists/);
    });

    it('rejects missing org_id', async () => {
      const ctx = makeCtx();
      await expect(
        cc.createOrganization(ctx, JSON.stringify({ legal_name: 'X', org_type: 'Buyer' }))
      ).to.be.rejectedWith(/org_id is required/);
    });
  });

  describe('updateOrganizationStatus', () => {
    it('transitions Pending → Approved', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ org_id: 'org-1', legal_name: 'Org 1', org_type: 'Supplier' }));
      const result = await cc.updateOrganizationStatus(ctx, 'org-1', 'Approved');
      expect(JSON.parse(result).status).to.equal('Approved');
    });

    it('rejects illegal transition Closed → Approved', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ org_id: 'org-2', legal_name: 'Org 2', org_type: 'Lender' }));
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
      await cc.createOrganization(ctx, JSON.stringify({ org_id: 'org-3', legal_name: 'Org 3', org_type: 'Platform' }));
      await cc.updateOrganizationStatus(ctx, 'org-3', 'Approved');
      const result = await cc.assignRole(ctx, 'org-3', 'trade_admin');
      expect(JSON.parse(result).roles).to.include('trade_admin');
    });

    it('rejects role assignment on non-Approved org', async () => {
      const state: Record<string, Buffer> = {};
      const ctx = makeCtx(state);
      await cc.createOrganization(ctx, JSON.stringify({ org_id: 'org-4', legal_name: 'Org 4', org_type: 'Auditor' }));
      await expect(
        cc.assignRole(ctx, 'org-4', 'auditor')
      ).to.be.rejectedWith(/Cannot assign role/);
    });
  });
});
