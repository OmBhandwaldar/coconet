import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedRequest } from './helpers/authed-request.js';
import * as fabricService from '../fabric/fabric.service.js';

// ─── Maker-checker across the HTTP boundary (BR-09) ──────────────────────────
// The chaincode cannot throw when it parks a transition — a thrown error would
// roll back the approval record with everything else — so "waiting for a second
// signature" arrives as a SUCCESSFUL Fabric response with a different shape.
//
// That is the thing worth testing here: a client that reads only the HTTP status
// must not be told a transition happened when it has not. Hence 202.

const platform = authedRequest();
const buyerMaker = authedRequest('rajesh');
const lenderMaker = authedRequest('amit');

const PENDING = {
  pending_approval: {
    tx_type: 'INVOICE_APPROVE',
    entity_id: 'BS-INV-2024-0892',
    org_id: 'tata-001',
    status: 'PendingApproval',
    maker_id: 'x509::CN=User1@buyer.coconet.local',
    created_at: 't',
  },
};

const APPROVED_PO = { po_id: 'TM-PO-2024-0892', status: 'Issued', created_at: 't', updated_at: 't' };

afterEach(() => { vi.restoreAllMocks(); });

describe('a parked transition answers 202, not 200', () => {
  beforeEach(() => {
    vi.spyOn(fabricService, 'invoke').mockResolvedValue(PENDING);
    vi.spyOn(fabricService, 'invokeWithTransient').mockResolvedValue(PENDING);
    vi.spyOn(fabricService, 'query').mockResolvedValue({ msp_id: 'BuyerMSP' } as never);
  });

  it('on invoice approval', async () => {
    const res = await buyerMaker.put('/api/trade-docs/invoices/BS-INV-2024-0892/approve');
    expect(res.status).toBe(202);
    expect(res.body.pending_approval).toBe(true);
    expect(res.body.data.tx_type).toBe('INVOICE_APPROVE');
    // The entity must NOT be presented as if it had moved.
    expect(res.body.data.status).toBe('PendingApproval');
  });

  it('on PO issue', async () => {
    const res = await buyerMaker.put('/api/trade-docs/purchase-orders/TM-PO-2024-0892/issue');
    expect(res.status).toBe(202);
    expect(res.body.pending_approval).toBe(true);
  });

  it('on GRN acceptance', async () => {
    const res = await buyerMaker.put('/api/trade-docs/grn/TM-GRN-2024-0892/accept');
    expect(res.status).toBe(202);
  });

  it('on financing approval', async () => {
    const res = await lenderMaker
      .put('/api/finance/FR-DISC-001/approve')
      .send({ approved_amount: 24255000 });
    expect(res.status).toBe(202);
  });
});

describe('a completed transition answers 200', () => {
  beforeEach(() => {
    vi.spyOn(fabricService, 'invoke').mockResolvedValue(APPROVED_PO);
    vi.spyOn(fabricService, 'query').mockResolvedValue({ msp_id: 'BuyerMSP' } as never);
  });

  it('on PO issue below the threshold', async () => {
    const res = await buyerMaker.put('/api/trade-docs/purchase-orders/TM-PO-2024-0892/issue');
    expect(res.status).toBe(200);
    expect(res.body.pending_approval).toBe(undefined);
    expect(res.body.data.status).toBe('Issued');
  });
});

describe('the checker\'s call carries no figure', () => {
  // This asserts the WIRING only — that an empty body reaches the chaincode
  // with no transient payload. Whether an empty body is ACCEPTED is the
  // chaincode's rule and is tested there: a maker must state a figure, and
  // only a checker may omit one. Fabric is mocked here, so this test cannot
  // and does not speak to that.
  it('sends no transient payload when the body carries no amount', async () => {
    const invoke = vi.spyOn(fabricService, 'invoke').mockResolvedValue(APPROVED_PO);
    const withTransient = vi.spyOn(fabricService, 'invokeWithTransient').mockResolvedValue(APPROVED_PO);

    const res = await lenderMaker.put('/api/finance/FR-DISC-001/approve').send({});
    expect(res.status).toBe(200);
    // No transient payload: the amount under approval comes from the record,
    // which is what stops a checker committing a different number.
    expect(withTransient).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(expect.anything(), 'approveFinancing', 'FR-DISC-001');
  });
});

describe('GET /api/approvals/pending', () => {
  it('merges the queues of both ledgers, oldest first', async () => {
    vi.spyOn(fabricService, 'query').mockImplementation(async (cc: string) =>
      (cc === 'finance-cc'
        ? [{ tx_type: 'FINANCE_APPROVE', entity_id: 'FR-1', created_at: '2024-01-02' }]
        : [{ tx_type: 'INVOICE_APPROVE', entity_id: 'INV-1', created_at: '2024-01-01' }]) as never,
    );

    const res = await platform.get('/api/approvals/pending');
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: { entity_id: string }) => a.entity_id)).toEqual(['INV-1', 'FR-1']);
  });

  it('passes an org filter through', async () => {
    const query = vi.spyOn(fabricService, 'query').mockResolvedValue([] as never);
    await platform.get('/api/approvals/pending?org_id=tata-001');
    expect(query).toHaveBeenCalledWith(expect.anything(), 'listPendingApprovals', 'tata-001');
  });
});

describe('POST /api/approvals/:txType/:entityId/reject', () => {
  it('routes a finance refusal to finance-cc', async () => {
    const invoke = vi.spyOn(fabricService, 'invoke').mockResolvedValue({ status: 'Rejected' });
    const res = await platform
      .post('/api/approvals/FINANCE_APPROVE/FR-DISC-001/reject')
      .send({ reason: 'Buyer concentration limit reached' });

    expect(res.status).toBe(200);
    expect(invoke).toHaveBeenCalledWith(
      'finance-cc', 'rejectApproval', 'FINANCE_APPROVE', 'FR-DISC-001',
      'Buyer concentration limit reached',
    );
  });

  it('routes a trade refusal to trade-doc-cc', async () => {
    const invoke = vi.spyOn(fabricService, 'invoke').mockResolvedValue({ status: 'Rejected' });
    await platform
      .post('/api/approvals/INVOICE_APPROVE/BS-INV-2024-0892/reject')
      .send({ reason: 'quantity short' });
    expect(invoke).toHaveBeenCalledWith(
      'trade-doc-cc', 'rejectApproval', 'INVOICE_APPROVE', 'BS-INV-2024-0892', 'quantity short',
    );
  });

  it('refuses a rejection with no reason — NFR-05 needs one', async () => {
    const res = await platform
      .post('/api/approvals/INVOICE_APPROVE/BS-INV-2024-0892/reject')
      .send({});
    expect(res.status).toBe(400);
  });

  it('refuses an unknown transaction type', async () => {
    const res = await platform
      .post('/api/approvals/DELETE_EVERYTHING/x/reject')
      .send({ reason: 'why not' });
    expect(res.status).toBe(400);
  });
});
