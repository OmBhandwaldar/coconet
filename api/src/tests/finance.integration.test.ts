import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedRequest } from './helpers/authed-request.js';
import app from '../app.js';
import * as fabricService from '../fabric/fabric.service.js';
import { computeNetSettlement } from '../services/finance.service.js';

const request = authedRequest();

const preFR = {
  request_id: 'FR-PRE-001', product_type: 'PreShipment', asset_type: 'PO', asset_id: 'TM-PO-2024-0892',
  requestor_org_id: 'bharat-001', lender_id: 'hdfc-001', requested_amount: 12000000,
  disbursed_amount: 12000000, interest_rate: 0.12, tenor_days: 45,
  security_interest_state: 'Perfected', status: 'Disbursed', created_at: 't', updated_at: 't',
};
const discFR = {
  request_id: 'FR-DISC-001', product_type: 'InvoiceDiscounting', asset_type: 'Invoice', asset_id: 'BS-INV-2024-1102',
  requestor_org_id: 'bharat-001', lender_id: 'hdfc-001', requested_amount: 24255000, discount_rate: 0.02,
  security_interest_state: 'Perfected', status: 'Disbursed', net_disbursed: 12077466,
  created_at: 't', updated_at: 't',
};
const invoice1102 = { invoice_id: 'BS-INV-2024-1102', amount: 24750000, status: 'Approved' };

beforeEach(() => {
  vi.spyOn(fabricService, 'invoke').mockResolvedValue(preFR);
  vi.spyOn(fabricService, 'invokeWithTransient').mockResolvedValue(preFR);
  vi.spyOn(fabricService, 'query').mockImplementation(async (_cc: string, fn: string) =>
    (fn === 'getOrganization' ? { msp_id: 'LenderMSP' } : preFR) as never,
  );
});
afterEach(() => { vi.restoreAllMocks(); });

describe('POST /api/finance/pre-shipment', () => {
  it('creates a pre-shipment request mapped to a PO asset', async () => {
    const res = await request.post('/api/finance/pre-shipment').send({
      request_id: 'FR-PRE-001', po_id: 'TM-PO-2024-0892', requestor_org_id: 'bharat-001',
      requested_amount: 12000000, lender_id: 'hdfc-001',
    });
    expect(res.status).toBe(201);
    const [, , args, transient] = (fabricService.invokeWithTransient as any).mock.calls[0];
    const index = JSON.parse(args[0]);
    expect(index.product_type).toBe('PreShipment');
    expect(index.asset_type).toBe('PO');
    expect(index.asset_id).toBe('TM-PO-2024-0892');
    // The amount is the thing a competing lender must not learn.
    expect(index).not.toHaveProperty('requested_amount');
    expect(transient.requested_amount).toBe(12000000);
    expect(transient.salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('rejects a missing po_id with 400', async () => {
    const res = await request.post('/api/finance/pre-shipment').send({
      request_id: 'X', requestor_org_id: 'bharat-001', requested_amount: 1,
    });
    expect(res.status).toBe(400);
    expect(fabricService.invoke).not.toHaveBeenCalled();
  });
});

describe('POST /api/finance/invoice-discounting', () => {
  it('creates a discounting request mapped to an Invoice asset', async () => {
    const res = await request.post('/api/finance/invoice-discounting').send({
      request_id: 'FR-DISC-001', invoice_id: 'BS-INV-2024-1102', requestor_org_id: 'bharat-001',
      requested_amount: 24255000, lender_id: 'hdfc-001', discount_rate: 0.02,
    });
    expect(res.status).toBe(201);
    const [, , args, transient] = (fabricService.invokeWithTransient as any).mock.calls[0];
    const index = JSON.parse(args[0]);
    expect(index.product_type).toBe('InvoiceDiscounting');
    expect(index.asset_type).toBe('Invoice');
    // The discount rate IS the lender's pricing — it must not reach the channel.
    expect(index).not.toHaveProperty('discount_rate');
    expect(transient.discount_rate).toBe(0.02);
  });

  it('rejects a discount_rate above 1 with 400', async () => {
    const res = await request.post('/api/finance/invoice-discounting').send({
      request_id: 'X', invoice_id: 'I', requestor_org_id: 'bharat-001', requested_amount: 1,
      lender_id: 'hdfc-001', discount_rate: 1.5,
    });
    expect(res.status).toBe(400);
  });
});

describe('finance lifecycle routes', () => {
  it('validates eligibility', async () => {
    const res = await request.put('/api/finance/FR-PRE-001/validate-eligibility');
    expect(res.status).toBe(200);
    expect(fabricService.invoke).toHaveBeenCalledWith('finance-cc', 'validateEligibility', 'FR-PRE-001');
  });

  it('accepts an offer', async () => {
    const res = await request.put('/api/finance/FR-PRE-001/accept');
    expect(res.status).toBe(200);
    expect(fabricService.invoke).toHaveBeenCalledWith('finance-cc', 'acceptOffer', 'FR-PRE-001');
  });

  it('disburses (plain, no net settlement) passing empty net arg', async () => {
    const res = await request.put('/api/finance/FR-PRE-001/disburse').send({ disbursement_ref: 'NEFT-1' });
    expect(res.status).toBe(200);
    const [, fn, args, transient] = (fabricService.invokeWithTransient as any).mock.calls.at(-1);
    expect(fn).toBe('disburseFunds');
    expect(args).toEqual(['FR-PRE-001', 'NEFT-1']);
    expect(transient).toEqual({});
  });
});

describe('net settlement', () => {
  it('computeNetSettlement matches the worked example to the rupee', () => {
    const s = computeNetSettlement(24750000, 0.02, 12000000, 0.12, 45);
    expect(s.gross_disbursement).toBe(24255000);
    expect(s.accrued_interest).toBe(177534);
    expect(s.settled_amount).toBe(12177534);
    expect(s.net_to_supplier).toBe(12077466);
  });

  it('disburse with pre_shipment_request_id returns the settlement breakdown', async () => {
    vi.spyOn(fabricService, 'query').mockImplementation(async (_cc: string, fn: string, ...args: string[]) => {
      if (fn === 'getFinanceRequest') return (args[0] === 'FR-DISC-001' ? discFR : preFR) as any;
      if (fn === 'getInvoice') return invoice1102 as any;
      return {} as any;
    });
    vi.spyOn(fabricService, 'invoke').mockResolvedValue(discFR);
    vi.spyOn(fabricService, 'invokeWithTransient').mockResolvedValue(discFR);

    const res = await request.put('/api/finance/FR-DISC-001/disburse')
      .send({ disbursement_ref: 'NEFT-DISC-001', pre_shipment_request_id: 'FR-PRE-001' });
    expect(res.status).toBe(200);
    expect(res.body.data.settlement.net_to_supplier).toBe(12077466);
    expect(res.body.data.pre_shipment_request_id).toBe('FR-PRE-001');
    // pre-shipment loan auto-settled via recordRepayment
    // The repayment figure travels as transient; the payment reference does not.
    const repay = (fabricService.invokeWithTransient as any).mock.calls
      .find((c: any[]) => c[1] === 'recordRepayment');
    expect(repay[2]).toEqual(['FR-PRE-001', 'NET-SETTLE:FR-DISC-001']);
    expect(repay[3]).toEqual({ repayment_amount: 12177534 });
  });
});
