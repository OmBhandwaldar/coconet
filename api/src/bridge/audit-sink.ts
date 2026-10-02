import { logger } from '../config/logger.js';

// ─── Polygon → Fabric settlement confirmations ───────────────────────────────
// The return leg of the bridge: a Polygon release or refund has to land on
// Fabric as an audit record, because NFR-05 wants every critical action
// traceable and settlement is the most critical of them.
//
// audit-cc does not exist yet — it is Block 8. The interface is defined here so
// the bridge is already written against it and Block 8 swaps the implementation
// rather than editing the bridge. Until then the stub records settlements to the
// durable store, so the confirmations are not lost in the meantime; what is
// missing is the on-chain record, not the data.

export interface SettlementConfirmation {
  escrow_payment_id: string;
  outcome: 'Released' | 'Refunded' | 'Reversed';
  beneficiary: string;
  amount: string;
  tx_hash: string;
  block_number: number;
  at: string;
}

export interface AuditSink {
  recordSettlement(confirmation: SettlementConfirmation): Promise<void>;
}

/**
 * Stand-in until audit-cc lands. It is deliberately NOT a no-op: a silent sink
 * would make the missing chaincode invisible, and the settlements it saw would
 * be unrecoverable once the log rotated.
 */
export class PendingAuditSink implements AuditSink {
  private readonly pending: SettlementConfirmation[] = [];

  async recordSettlement(c: SettlementConfirmation): Promise<void> {
    this.pending.push(c);
    logger.info(
      { ...c, sink: 'pending', reason: 'audit-cc not deployed (NEW-PLAN Block 8)' },
      'Bridge: settlement confirmation held for audit-cc',
    );
  }

  /** What audit-cc will have to backfill when it arrives. */
  held(): SettlementConfirmation[] {
    return [...this.pending];
  }
}
