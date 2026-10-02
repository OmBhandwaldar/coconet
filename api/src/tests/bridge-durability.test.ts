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

// A STATEFUL vault, keyed per escrow, not a stub returning fixed values. The
// handler now reads the escrow to decide what is left to do, so a mock that
// always reports the same state would let a test encode an assumption about call
// order instead of checking behaviour. Marking flips the condition and releasing
// settles it, exactly as the contract does — and each escrow has its own state,
// or one release would make every other escrow look settled.
interface EscrowState { funded: boolean; invoiceApproved: boolean; status: bigint }
const vault = new Map<string, EscrowState>();
const freshEscrow = (): EscrowState => ({ funded: true, invoiceApproved: false, status: 2n });
const escrowState = (id: string): EscrowState => {
  const existing = vault.get(id);
  if (existing) return existing;
  const created = freshEscrow();
  vault.set(id, created);
  return created;
};
/** Put one escrow in a specific state before the handler sees it. */
const setEscrow = (id: string, state: Partial<EscrowState>) =>
  Object.assign(escrowState(id), state);

/** The real mark: flips the condition. Restored after a test makes it fail. */
const markSucceeds = async (id: string) => {
  escrowState(id).invoiceApproved = true;
  return { wait: async () => ({}) };
};

const vaultMock = {
  markInvoiceApproved: vi.fn(async (id: string) => {
    escrowState(id).invoiceApproved = true;
    return { wait: async () => ({}) };
  }),
  release: vi.fn(async (id: string) => {
    escrowState(id).status = 3n;
    return { wait: async () => ({}) };
  }),
  getEscrow: vi.fn(async (id: string) => ({ ...escrowState(id) })),
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

const { deliverFabricEvent, retryStoredFailure, FABRIC_STREAM } =
  await import('../services/bridge.service.js');

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
  vault.clear();
  vaultMock.markInvoiceApproved.mockClear().mockImplementation(markSucceeds);
  vaultMock.release.mockClear().mockImplementation(async (id: string) => {
    escrowState(id).status = 3n;
    return { wait: async () => ({}) };
  });
  vaultMock.getEscrow.mockClear().mockImplementation(async (id: string) => ({ ...escrowState(id) }));
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
  // Two layers of retry, deliberately. withRetry() absorbs ONE flaky RPC call
  // inside a single delivery; the durable inbox is what survives a chain that is
  // down for longer than that, and a restart. The tests below distinguish them,
  // because a single-shot rejection never reaches the durable layer at all.
  it('absorbs a one-off RPC failure inside the delivery', async () => {
    vaultMock.markInvoiceApproved
      .mockRejectedValueOnce(new Error('nonce too low'))
      .mockImplementation(markSucceeds);

    await deliverFabricEvent(store, invoiceApproved('INV-1', 'tx-aaa'));

    expect(vaultMock.release).toHaveBeenCalledTimes(1);
    expect((await store.getEntry(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`))?.status).to.equal('done');
  });

  it('leaves a persistently failing event eligible for retry, not done', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('rpc unreachable'));
    const event = invoiceApproved('INV-1', 'tx-aaa');

    await deliverFabricEvent(store, event);
    expect(vaultMock.release).not.toHaveBeenCalled();

    const entry = await store.getEntry(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`);
    expect(entry?.status).to.equal('failed');
    expect(entry?.error).toMatch(/rpc unreachable/);
  });

  it('recovers on a later delivery, and releases exactly once in total', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('rpc unreachable'));
    const event = invoiceApproved('INV-1', 'tx-aaa');
    await deliverFabricEvent(store, event);                              // fails

    vaultMock.markInvoiceApproved.mockImplementation(markSucceeds);
    await deliverFabricEvent(store, event);                              // retried, succeeds
    await deliverFabricEvent(store, event);                              // duplicate

    expect(vaultMock.release).toHaveBeenCalledTimes(1);
    expect((await store.getEntry(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`))?.status).to.equal('done');
  });

  it('dead-letters after the attempt budget rather than retrying for ever', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('vault reverted'));
    const event = invoiceApproved('INV-1', 'tx-aaa');

    for (let i = 0; i < 3; i++) await deliverFabricEvent(store, event, { maxAttempts: 3 });
    const callsWhenDead = vaultMock.markInvoiceApproved.mock.calls.length;

    const dead = await store.listDeadLetters(10);
    expect(dead).toHaveLength(1);
    expect(dead[0].key).to.equal(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`);
    expect(dead[0].attempts).to.equal(3);

    // A dead event stops costing RPC calls — the point of a budget.
    for (let i = 0; i < 3; i++) await deliverFabricEvent(store, event, { maxAttempts: 3 });
    expect(vaultMock.markInvoiceApproved.mock.calls.length).to.equal(callsWhenDead);
  });

  it('keeps enough of the event to retry it without the stream', async () => {
    // The stream does not go backwards, so a stored failure that cannot be
    // re-executed from its own payload can only wait for a reconnect.
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('rpc unreachable'));
    await deliverFabricEvent(store, invoiceApproved('INV-1', 'tx-aaa', 42n));

    const [entry] = await store.dueForRetry(FABRIC_STREAM, 10);
    expect(entry.payload?.invoice_id).to.equal('INV-1');
    expect(entry.payload?.block_number).to.equal('42');
  });

  it('re-executes a stored failure from its payload and advances the checkpoint', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('rpc unreachable'));
    await deliverFabricEvent(store, invoiceApproved('INV-1', 'tx-aaa', 42n));
    expect(await store.checkpoint(FABRIC_STREAM)).to.equal(null);

    vaultMock.markInvoiceApproved.mockImplementation(markSucceeds);
    const [entry] = await store.dueForRetry(FABRIC_STREAM, 10);
    expect(await retryStoredFailure(store, entry)).to.equal('done');

    expect(vaultMock.release).toHaveBeenCalledTimes(1);
    expect(await store.checkpoint(FABRIC_STREAM)).to.equal('42');
  });

  it('reopens a dead letter for another attempt when an operator asks', async () => {
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('vault reverted'));
    const event = invoiceApproved('INV-1', 'tx-aaa');
    for (let i = 0; i < 4; i++) await deliverFabricEvent(store, event, { maxAttempts: 3 });

    vaultMock.markInvoiceApproved.mockImplementation(markSucceeds);
    expect(await store.reopenDeadLetter(`${FABRIC_STREAM}:tx-aaa:InvoiceApproved`)).to.equal(true);
    await deliverFabricEvent(store, event);

    expect(vaultMock.release).toHaveBeenCalledTimes(1);
    expect(await store.listDeadLetters(10)).toHaveLength(0);
  });
});

describe('an already-settled escrow is nothing to do, not a failure', () => {
  // Found by running this against the live stack. A cold checkpoint replays the
  // whole chain, so every historical approval is redelivered — and the escrows
  // behind them are long since released. markInvoiceApproved reverts on a
  // settled escrow ("EscrowVault: bad status"), so five old demo runs each burned
  // their full retry budget and dead-lettered.
  //
  // The handler claimed its calls were safe to repeat. They are not: the vault
  // reverts. Repeatability has to be established by READING the vault first,
  // which is what "the on-chain state is the judge" actually requires.
  it('skips an escrow already released', async () => {
    setEscrow('ESC-INV-OLD', { invoiceApproved: true, status: 3n });

    await deliverFabricEvent(store, invoiceApproved('INV-OLD', 'tx-old', 10n));

    expect(vaultMock.markInvoiceApproved).not.toHaveBeenCalled();
    expect(vaultMock.release).not.toHaveBeenCalled();
    // And it counts as handled, so it neither retries nor dead-letters.
    expect((await store.getEntry(`${FABRIC_STREAM}:tx-old:InvoiceApproved`))?.status).to.equal('done');
    expect(await store.listDeadLetters(10)).toHaveLength(0);
    expect(await store.checkpoint(FABRIC_STREAM)).to.equal('10');
  });

  it('skips an escrow already refunded', async () => {
    setEscrow('ESC-INV-REF', { funded: false, status: 4n });
    await deliverFabricEvent(store, invoiceApproved('INV-REF', 'tx-ref', 11n));

    expect(vaultMock.markInvoiceApproved).not.toHaveBeenCalled();
    expect((await store.getEntry(`${FABRIC_STREAM}:tx-ref:InvoiceApproved`))?.status).to.equal('done');
  });

  it('does not re-mark a condition already set, but still releases', async () => {
    // Recovering from a crash between the mark and the release: the mark would
    // revert, so it must be skipped while the release still has to happen.
    setEscrow('ESC-INV-HALF', { invoiceApproved: true, status: 2n });

    await deliverFabricEvent(store, invoiceApproved('INV-HALF', 'tx-half', 12n));

    expect(vaultMock.markInvoiceApproved).not.toHaveBeenCalled();
    expect(vaultMock.release).toHaveBeenCalledTimes(1);
  });

  it('marks and releases when nothing has been done yet', async () => {
    await deliverFabricEvent(store, invoiceApproved('INV-NEW', 'tx-new', 13n));

    expect(vaultMock.markInvoiceApproved).toHaveBeenCalledTimes(1);
    expect(vaultMock.release).toHaveBeenCalledTimes(1);
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
    vaultMock.markInvoiceApproved.mockRejectedValue(new Error('rpc down'));
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
