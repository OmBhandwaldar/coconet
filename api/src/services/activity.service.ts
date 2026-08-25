// In-memory activity log of on-chain events (Fabric + Polygon). Rebuilt from the
// chains on startup (see activity-feed.service.ts) — no external store needed.

export type Actor = 'Buyer' | 'Supplier' | 'Lender' | 'Platform' | 'System';

export interface ActivityEntry {
  seq: number;
  ts: string; // ISO — receipt time (block-level time isn't carried on the event)
  chain: 'fabric' | 'polygon';
  source: string; // chaincode name or 'escrow'
  event: string;
  label: string;
  actor: Actor | null; // business role that performs this action (derived — MVP has no per-role auth)
  entity_id: string | null;
  deal: string | null;
  tx: string | null;
  block: number | null;
}

// Which business role performs each action in the trade flow. (Derived: the API
// signs every tx as one admin identity today, so this reflects the workflow, not
// a per-user signature. Real RBAC would record the actual signing org.)
export const ACTORS: Record<string, Actor> = {
  OrganizationCreated: 'Platform', OrganizationStatusUpdated: 'Platform', RoleAssigned: 'Platform', RiskTierAssigned: 'Platform',
  POCreated: 'Buyer', POAmended: 'Buyer', POAcknowledged: 'Supplier',
  GRNCreated: 'Buyer', GRNAccepted: 'Buyer',
  InvoiceSubmitted: 'Supplier', InvoiceRevised: 'Supplier',
  InvoiceMatched: 'System', InvoiceMatchFailed: 'System',
  InvoiceApproved: 'Buyer', InvoiceRejected: 'Buyer', InvoiceDisputed: 'Buyer',
  InvoiceAssigned: 'Lender', LenderAssigned: 'Lender',
  FinanceRequestCreated: 'Supplier', FinanceAccepted: 'Supplier',
  FinanceEligibilityPassed: 'Lender', FinanceEligibilityFailed: 'Lender',
  FinanceOffered: 'Lender', FinanceApproved: 'Lender', FinanceDisbursed: 'Lender', FinanceRepaid: 'System',
  EscrowInstructionCreated: 'Buyer', EscrowFunded: 'Buyer', FundsRefunded: 'Buyer', FundsReleased: 'System',
};

// Event name → human label. Unknown events fall back to their raw name.
export const LABELS: Record<string, string> = {
  // onboarding-cc
  OrganizationCreated: 'Organization onboarded',
  OrganizationStatusUpdated: 'Organization status updated',
  RoleAssigned: 'Role assigned',
  RiskTierAssigned: 'Risk tier assigned',
  // trade-doc-cc
  POCreated: 'Purchase order created',
  POAcknowledged: 'Purchase order acknowledged',
  POAmended: 'Purchase order amended',
  GRNCreated: 'Goods receipt recorded',
  GRNAccepted: 'Goods receipt accepted',
  InvoiceSubmitted: 'Invoice submitted',
  InvoiceMatched: 'Invoice 3-way matched',
  InvoiceMatchFailed: 'Invoice match failed',
  InvoiceApproved: 'Invoice approved',
  InvoiceRejected: 'Invoice rejected',
  InvoiceDisputed: 'Invoice disputed',
  InvoiceAssigned: 'Invoice assigned to lender',
  InvoiceRevised: 'Invoice revised',
  LenderAssigned: 'Lender assigned',
  // finance-cc
  FinanceRequestCreated: 'Finance requested',
  FinanceEligibilityPassed: 'Finance eligibility validated',
  FinanceEligibilityFailed: 'Finance eligibility failed',
  FinanceOffered: 'Finance quote offered',
  FinanceApproved: 'Finance approved',
  FinanceAccepted: 'Finance offer accepted',
  FinanceDisbursed: 'Finance disbursed',
  FinanceRepaid: 'Finance repaid',
  // escrow (Polygon)
  EscrowInstructionCreated: 'Escrow instruction created',
  EscrowFunded: 'Escrow funded',
  FundsReleased: 'Escrow released',
  FundsRefunded: 'Escrow refunded',
};

const MAX = 1000;
let seq = 0;
const buffer: ActivityEntry[] = [];

// Polygon events carry only the bytes32 escrowPaymentId; map it → deal + a nicer
// entity id (the linked invoice) captured from EscrowInstructionCreated.
const escrowMetaById = new Map<string, { deal: string | null; entity: string }>();

export function linkEscrow(escrowId: string, linkedAssetId: string): void {
  escrowMetaById.set(escrowId.toLowerCase(), { deal: dealFrom(linkedAssetId), entity: linkedAssetId });
}
export function escrowMeta(escrowId: string): { deal: string | null; entity: string } | undefined {
  return escrowMetaById.get(escrowId.toLowerCase());
}

// Deal code is the D-XXXX token embedded in every entity id (PO-D-AB12, ESCINV-D-AB12…).
export function dealFrom(id?: string | null): string | null {
  if (!id) return null;
  const m = id.match(/D-[0-9A-Z]+/);
  return m ? m[0] : null;
}

// First present of the known id fields across all chaincode event payloads.
export function entityFromFabricPayload(p: Record<string, unknown>): string | null {
  const v = p.invoice_id ?? p.po_id ?? p.grn_id ?? p.request_id ?? p.org_id;
  return typeof v === 'string' ? v : null;
}

export function record(e: Omit<ActivityEntry, 'seq' | 'actor'>): ActivityEntry {
  const entry: ActivityEntry = { ...e, actor: ACTORS[e.event] ?? null, seq: ++seq };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  return entry;
}

// Newest-first, optionally filtered by deal. `after` returns only newer entries
// (for incremental polling); omit it to get the current window.
export function list(opts: { deal?: string; after?: number; limit?: number } = {}): {
  entries: ActivityEntry[];
  lastSeq: number;
} {
  const { deal, after, limit = 300 } = opts;
  let items = buffer;
  if (deal) items = items.filter((e) => e.deal === deal);
  if (after != null) items = items.filter((e) => e.seq > after);
  const entries = items.slice(-limit).reverse();
  return { entries, lastSeq: seq };
}
