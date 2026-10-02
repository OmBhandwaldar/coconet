import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getChaincodeEvents } from '../fabric/gateway.js';
import { factoryContract, vaultContract } from '../polygon/escrow.client.js';
import { escrowIdForInvoice, linkInvoiceToEscrow, rebuildInvoiceLinks } from './escrow.service.js';
import { AuditSink, PendingAuditSink } from '../bridge/audit-sink.js';
import { BridgeStore, InboxEntry } from '../bridge/store.js';
import { backoffDelay, sleep, withRetry } from '../bridge/retry.js';

// ─── The Fabric↔Polygon bridge ────────────────────────────────────────────────
// Correlation key: escrowPaymentId.
//   Fabric → Polygon: trade-doc-cc 'InvoiceApproved' → flip the Polygon
//                     condition → release if every condition now holds.
//   Polygon → Fabric: EscrowVault 'FundsReleased'/'FundsRefunded' → audit.
//
// Every delivery goes through a durable inbox (NEW-PLAN Block 6). Three
// properties follow from that, and all three were absent before:
//
//   A redelivered event does nothing. The inbox key is the Fabric transaction
//   id, which is globally unique, so the second delivery is recognised rather
//   than re-executed.
//
//   A failed delivery is retried, across restarts, and dead-lettered rather than
//   dropped once its budget is spent. It previously vanished into a log line.
//
//   A restart resumes from the last successfully processed block instead of
//   subscribing from the next one, which skipped everything emitted while down.

export const FABRIC_STREAM = 'fabric:trade-doc-cc';
export const POLYGON_STREAM = 'polygon:escrow-vault';
const LEASE = 'bridge';

/** How long a claim may sit in `processing` before another worker may take it. */
const STALE_CLAIM_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 5;

export interface DeliverOptions {
  maxAttempts?: number;
  staleAfterMs?: number;
}

/** A Fabric chaincode event, as the gateway delivers it. */
export interface FabricEvent {
  eventName: string;
  transactionId: string;
  blockNumber: bigint;
  payload: Uint8Array;
}

let running = false;
let auditSink: AuditSink = new PendingAuditSink();

export function setAuditSink(sink: AuditSink): void {
  auditSink = sink;
}

// ─── Fabric → Polygon ─────────────────────────────────────────────────────────

/**
 * Process one Fabric event exactly once.
 *
 * The inbox claim comes first and the checkpoint comes last, and the order is
 * the correctness argument:
 *
 *  - Claim before any chain call, so a concurrent delivery is turned away before
 *    it can issue a second `release`.
 *  - Checkpoint only after success. Advancing past a failure is precisely how a
 *    failed delivery becomes a permanently lost one — the retry would never be
 *    re-read from the stream.
 *  - Checkpoint on an event we deliberately skip, though. An invoice with no
 *    linked escrow is a legitimate no-op, and refusing to advance past it would
 *    pin the checkpoint for ever and make every restart re-read from there.
 */
export async function deliverFabricEvent(
  store: BridgeStore, event: FabricEvent, opts: DeliverOptions = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const key = `${FABRIC_STREAM}:${event.transactionId}:${event.eventName}`;

  const claim = await store.claimEvent(key, FABRIC_STREAM, opts.staleAfterMs ?? STALE_CLAIM_MS);
  if (claim === 'duplicate') {
    logger.debug({ key }, 'Bridge: event already handled — ignoring redelivery');
    return;
  }

  let invoiceId = '';
  try {
    const payload = JSON.parse(Buffer.from(event.payload).toString()) as { invoice_id?: string };
    invoiceId = payload.invoice_id ?? '';
    if (!invoiceId) throw new Error('InvoiceApproved payload carried no invoice_id');

    const escrowId = escrowIdForInvoice(invoiceId);
    if (!escrowId) {
      // Not every approved invoice is escrowed. Settle the inbox entry and move
      // the checkpoint on, or this invoice blocks the stream for ever.
      logger.debug({ invoiceId }, 'Bridge: InvoiceApproved with no linked escrow — nothing to do');
      await store.completeEvent(key);
      await advanceCheckpoint(store, FABRIC_STREAM, event.blockNumber);
      return;
    }

    await handleInvoiceApproved(escrowId, invoiceId);
    await store.completeEvent(key);
    await advanceCheckpoint(store, FABRIC_STREAM, event.blockNumber);
  } catch (err) {
    const message = (err as Error).message;
    const { attempts, dead } = await store.failEvent(key, message, maxAttempts, {
      invoice_id: invoiceId,
      block_number: event.blockNumber.toString(),
      event_name: event.eventName,
    });
    logger.error(
      { key, invoiceId, attempts, dead, err: message },
      dead
        ? 'Bridge: delivery dead-lettered — needs an operator'
        : 'Bridge: delivery failed, will retry',
    );
  }
}

/**
 * Advance a stream's checkpoint, never backwards.
 *
 * Monotonicity matters because retries and the catch-up pass can process an
 * older block after a newer one. Taking the latest write would rewind the
 * checkpoint and replay everything in between — harmless thanks to the inbox,
 * but it would make a restart re-read the whole chain each time.
 */
async function advanceCheckpoint(store: BridgeStore, stream: string, block: bigint): Promise<void> {
  const current = await store.checkpoint(stream);
  if (current !== null && BigInt(current) >= block) return;
  await store.setCheckpoint(stream, block.toString());
}

// EscrowVault status values, in the vault's own order.
const ESCROW_FUNDED = 2;
/** Released, Refunded, Reversed — settled, with nothing left for the bridge. */
const ESCROW_SETTLED = new Set([3, 4, 5]);

/**
 * Flip the invoiceApproved condition, then release if every condition holds.
 *
 * It reads the escrow FIRST, because the vault's calls are not in fact safe to
 * repeat blindly — markInvoiceApproved reverts with "EscrowVault: bad status" on
 * an escrow that has already settled. So repeatability is established by looking
 * at what has already happened rather than assumed:
 *
 *   settled already     nothing to do; this is success, not failure
 *   condition already set   skip the mark, which would revert, and go to release
 *   funded + approved   release
 *
 * This matters on every cold start, not just in theory. The first live run
 * replayed the chain from block 0, redelivered five historical approvals whose
 * escrows were long since released, and dead-lettered all five — each having
 * burned its full retry budget on a call that could never succeed.
 */
export async function handleInvoiceApproved(escrowId: string, invoiceId: string): Promise<void> {
  const vault = vaultContract();
  const before = await vault.getEscrow(escrowId);
  const status = Number(before.status);

  if (ESCROW_SETTLED.has(status)) {
    logger.debug(
      { escrowId, invoiceId, status },
      'Bridge: escrow already settled — approval needs no action',
    );
    return;
  }

  if (!before.invoiceApproved) {
    await withRetry(async () => (await vault.markInvoiceApproved(escrowId)).wait(), {
      label: `markInvoiceApproved ${escrowId}`,
      attempts: 2,
    });
    logger.info({ escrowId, invoiceId }, 'Bridge: marked invoiceApproved on Polygon escrow');
  } else {
    logger.debug({ escrowId, invoiceId }, 'Bridge: invoiceApproved already set — not re-marking');
  }

  // Re-read: the mark above changed it, and on the skip path the values we have
  // may predate whatever set the condition.
  const e = await vault.getEscrow(escrowId);
  // Release needs funded + invoiceApproved (Rule-0A + Rule-0B).
  if (Number(e.status) === ESCROW_FUNDED && e.funded && e.invoiceApproved) {
    await withRetry(async () => (await vault.release(escrowId)).wait(), {
      label: `release ${escrowId}`,
      attempts: 2,
    });
    logger.info({ escrowId }, 'Bridge: all conditions met → escrow released');
  } else {
    logger.info(
      { escrowId, status: Number(e.status), funded: e.funded },
      'Bridge: conditions not yet complete — awaiting funding',
    );
  }
}

// ─── Polygon → Fabric ─────────────────────────────────────────────────────────

export interface PolygonSettlement {
  escrowPaymentId: string;
  outcome: 'Released' | 'Refunded' | 'Reversed';
  beneficiary: string;
  amount: bigint;
  txHash: string;
  blockNumber: number;
}

/** Same exactly-once discipline on the return leg, keyed on the EVM tx hash. */
export async function deliverPolygonSettlement(
  store: BridgeStore, s: PolygonSettlement, opts: DeliverOptions = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const key = `${POLYGON_STREAM}:${s.txHash}:${s.outcome}`;

  const claim = await store.claimEvent(key, POLYGON_STREAM, opts.staleAfterMs ?? STALE_CLAIM_MS);
  if (claim === 'duplicate') return;

  try {
    await auditSink.recordSettlement({
      escrow_payment_id: s.escrowPaymentId,
      outcome: s.outcome,
      beneficiary: s.beneficiary,
      amount: s.amount.toString(),
      tx_hash: s.txHash,
      block_number: s.blockNumber,
      at: new Date().toISOString(),
    });
    await store.completeEvent(key);
    await advanceCheckpoint(store, POLYGON_STREAM, BigInt(s.blockNumber));
  } catch (err) {
    const message = (err as Error).message;
    const { attempts, dead } = await store.failEvent(key, message, maxAttempts, {
      escrow_payment_id: s.escrowPaymentId, tx_hash: s.txHash,
    });
    logger.error({ key, attempts, dead, err: message }, 'Bridge: settlement audit write failed');
  }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export interface BridgeHandle {
  stop(): Promise<void>;
  /** This process's lease owner id — distinct per replica. */
  readonly owner: string;
  /** True while this process holds the lease and is processing. */
  isLeader(): boolean;
}

/**
 * Start the bridge. Only the lease holder processes events, so two API replicas
 * do not both release the same escrow; the durable inbox remains the safety net
 * if the lease is ever held twice through clock skew.
 */
export function startBridge(store: BridgeStore): BridgeHandle {
  const owner = `${process.pid}-${randomUUID().slice(0, 8)}`;
  let stopped = false;
  let leader = false;

  const handle: BridgeHandle = {
    owner,
    isLeader: () => leader,
    stop: async () => {
      stopped = true;
      if (leader) await store.releaseLease(LEASE, owner);
      leader = false;
      logger.info({ owner }, 'Bridge stopped');
    },
  };

  if (running) {
    logger.warn('Bridge already running in this process — ignoring second start');
    return handle;
  }
  running = true;

  void (async () => {
    while (!stopped) {
      const won = await store.acquireLease(LEASE, owner, env.BRIDGE_LEASE_TTL_MS);
      if (won && !leader) {
        leader = true;
        logger.info({ owner }, 'Bridge: acquired lease — this process is the active bridge');
        void initLinks(store);
        void watchFabricEvents(store, () => stopped && leader);
        watchPolygonSettlements(store, () => leader);
        void retryLoop(store, () => stopped || !leader);
      } else if (!won && leader) {
        leader = false;
        logger.warn({ owner, holder: await store.leaseOwner(LEASE) }, 'Bridge: lost the lease');
      } else if (!won) {
        logger.debug({ owner, holder: await store.leaseOwner(LEASE) }, 'Bridge: standing by');
      }
      await sleep(env.BRIDGE_LEASE_TTL_MS / 3);
    }
  })();

  return handle;
}

// Restart-safe correlation: rebuild invoice→escrow links from chain, then keep
// the map live by subscribing to new EscrowInstructionCreated events.
async function initLinks(store: BridgeStore): Promise<void> {
  try {
    const n = await rebuildInvoiceLinks();
    logger.info({ links: n }, 'Bridge: rebuilt invoice→escrow links from chain');
    factoryContract().on(
      'EscrowInstructionCreated',
      (_escrowPaymentId: string, _b: string, _a: bigint, linkedAssetId: string, ...rest: unknown[]) => {
        const escrowPaymentId = _escrowPaymentId;
        linkInvoiceToEscrow(linkedAssetId, escrowPaymentId);
        logger.debug({ linkedAssetId, escrowPaymentId, extra: rest.length }, 'Bridge: linked new escrow instruction');
      },
    );
  } catch (err) {
    logger.warn({ reason: (err as Error).message }, 'Bridge: could not initialise escrow links');
  }
}

/**
 * Read the Fabric event stream from the checkpoint, and keep reading.
 *
 * The stream is resubscribed on error rather than abandoned. Previously a single
 * stream failure left the outer `for await` exited and the bridge silently dead
 * for the lifetime of the process, with nothing but one warning to say so.
 */
async function watchFabricEvents(store: BridgeStore, shouldStop: () => boolean): Promise<void> {
  let attempt = 0;
  while (!shouldStop()) {
    try {
      const from = await store.checkpoint(FABRIC_STREAM);
      // Resume from the block AFTER the last one fully processed. With no
      // checkpoint, start at 0 and let the inbox discard what was already done —
      // replaying is cheap and correct; skipping is neither.
      const startBlock = from === null ? 0n : BigInt(from) + 1n;
      logger.info({ startBlock: startBlock.toString() }, 'Bridge: subscribing to Fabric events');

      const events = await getChaincodeEvents(env.FABRIC_CHAINCODE_TRADE_DOC, { startBlock });
      attempt = 0;
      for await (const event of events) {
        if (shouldStop()) return;
        if (event.eventName !== 'InvoiceApproved') {
          // Still worth advancing: every block we have fully considered is a
          // block we need not re-read.
          await advanceCheckpoint(store, FABRIC_STREAM, event.blockNumber);
          continue;
        }
        await deliverFabricEvent(store, event as FabricEvent);
      }
    } catch (err) {
      attempt += 1;
      const delay = backoffDelay(attempt, { baseMs: 2_000, maxMs: 30_000 });
      logger.error(
        { attempt, delayMs: delay, err: (err as Error).message },
        'Bridge: Fabric event stream failed — resubscribing from checkpoint',
      );
      await sleep(delay);
    }
  }
}

function watchPolygonSettlements(store: BridgeStore, isLeader: () => boolean): void {
  const vault = vaultContract();

  const onEvent = (outcome: PolygonSettlement['outcome']) =>
    (escrowPaymentId: string, beneficiary: string, amount: bigint, ev?: { log?: { transactionHash: string; blockNumber: number } }) => {
      if (!isLeader()) return;
      const log = ev?.log;
      void deliverPolygonSettlement(store, {
        escrowPaymentId, outcome, beneficiary, amount,
        txHash: log?.transactionHash ?? `${escrowPaymentId}:${outcome}`,
        blockNumber: log?.blockNumber ?? 0,
      });
    };

  vault.on('FundsReleased', onEvent('Released'));
  vault.on('FundsRefunded', onEvent('Refunded'));
}

/**
 * Re-execute one stored failure from its saved payload.
 *
 * It does not wait for the stream to redeliver, because the stream does not go
 * backwards — a failure can only be re-read after a reconnect, which is not a
 * retry policy so much as a hope. The saved payload is enough to run the handler
 * again, and `handleInvoiceApproved` is safe to repeat because the vault's own
 * state decides what is left to do.
 */
export async function retryStoredFailure(
  store: BridgeStore, entry: InboxEntry, opts: DeliverOptions = {},
): Promise<'done' | 'failed' | 'unretryable'> {
  const invoiceId = typeof entry.payload?.invoice_id === 'string' ? entry.payload.invoice_id : '';
  const blockNumber = typeof entry.payload?.block_number === 'string' ? entry.payload.block_number : null;
  if (!invoiceId) {
    // Nothing to re-execute from. Dead-letter it rather than leave it cycling.
    await store.failEvent(entry.key, 'stored failure has no invoice_id to retry from', 0, entry.payload);
    return 'unretryable';
  }

  const claim = await store.claimEvent(entry.key, entry.stream, opts.staleAfterMs ?? STALE_CLAIM_MS);
  if (claim === 'duplicate') return 'done';

  try {
    const escrowId = escrowIdForInvoice(invoiceId);
    if (escrowId) await handleInvoiceApproved(escrowId, invoiceId);
    await store.completeEvent(entry.key);
    if (blockNumber) await advanceCheckpoint(store, entry.stream, BigInt(blockNumber));
    logger.info({ key: entry.key, invoiceId }, 'Bridge: stored failure recovered');
    return 'done';
  } catch (err) {
    const message = (err as Error).message;
    const { attempts, dead } = await store.failEvent(
      entry.key, message, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS, entry.payload,
    );
    logger.error({ key: entry.key, attempts, dead, err: message }, 'Bridge: retry failed');
    return 'failed';
  }
}

/**
 * Re-attempt stored failures on a timer.
 *
 * This is what makes retry survive a restart. The in-process backoff in
 * withRetry() absorbs one flaky call; a chain down for a minute outlives it, and
 * only a stored failure re-read from the inbox recovers from that.
 */
async function retryLoop(store: BridgeStore, shouldStop: () => boolean): Promise<void> {
  while (!shouldStop()) {
    await sleep(env.BRIDGE_RETRY_INTERVAL_MS);
    if (shouldStop()) return;
    try {
      const due = await store.dueForRetry(FABRIC_STREAM, 25);
      if (due.length) logger.info({ pending: due.length }, 'Bridge: re-attempting stored failures');
      for (const entry of due) {
        if (shouldStop()) return;
        await retryStoredFailure(store, entry);
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Bridge: retry sweep failed');
    }
  }
}

// ─── Observability ────────────────────────────────────────────────────────────

export interface BridgeStatus {
  leader: boolean;
  owner: string | null;
  lease_holder: string | null;
  fabric: { checkpoint: string | null; pending_retries: number };
  polygon: { checkpoint: string | null };
  dead_letters: number;
  last_progress_at: string | null;
  /**
   * Seconds since the bridge last moved forward. This is the number to alert on.
   *
   * Read from the checkpoint's own updated_at, not an in-process timestamp. The
   * first version used a module-level variable and reported null after every
   * restart — including the restart you most want to know about, since a stuck
   * bridge then looks exactly like one that has just come up.
   *
   * Deliberately not "blocks behind the chain head": the bridge's own stream is
   * what observes the head, so comparing its checkpoint to that measures
   * nothing. Reading the true height needs qscc GetChainInfo, whose response is
   * protobuf — a real gap, recorded rather than papered over with a number that
   * would always be zero. Staleness plus the reconciliation job cover the same
   * ground without pretending otherwise.
   */
  seconds_since_progress: number | null;
}

export async function bridgeStatus(store: BridgeStore, handle?: BridgeHandle): Promise<BridgeStatus> {
  const [fabricCheckpoint, polygonCheckpoint, pending, dead, holder, progressAt] = await Promise.all([
    store.checkpoint(FABRIC_STREAM),
    store.checkpoint(POLYGON_STREAM),
    store.dueForRetry(FABRIC_STREAM, 1_000),
    store.listDeadLetters(1_000),
    store.leaseOwner(LEASE),
    store.checkpointUpdatedAt(FABRIC_STREAM),
  ]);

  return {
    leader: handle?.isLeader() ?? false,
    owner: handle?.owner ?? null,
    lease_holder: holder,
    fabric: { checkpoint: fabricCheckpoint, pending_retries: pending.length },
    polygon: { checkpoint: polygonCheckpoint },
    dead_letters: dead.length,
    last_progress_at: progressAt,
    seconds_since_progress: progressAt === null
      ? null
      : Math.round((Date.now() - Date.parse(progressAt)) / 1000),
  };
}

// ─── Reconciliation ───────────────────────────────────────────────────────────

export type DriftKind =
  | 'invoice_approved_condition_not_set'
  | 'conditions_met_not_released'
  | 'released_without_invoice_approval';

export interface Drift {
  kind: DriftKind;
  escrow_payment_id: string;
  invoice_id: string;
  invoice_status: string;
  escrow_status: number;
  detail: string;
}

/**
 * Compare both chains and report what the bridge should have done and has not.
 *
 * This is the check that catches what the inbox cannot: an event the bridge never
 * received at all. Retries only cover deliveries that arrived and failed — a
 * missed subscription window, or a dead letter nobody actioned, leaves the chains
 * disagreeing with nothing in the inbox to show for it.
 *
 * It reads Polygon's escrow instructions as the index, because the factory's
 * event log is an enumerable list of every escrow and Fabric has no "list
 * invoices" query to iterate from.
 */
export async function reconcile(invoiceStatus: (id: string) => Promise<string>): Promise<Drift[]> {
  const factory = factoryContract();
  const vault = vaultContract();
  const drift: Drift[] = [];

  const created = await factory.queryFilter('EscrowInstructionCreated');
  for (const ev of created) {
    const args = (ev as { args?: { escrowPaymentId: string; linkedAssetId: string } }).args;
    if (!args) continue;
    const { escrowPaymentId, linkedAssetId: invoiceId } = args;

    let status: string;
    try {
      status = await invoiceStatus(invoiceId);
    } catch (err) {
      logger.warn({ invoiceId, err: (err as Error).message }, 'Reconcile: could not read invoice');
      continue;
    }

    const e = await vault.getEscrow(escrowPaymentId);
    const escrowStatus = Number(e.status);
    const approved = status === 'Approved' || status === 'Assigned' || status === 'Settled';

    if (approved && !e.invoiceApproved) {
      drift.push({
        kind: 'invoice_approved_condition_not_set',
        escrow_payment_id: escrowPaymentId, invoice_id: invoiceId,
        invoice_status: status, escrow_status: escrowStatus,
        detail: 'Fabric approved the invoice but the Polygon condition was never flipped',
      });
      continue;
    }
    // 2 == Funded. Still Funded with every condition true means the release call
    // did not land, which is money sitting in the vault that should have moved.
    if (escrowStatus === 2 && e.funded && e.invoiceApproved) {
      drift.push({
        kind: 'conditions_met_not_released',
        escrow_payment_id: escrowPaymentId, invoice_id: invoiceId,
        invoice_status: status, escrow_status: escrowStatus,
        detail: 'Every release condition holds but the escrow is still Funded',
      });
      continue;
    }
    // 3 == Released. Released without Fabric having approved would mean the
    // condition was set from somewhere other than an approval.
    if (escrowStatus === 3 && !approved) {
      drift.push({
        kind: 'released_without_invoice_approval',
        escrow_payment_id: escrowPaymentId, invoice_id: invoiceId,
        invoice_status: status, escrow_status: escrowStatus,
        detail: `Escrow released while the invoice is ${status}`,
      });
    }
  }

  if (drift.length) {
    logger.error({ drift: drift.length, kinds: drift.map((d) => d.kind) }, 'Reconcile: chains disagree');
  } else {
    logger.info({ escrows: created.length }, 'Reconcile: chains agree');
  }
  return drift;
}
