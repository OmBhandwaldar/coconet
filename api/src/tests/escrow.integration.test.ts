import { describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';

// Mock the on-chain client so routes can be exercised without a live Polygon node.
const tx = { wait: async () => ({}) };
const escrowStruct = {
  buyer: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  beneficiary: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  token: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  amount: 269022_000000n,
  linkedAssetId: 'BS-INV-ESCROW-02',
  expiryAt: 0n,
  funded: false,
  invoiceApproved: false,
  status: 1n, // Created
};
vi.mock('../polygon/escrow.client.js', () => ({
  factoryContract: () => ({
    createEscrowInstruction: async () => tx,
    getEscrowInstruction: async () => ({ amount: 269022_000000n }),
  }),
  vaultContract: () => ({
    getEscrow: async () => escrowStruct,
    fundEscrow: async () => tx,
    refund: async () => tx,
  }),
  usdcContract: () => ({
    approve: async () => tx,
    balanceOf: async () => 269022_000000n,
  }),
}));

const { default: app } = await import('../app.js');
const request = supertest(app);

const validCreate = {
  escrow_payment_id: 'ESC-TEST-01',
  buyer_org_id: 'tata-001',
  beneficiary_org_id: 'hdfc-001',
  linked_invoice_id: 'BS-INV-ESCROW-02',
  amount_usd: 269022,
};

describe('POST /api/escrow/instructions', () => {
  it('creates an escrow instruction (201) mapping orgs to EVM addresses', async () => {
    const res = await request.post('/api/escrow/instructions').send(validCreate);
    expect(res.status).toBe(201);
    expect(res.body.data.escrow_payment_id).toBe('ESC-TEST-01');
    expect(res.body.data.amount_usd).toBe(269022);
    expect(res.body.data.beneficiary).toBe('0x90F79bf6EB2c4f870365E785982E1f101E93b906');
    expect(res.body.correlationId).toBeTruthy();
  });

  it('rejects a missing amount_usd with 400', async () => {
    const { amount_usd, ...bad } = validCreate;
    const res = await request.post('/api/escrow/instructions').send(bad);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown org with 500 (no EVM mapping)', async () => {
    const res = await request.post('/api/escrow/instructions').send({ ...validCreate, buyer_org_id: 'ghost-999' });
    expect(res.status).toBe(500);
  });
});

describe('escrow lifecycle routes', () => {
  it('GET instruction returns the escrow view', async () => {
    const res = await request.get('/api/escrow/instructions/ESC-TEST-01');
    expect(res.status).toBe(200);
    expect(res.body.data.amount_usd).toBe(269022);
    expect(res.body.data.status).toBe('Created');
  });

  it('POST fund returns 200', async () => {
    const res = await request.post('/api/escrow/instructions/ESC-TEST-01/fund');
    expect(res.status).toBe(200);
  });

  it('POST refund returns 200 (Rule-0C)', async () => {
    const res = await request.post('/api/escrow/instructions/ESC-TEST-01/refund');
    expect(res.status).toBe(200);
  });

  it('GET status returns the condition flags', async () => {
    const res = await request.get('/api/escrow/instructions/ESC-TEST-01/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('funded');
    expect(res.body.data).toHaveProperty('invoice_approved');
  });
});
