import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import app from '../app.js';
import * as fabricService from '../fabric/fabric.service.js';
import { FabricError } from '../errors/AppError.js';

const request = supertest(app);

const validBody = {
  org_id: 'tata-001',
  legal_name: 'Tata Motors Ltd',
  org_type: 'Buyer',
  msp_id: 'BuyerMSP',
  registration_number: 'L28920MH1945PLC004520',
  gstin: '27AAACT2727Q1ZW',
  pan: 'AAACT2727Q',
  country: 'IN',
  contact_email: 'procurement@tatamotors.com',
  registered_address: 'Bombay House, Mumbai 400001',
};

const fakeOrg = { ...validBody, status: 'Pending', roles: [], kyb_verified: false, created_at: 't', updated_at: 't' };

beforeEach(() => {
  vi.spyOn(fabricService, 'invoke').mockResolvedValue(fakeOrg);
  vi.spyOn(fabricService, 'query').mockResolvedValue(fakeOrg);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('POST /api/onboarding/organizations', () => {
  it('creates org with 201 + correlationId', async () => {
    const res = await request.post('/api/onboarding/organizations').send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.org_id).toBe('tata-001');
    expect(res.body.correlationId).toBeTruthy();
    expect(fabricService.invoke).toHaveBeenCalledWith('onboarding-cc', 'createOrganization', JSON.stringify(validBody));
  });

  it('rejects invalid GSTIN with 400', async () => {
    const res = await request.post('/api/onboarding/organizations').send({ ...validBody, gstin: 'BAD' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(/gstin/i);
    expect(fabricService.invoke).not.toHaveBeenCalled();
  });

  it('rejects unknown org_type with 400', async () => {
    const res = await request.post('/api/onboarding/organizations').send({ ...validBody, org_type: 'Hacker' });
    expect(res.status).toBe(400);
  });

  it('surfaces FabricError as 502', async () => {
    vi.spyOn(fabricService, 'invoke').mockRejectedValue(
      new FabricError('onboarding-cc', 'createOrganization', 'Organization tata-001 already exists'),
    );
    const res = await request.post('/api/onboarding/organizations').send(validBody);
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('FABRIC_ERROR');
  });
});

describe('GET /api/onboarding/organizations/:id', () => {
  it('returns org by id', async () => {
    const res = await request.get('/api/onboarding/organizations/tata-001');
    expect(res.status).toBe(200);
    expect(res.body.data.org_id).toBe('tata-001');
    expect(fabricService.query).toHaveBeenCalledWith('onboarding-cc', 'getOrganization', 'tata-001');
  });
});

describe('PUT /api/onboarding/organizations/:id/status', () => {
  it('updates status', async () => {
    const res = await request.put('/api/onboarding/organizations/tata-001/status').send({ status: 'Approved' });
    expect(res.status).toBe(200);
    expect(fabricService.invoke).toHaveBeenCalledWith('onboarding-cc', 'updateOrganizationStatus', 'tata-001', 'Approved');
  });

  it('rejects invalid status', async () => {
    const res = await request.put('/api/onboarding/organizations/tata-001/status').send({ status: 'Pancakes' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/onboarding/organizations/:id/roles', () => {
  it('assigns role', async () => {
    const res = await request.post('/api/onboarding/organizations/tata-001/roles').send({ role: 'trade_admin' });
    expect(res.status).toBe(200);
    expect(fabricService.invoke).toHaveBeenCalledWith('onboarding-cc', 'assignRole', 'tata-001', 'trade_admin');
  });
});

describe('POST /api/onboarding/organizations/:id/risk-tier', () => {
  it('sets risk tier', async () => {
    const res = await request.post('/api/onboarding/organizations/tata-001/risk-tier').send({ risk_tier: 'Standard' });
    expect(res.status).toBe(200);
    expect(fabricService.invoke).toHaveBeenCalledWith('onboarding-cc', 'setRiskTier', 'tata-001', 'Standard');
  });

  it('rejects invalid tier', async () => {
    const res = await request.post('/api/onboarding/organizations/tata-001/risk-tier').send({ risk_tier: 'Platinum' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/onboarding/organizations/:id/maker-checker-thresholds/:txType', () => {
  it('sets threshold and stringifies amount for chaincode', async () => {
    const res = await request
      .put('/api/onboarding/organizations/tata-001/maker-checker-thresholds/Invoice')
      .send({ threshold: 5000000 });
    expect(res.status).toBe(200);
    expect(fabricService.invoke).toHaveBeenCalledWith(
      'onboarding-cc',
      'setMakerCheckerThreshold',
      'tata-001',
      'Invoice',
      '5000000',
    );
  });

  it('rejects negative threshold with 400', async () => {
    const res = await request
      .put('/api/onboarding/organizations/tata-001/maker-checker-thresholds/Invoice')
      .send({ threshold: -1 });
    expect(res.status).toBe(400);
  });

  it('rejects non-numeric threshold with 400', async () => {
    const res = await request
      .put('/api/onboarding/organizations/tata-001/maker-checker-thresholds/Invoice')
      .send({ threshold: 'lots' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/onboarding/organizations/:id/maker-checker-thresholds/:txType', () => {
  it('returns threshold for tx type', async () => {
    vi.spyOn(fabricService, 'query').mockResolvedValue({ org_id: 'tata-001', tx_type: 'Invoice', threshold: 5000000 });
    const res = await request.get('/api/onboarding/organizations/tata-001/maker-checker-thresholds/Invoice');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ org_id: 'tata-001', tx_type: 'Invoice', threshold: 5000000 });
    expect(fabricService.query).toHaveBeenCalledWith('onboarding-cc', 'getMakerCheckerThreshold', 'tata-001', 'Invoice');
  });
});
