import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedRequest } from './helpers/authed-request.js';
import { MemoryBridgeStore } from '../bridge/memory-store.js';
import { setBridgeRuntime } from '../bridge/runtime.js';
import * as fabricService from '../fabric/fabric.service.js';

// Reconciliation walks the factory's escrow log, so the chain clients are stubbed
// to a known, agreeing pair rather than requiring a live Polygon node.
const escrows: { args: { escrowPaymentId: string; linkedAssetId: string } }[] = [];
const vaultState = { funded: true, invoiceApproved: true, status: 3n };
vi.mock('../polygon/escrow.client.js', () => ({
  factoryContract: () => ({ queryFilter: async () => escrows, on: vi.fn() }),
  vaultContract: () => ({ getEscrow: async () => vaultState, on: vi.fn() }),
  usdcContract: () => ({}),
}));

// ─── The operator's view of bridge state (NEW-PLAN Block 6) ───────────────────
// A dead letter nobody can see is the same as a dropped event, which is what the
// bridge did before this block. These assert the durable state is reachable, and
// that it is reachable only by the platform: the dead-letter queue names escrow
// ids and failure reasons across every deal, so a counterparty reading it would
// see traffic that is not theirs.

const platform = authedRequest('platform');
const buyer = authedRequest('rajesh');

let store: MemoryBridgeStore;

beforeEach(() => {
  store = new MemoryBridgeStore();
  setBridgeRuntime(store, { owner: 'worker-a', isLeader: () => true, stop: async () => {} });
});
afterEach(() => {
  setBridgeRuntime(null, null);
  vi.restoreAllMocks();
});

describe('GET /api/bridge/status', () => {
  it('reports the lease holder, checkpoints and pending work', async () => {
    await store.acquireLease('bridge', 'worker-a', 30_000);
    await store.setCheckpoint('fabric:trade-doc-cc', '42');

    const res = await platform.get('/api/bridge/status');
    expect(res.status).toBe(200);
    expect(res.body.data.leader).toBe(true);
    expect(res.body.data.lease_holder).toBe('worker-a');
    expect(res.body.data.fabric.checkpoint).toBe('42');
    expect(res.body.data.dead_letters).toBe(0);
  });

  it('answers 503 when the bridge is not running in this process', async () => {
    setBridgeRuntime(null, null);
    const res = await platform.get('/api/bridge/status');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BRIDGE_UNAVAILABLE');
  });

  it('is not readable by a counterparty', async () => {
    const res = await buyer.get('/api/bridge/status');
    expect(res.status).toBe(403);
  });
});

describe('dead letters', () => {
  async function deadLetter(key: string) {
    await store.claimEvent(key, 'fabric:trade-doc-cc', 60_000);
    return store.failEvent(key, 'vault reverted', 1, { invoice_id: 'INV-1' });
  }

  it('lists what exhausted its retries', async () => {
    await deadLetter('fabric:trade-doc-cc:tx-aaa:InvoiceApproved');

    const res = await platform.get('/api/bridge/dead-letters');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].error).toMatch(/vault reverted/);
    expect(res.body.data[0].payload.invoice_id).toBe('INV-1');
  });

  it('reopens one for another attempt', async () => {
    const key = 'fabric:trade-doc-cc:tx-aaa:InvoiceApproved';
    await deadLetter(key);

    const res = await platform.post('/api/bridge/dead-letters/reopen').send({ key });
    expect(res.status).toBe(200);
    expect((await store.getEntry(key))?.status).toBe('failed');
    expect(await store.listDeadLetters(10)).toHaveLength(0);
  });

  it('404s on a key with no dead letter', async () => {
    const res = await platform.post('/api/bridge/dead-letters/reopen').send({ key: 'nope' });
    expect(res.status).toBe(404);
  });

  it('refuses a reopen with no key', async () => {
    const res = await platform.post('/api/bridge/dead-letters/reopen').send({});
    expect(res.status).toBe(400);
  });

  it('are not readable by a counterparty', async () => {
    const res = await buyer.get('/api/bridge/dead-letters');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/bridge/reconcile', () => {
  beforeEach(() => {
    escrows.length = 0;
    Object.assign(vaultState, { funded: true, invoiceApproved: true, status: 3n });
  });

  it('reports agreement when an approved invoice has a released escrow', async () => {
    escrows.push({ args: { escrowPaymentId: '0xesc1', linkedAssetId: 'INV-1' } });
    vi.spyOn(fabricService, 'query').mockResolvedValue({ status: 'Approved' } as never);

    const res = await platform.post('/api/bridge/reconcile').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.in_sync).toBe(true);
    expect(res.body.data.drift).toHaveLength(0);
  });

  it('catches a Fabric approval the bridge never carried to Polygon', async () => {
    // This is the drift the inbox cannot catch: an event that never arrived at
    // all, so there is no failed delivery to retry.
    escrows.push({ args: { escrowPaymentId: '0xesc1', linkedAssetId: 'INV-1' } });
    Object.assign(vaultState, { funded: true, invoiceApproved: false, status: 2n });
    vi.spyOn(fabricService, 'query').mockResolvedValue({ status: 'Approved' } as never);

    const res = await platform.post('/api/bridge/reconcile').send({});
    expect(res.body.data.in_sync).toBe(false);
    expect(res.body.data.drift[0].kind).toBe('invoice_approved_condition_not_set');
    expect(res.body.data.drift[0].invoice_id).toBe('INV-1');
  });

  it('catches money sitting in the vault with every condition already true', async () => {
    escrows.push({ args: { escrowPaymentId: '0xesc1', linkedAssetId: 'INV-1' } });
    Object.assign(vaultState, { funded: true, invoiceApproved: true, status: 2n });
    vi.spyOn(fabricService, 'query').mockResolvedValue({ status: 'Approved' } as never);

    const res = await platform.post('/api/bridge/reconcile').send({});
    expect(res.body.data.drift[0].kind).toBe('conditions_met_not_released');
  });

  it('catches a release that Fabric never approved', async () => {
    escrows.push({ args: { escrowPaymentId: '0xesc1', linkedAssetId: 'INV-1' } });
    Object.assign(vaultState, { funded: true, invoiceApproved: true, status: 3n });
    vi.spyOn(fabricService, 'query').mockResolvedValue({ status: 'Matched' } as never);

    const res = await platform.post('/api/bridge/reconcile').send({});
    expect(res.body.data.drift[0].kind).toBe('released_without_invoice_approval');
  });

  it('is not runnable by a counterparty', async () => {
    const res = await buyer.post('/api/bridge/reconcile').send({});
    expect(res.status).toBe(403);
  });
});
