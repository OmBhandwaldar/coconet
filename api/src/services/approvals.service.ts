import { env } from '../config/env.js';
import { invoke, query } from '../fabric/fabric.service.js';
import { ValidationError } from '../errors/AppError.js';

// ─── Maker-checker (BR-09, Rule-06) ───────────────────────────────────────────
// A transition above the approving organisation's threshold does not happen on
// the first call. The chaincode parks it, records who proposed it, and returns
// the pending record instead of the entity — it cannot throw, because a thrown
// error in Fabric rolls back the approval record along with everything else.
//
// So "pending" arrives here as a successful response with a different shape,
// and every gated endpoint has to distinguish the two. That is what Gated<T>
// and isPending() are for, and why those endpoints answer 202 rather than 200.

export type ApprovalStatus = 'PendingApproval' | 'Approved' | 'Rejected';

export interface PendingApproval {
  pending_approval: {
    tx_type: string;
    entity_id: string;
    org_id: string;
    status: ApprovalStatus;
    maker_id: string;
    created_at: string;
  };
}

/** An approval record. Figures are present only for an entitled caller. */
export interface ApprovalRecord {
  tx_type: string;
  entity_id: string;
  org_id: string;
  org_msp: string;
  status: ApprovalStatus;
  maker_id: string;
  maker_msp: string;
  checker_id?: string;
  created_at: string;
  updated_at: string;
  amount?: number;
  threshold?: number;
  reason?: string;
}

/** Either the transition happened, or it is waiting for a second signature. */
export type Gated<T> = T | PendingApproval;

export function isPending<T>(result: Gated<T>): result is PendingApproval {
  return (
    typeof result === 'object' &&
    result !== null &&
    'pending_approval' in result
  );
}

// Which chaincode holds the approval ledger for a transaction type. Each
// chaincode keeps its own, because each is an independently deployed package
// and an approval must commit in the same transaction as the thing it gates.
const LEDGERS: Record<string, string> = {
  PO_ISSUE: env.FABRIC_CHAINCODE_TRADE_DOC,
  GRN_ACCEPT: env.FABRIC_CHAINCODE_TRADE_DOC,
  INVOICE_APPROVE: env.FABRIC_CHAINCODE_TRADE_DOC,
  FINANCE_APPROVE: env.FABRIC_CHAINCODE_FINANCE,
};

export const TX_TYPES = Object.keys(LEDGERS);

function ledgerFor(txType: string): string {
  const cc = LEDGERS[txType];
  if (!cc) {
    throw new ValidationError(
      `Unknown approval type '${txType}'. Expected one of: ${TX_TYPES.join(', ')}`,
    );
  }
  return cc;
}

/**
 * The caller's approval queue, across both ledgers. Each chaincode scopes its
 * own answer to what the caller's organisation may act on, so this does not
 * filter again — it only merges.
 */
export async function listPending(orgId?: string): Promise<ApprovalRecord[]> {
  const ledgers = [...new Set(Object.values(LEDGERS))];
  const results = await Promise.all(
    ledgers.map((cc) => query<ApprovalRecord[]>(cc, 'listPendingApprovals', orgId ?? '')),
  );
  return results
    .flatMap((r) => r ?? [])
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getApproval(txType: string, entityId: string): Promise<ApprovalRecord> {
  return query<ApprovalRecord>(ledgerFor(txType), 'getApproval', txType, entityId);
}

/** A checker declines. The entity does not move; the record says who refused. */
export async function rejectApproval(
  txType: string, entityId: string, reason: string,
): Promise<ApprovalRecord> {
  return invoke<ApprovalRecord>(ledgerFor(txType), 'rejectApproval', txType, entityId, reason);
}
