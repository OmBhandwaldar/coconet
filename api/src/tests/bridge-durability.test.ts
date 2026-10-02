import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryBridgeStore } from '../bridge/memory-store.js';

// ─── What the bridge must survive (NEW-PLAN Block 6) ─────────────────────────
// The bridge is the only component whose failure silently loses money movement.
// Before this block it had no checkpoint, no idempotency and no retry: a Fabric
// event delivered twice released an escrow twice, a failed Polygon write was
// logged and dropped, and a restart skipped every event emitted while it was
// down.
//
// These tests drive a real in-memory store rather than mocking it. Idempotency
// and retry are claims about *sequences* of calls, and a mocked store returns
// whatever the test tells it to — which would prove nothing about either.

const vaultMock = {
  markInvoiceApproved: vi.fn(async () => ({ wait: async () => ({}) })),
  release: vi.fn(async () => ({ wait: async () => ({}) })),
  getEscrow: vi.fn(async () => ({ funded: true, invoiceApproved: true, status: 2n })),
};
vi.mock('../polygon/escrow.client.js', () => ({
  vaultContract: () => vaultMock,
  factoryContract: () => ({ on: vi.fn(), queryFilter: vi.fn(async () => []) }),
  usdcContract: () => ({}),
}));
vi.mock('../services/escrow.service.js', () => ({
  escrowIdForInvoice: (id: string) => (id === 'INV-UNLINKED' ? undefined : `ESC-${id}`),
  linkInvoiceToEscrow: vi.fn(),
  rebuildInvoiceLinks: vi.fn(async () => 0),
}));

const { deliverFabricEvent, FABRIC_STREAM } = await import('../services/bridge.service.js');

/** A Fabric chaincode event as the gateway delivers it. */
function invoiceApproved(invoiceId: string, txId: string, blockNumber = 42n) {
  return {
    eventName: 'InvoiceApproved',
    transactionId: txId,
    blockNumber,
    payload: new TextEncoder().encode(JSON.stringify({ invoice_id: invoiceId })),
  };
}

let store: MemoryBridgeStore;

beforeEach(() => {
  store = new MemoryBridgeStore();
  vaultMock.markInvoiceApproved.mockClear();
  vaultMock.release.mockClear();
  vaultMock.getEscrow.mockResolvedValue({ funded: true, invoiceApproved: true, status: 2n });
});

describe('idempotency — the same event twice releases once', () => {
  it('ignores a redelivery of an event already processed', async () => {
    const event = invoiceApproved('INV-1', 'tx-aaa');

    await deliverFabricEvent(store, event);
    await deliverFabricEvent(store, event);

    expect(vaultMock.release).toHaveBeenCalledTimes(1);
    expect(vaultMock.markInvoiceApproved).toHaveBeenCalledTimes(1);
  });

  it('keys on the Fabric transaction id, so two real events both go through', async () => {
    await deliverFabricEvent(store, invoiceApproved('INV-1', 'tx-aaa'));
    await deliverFabricEvent(store, invoiceApproved('INV-2', 'tx-bbb'));

    expect(vaultMock.release).toHaveBeenCalledTimes(2);
  });

  it('does not treat a concurrent in-flight claim as a second event', async () => {
    const event = invoiceApproved('INV-1', 'tx-aaa');
    // Two workers, same delivery, at the same time.
    await Promise.all([deliverFabricEvent(store, event), deliverFabricEvent(store, event)]);

    expect(vaultMock.release).toHaveBeenCalledTimes(1);
  });
});

describe('retry — a failed Polygon write is not lost', () => {
  it('leaves the event eligible for retry rather than marking it done', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValueOnce(new Error('nonce too low'));
    const event = invoiceApproved('INV-1', 'tx-aaa');

    await deliverFabricEvent(store, event);
    expect(vaultMock.release).not.toHaveBeenCalled();

    const entry = await store.getEntry(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`);
    expect(entry?.status).to.equal('failed');
    expect(entry?.error).toMatch(/nonce too low/);
  });

  it('completes on a later attempt, and only releases once in total', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValueOnce(new Error('nonce too low'));
    const event = invoiceApproved('INV-1', 'tx-aaa');

    await deliverFabricEvent(store, event);   // fails
    await deliverFabricEvent(store, event);   // retried, succeeds
    await deliverFabricEvent(store, event);   // duplicate

    expect(vaultMock.release).toHaveBeenCalledTimes(1);
    expect((await store.getEntry(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`))?.status).to.equal('done');
  });

  it('dead-letters after the attempt budget rather than retrying for ever', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('vault reverted'));
    const event = invoiceApproved('INV-1', 'tx-aaa');

    for (let i = 0; i < 6; i++) await deliverFabricEvent(store, event, { maxAttempts: 3 });

    const dead = await store.listDeadLetters(10);
    expect(dead).toHaveLength(1);
    expect(dead[0].key).to.equal(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`);
    expect(dead[0].attempts).to.equal(3);
    // And it stops being attempted once dead.
    expect(vaultMock.markInvoiceApproved).toHaveBeenCalledTimes(3);
  });

  it('reopens a dead letter for another attempt when an operator asks', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('vault reverted'));
    const event = invoiceApproved('INV-1', 'tx-aaa');
    for (let i = 0; i < 4; i++) await deliverFabricEvent(store, event, { maxAttempts: 3 });

    vaultMock.markInvoiceApproved.mockResolvedValue({ wait: async () => ({}) });
    expect(await store.reopenDeadLetter(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`)).to.equal(true);
    await deliverFabricEvent(store, event);

    expect(vaultMock.release).toHaveBeenCalledTimes(1);
    expect(await store.listDeadLetters(10)).toHaveLength(0);
  });
});

describe('checkpointing — a restart resumes instead of skipping', () => {
  it('advances the checkpoint past each processed block', async () => {
    await deliverFabricEvent(store, invoiceApproved('INV-1', 'tx-aaa', 42n));
    expect(await store.checkpoint(FABRIC_STREAM)).to.equal('42');
  });

  it('advances it for an event with no linked escrow too', async () => {
    // Otherwise an unlinked invoice at the head of the stream pins the
    // checkpoint for ever and every restart re-reads from there.
    await deliverFabricEvent(store, invoiceApproved('INV-UNLINKED', 'tx-ccc', 50n));
    expect(vaultMock.release).not.toHaveBeenCalled();
    expect(await store.checkpoint(FABRIC_STREAM)).to.equal('50');
  });

  it('does NOT advance it past an event that failed', async () => {
    // Advancing here is how a failed delivery becomes a permanently lost one.
    vaultMock.markInvoiceApproved.mockRejectedValueOnce(new Error('rpc down'));
    await store.setCheckpoint(FABRIC_STREAM, '41');
    await deliverFabricEvent(store, invoiceApproved('INV-1', 'tx-aaa', 42n));

    expect(await store.checkpoint(FABRIC_STREAM)).to.equal('41');
  });

  it('never moves the checkpoint backwards', async () => {
    await deliverFabricEvent(store, invoiceApproved('INV-2', 'tx-bbb', 99n));
    await deliverFabricEvent(store, invoiceApproved('INV-1', 'tx-aaa', 42n));
    expect(await store.checkpoint(FABRIC_STREAM)).to.equal('99');
  });
});

describe('leader election — two replicas, one bridge', () => {
  it('gives the lease to one owner at a time', async () => {
    expect(await store.acquireLease('bridge', 'worker-a', 30_000)).to.equal(true);
    expect(await store.acquireLease('bridge', 'worker-b', 30_000)).to.equal(false);
    expect(await store.leaseOwner('bridge')).to.equal('worker-a');
  });

  it('lets the holder renew without losing it', async () => {
    await store.acquireLease('bridge', 'worker-a', 30_000);
    expect(await store.acquireLease('bridge', 'worker-a', 30_000)).to.equal(true);
  });

  it('hands over when the holder expires — a crashed leader must not block for ever', async () => {
    await store.acquireLease('bridge', 'worker-a', 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(await store.acquireLease('bridge', 'worker-b', 30_000)).to.equal(true);
    expect(await store.leaseOwner('bridge')).to.equal('worker-b');
  });

  it('hands over immediately when the holder resigns', async () => {
    await store.acquireLease('bridge', 'worker-a', 30_000);
    await store.releaseLease('bridge', 'worker-a');
    expect(await store.acquireLease('bridge', 'worker-b', 30_000)).to.equal(true);
  });

  it('ignores a release from a process that does not hold it', async () => {
    await store.acquireLease('bridge', 'worker-a', 30_000);
    await store.releaseLease('bridge', 'worker-b');
    expect(await store.leaseOwner('bridge')).to.equal('worker-a');
  });
});

describe('a stale claim is recoverable', () => {
  it('lets another worker take over an event whose handler died mid-flight', async () => {
    // Claimed but never completed — the process holding it is gone.
    expect(await store.claimEvent('k', FABRIC_STREAM, 60_000)).to.equal('new');
    expect(await store.claimEvent('k', FABRIC_STREAM, 60_000)).to.equal('duplicate');
    // Once the claim is older than the staleness window it is up for grabs.
    expect(await store.claimEvent('k', FABRIC_STREAM, 0)).to.equal('retry');
  });
});
