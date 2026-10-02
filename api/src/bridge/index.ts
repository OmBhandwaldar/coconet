import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { MemoryBridgeStore } from './memory-store.js';
import { MongoBridgeStore } from './mongo-store.js';
import { BridgeStore } from './store.js';

export { backoffDelay, sleep, withRetry } from './retry.js';
export type { AuditSink, SettlementConfirmation } from './audit-sink.js';
export { PendingAuditSink } from './audit-sink.js';
export { MemoryBridgeStore } from './memory-store.js';
export { MongoBridgeStore } from './mongo-store.js';
export type { BridgeStore, ClaimResult, DeadLetterRecord, InboxEntry } from './store.js';

/**
 * Open the bridge's durable store, or refuse to run.
 *
 * Fails closed, which is the opposite of what this code did before: the bridge
 * started regardless and lost every event it could not deliver. A bridge with no
 * durable store is worse than no bridge at all, because it looks like it is
 * working — so an unreachable Mongo is a startup failure, not a warning.
 *
 * BRIDGE_ALLOW_MEMORY_STORE exists for a single-process development run with no
 * Mongo. It is refused in production, and it is refused silently nowhere: the
 * log says plainly what has been given up.
 */
export async function openBridgeStore(): Promise<BridgeStore> {
  try {
    return await MongoBridgeStore.connect(env.MONGO_URI);
  } catch (err) {
    const reason = (err as Error).message;

    if (env.NODE_ENV === 'production') {
      throw new Error(
        `Bridge store unavailable (${reason}). Refusing to start the bridge without durable ` +
        'state — a failed cross-chain write would be silently lost.',
      );
    }
    if (!env.BRIDGE_ALLOW_MEMORY_STORE) {
      throw new Error(
        `Bridge store unavailable (${reason}). Start MongoDB, or set ` +
        'BRIDGE_ALLOW_MEMORY_STORE=true to run the bridge with in-memory state ' +
        '(checkpoint and inbox are lost on restart).',
      );
    }
    logger.warn(
      { reason },
      'Bridge running on an IN-MEMORY store: no checkpoint, no inbox, no dead letters. ' +
      'A restart loses every pending delivery. Development only.',
    );
    return new MemoryBridgeStore();
  }
}
