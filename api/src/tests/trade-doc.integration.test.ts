import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import supertest from 'supertest';
import app from '../app.js';
import * as fabricService from '../fabric/fabric.service.js';

const request = supertest(app);

const validPO = {
  po_id: 'TM-PO-2024-0892',
  buyer_id: 'tata-001',
  supplier_id: 'bharat-001',
  currency: 'INR',
  gross_value: 25000000,
  item_description: 'Pressed Steel Body Panels',
  quantity: 10000,
  price_per_unit: 2500,
  delivery_terms: '45 days, Pune Plant',
  payment_terms: '30 days after delivery',
  doc_hash: 'po-hash-0892',
};

const validInvoice = {
  invoice_id: 'BS-INV-2024-0892',
  supplier_id: 'bharat-001',
  buyer_id: 'tata-001',
  po_id: 'TM-PO-2024-0892',
  grn_id: 'TM-GRN-2024-0892',
  amount: 25000000,
  quantity: 10000,
  currency: 'INR',
  due_date: '2024-12-31',
  doc_hash: 'inv-hash-0892',
};

const fakePO = { ...validPO, status: 'Issued', amendments: [], created_at: 't', updated_at: 't' };
const fakeInvoice = {
  ...validInvoice,
  status: 'Matched',
  match_result: { passed: true, checks: {}, reasons: [], matched_at: 't' },
  created_at: 't',
  updated_at: 't',
};

beforeEach(() => {
  vi.spyOn(fabricService, 'invoke').mockResolvedValue(fakePO);
  vi.spyOn(fabricService, 'query').mockResolvedValue(fakePO);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('POST /api/trade-docs/purchase-orders', () => {
  it('creates a PO with 201 + correlationId', async () => {
    const res = await request.post('/api/trade-docs/purchase-orders').send(validPO);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.po_id).toBe('TM-PO-2024-0892');
    expect(res.body.correlationId).toBeTruthy();
    expect(fabricService.invoke).toHaveBeenCalledWith('trade-doc-cc', 'createPO', JSON.stringify(validPO));
  });

  it('rejects a non-positive gross_value with 400', async () => {
    const res = await request.post('/api/trade-docs/purchase-orders').send({ ...validPO, gross_value: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fabricService.invoke).not.toHaveBeenCalled();
  });

  it('rejects a missing supplier_id with 400', async () => {
    const { supplier_id, ...noSupplier } = validPO;
    const res = await request.post('/api/trade-docs/purchase-orders').send(noSupplier);
    expect(res.status).toBe(400);
    expect(fabricService.invoke).not.toHaveBeenCalled();
  });
});

describe('PO lifecycle routes', () => {
  it('acknowledges a PO via the supplier id', async () => {
    const res = await request
      .put('/api/trade-docs/purchase-orders/TM-PO-2024-0892/acknowledge')
      .send({ supplier_id: 'bharat-001' });
    expect(res.status).toBe(200);
    expect(fabricService.invoke).toHaveBeenCalledWith('trade-doc-cc', 'acknowledgePO', 'TM-PO-2024-0892', 'bharat-001');
  });

  it('reads a PO by id', async () => {
    const res = await request.get('/api/trade-docs/purchase-orders/TM-PO-2024-0892');
    expect(res.status).toBe(200);
    expect(fabricService.query).toHaveBeenCalledWith('trade-doc-cc', 'getPurchaseOrder', 'TM-PO-2024-0892');
  });
});

describe('GRN routes', () => {
  it('creates a GRN with 201', async () => {
    const res = await request
      .post('/api/trade-docs/grn')
      .send({ grn_id: 'TM-GRN-2024-0892', po_id: 'TM-PO-2024-0892', received_qty: 10000 });
    expect(res.status).toBe(201);
    expect(fabricService.invoke).toHaveBeenCalledWith('trade-doc-cc', 'createGRN', 'TM-GRN-2024-0892', 'TM-PO-2024-0892', '10000');
  });

  it('accepts a GRN', async () => {
    const res = await request.put('/api/trade-docs/grn/TM-GRN-2024-0892/accept');
    expect(res.status).toBe(200);
    expect(fabricService.invoke).toHaveBeenCalledWith('trade-doc-cc', 'acceptGRN', 'TM-GRN-2024-0892');
  });
});

describe('Invoice routes', () => {
  it('submits an invoice with 201', async () => {
    vi.spyOn(fabricService, 'invoke').mockResolvedValue(fakeInvoice);
    const res = await request.post('/api/trade-docs/invoices').send(validInvoice);
    expect(res.status).toBe(201);
    expect(fabricService.invoke).toHaveBeenCalledWith('trade-doc-cc', 'submitInvoice', JSON.stringify(validInvoice));
  });

  it('rejects an invoice missing doc_hash with 400', async () => {
    const { doc_hash, ...noHash } = validInvoice;
    const res = await request.post('/api/trade-docs/invoices').send(noHash);
    expect(res.status).toBe(400);
    expect(fabricService.invoke).not.toHaveBeenCalled();
  });

  it('runs the 3-way match', async () => {
    vi.spyOn(fabricService, 'invoke').mockResolvedValue(fakeInvoice);
    const res = await request.put('/api/trade-docs/invoices/BS-INV-2024-0892/match');
    expect(res.status).toBe(200);
    expect(res.body.data.match_result.passed).toBe(true);
    expect(fabricService.invoke).toHaveBeenCalledWith('trade-doc-cc', 'runThreeWayMatch', 'BS-INV-2024-0892');
  });

  it('returns the match result on its own endpoint', async () => {
    vi.spyOn(fabricService, 'query').mockResolvedValue(fakeInvoice);
    const res = await request.get('/api/trade-docs/invoices/BS-INV-2024-0892/match-result');
    expect(res.status).toBe(200);
    expect(res.body.data.passed).toBe(true);
  });

  it('approves an invoice', async () => {
    vi.spyOn(fabricService, 'invoke').mockResolvedValue({ ...fakeInvoice, status: 'Approved' });
    const res = await request.put('/api/trade-docs/invoices/BS-INV-2024-0892/approve');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Approved');
    expect(fabricService.invoke).toHaveBeenCalledWith('trade-doc-cc', 'approveInvoice', 'BS-INV-2024-0892');
  });
});
