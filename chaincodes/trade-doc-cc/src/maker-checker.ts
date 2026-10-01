import { Context } from 'fabric-contract-api';

// ─── BR-09 / Rule-06: maker-checker ──────────────────────────────────────────
// Two signatures on any transition whose value exceeds the approving
// organisation's configured threshold. The threshold lives in onboarding-cc
// (setMakerCheckerThreshold); until Block 5 it was stored and never read.
//
// Three properties this has to hold, and how:
//
//  1. The checker cannot be the maker. Asserted on X.509 identity, not MSP —
//     two users of the same org are the point, so comparing MSPs would compare
//     a value that is equal by construction.
//
//  2. The checker approves exactly what the maker proposed. The maker's
//     payload is stored with the approval record and replayed from storage
//     when the checker signs, so a checker cannot sign off one amount and
//     commit another.
//
//  3. A parked transition still leaves a record. A thrown error would roll the
//     whole transaction back, including the approval record — so the gate
//     RETURNS a pending result and the caller returns it to the client. Fabric
//     has no way to write state and abort.
//
// The approving organisation is the one whose money or liability is at stake:
// the buyer for a PO, GRN or invoice, the lender for a financing approval.

const ONBOARDING_CC = 'onboarding-cc';
const CHANNEL = 'buyer-supplier-channel';
const APPROVAL = 'Approval';
const COLLECTION = '_implicit_org_PlatformMSP';

export type ApprovalStatus = 'PendingApproval' | 'Approved' | 'Rejected';

/** Public: who must sign what, and whether they have. Carries no figures. */
export interface ApprovalIndex {
  tx_type: string;
  entity_id: string;
  /** Organisation whose threshold governs and whose users may sign. */
  org_id: string;
  org_msp: string;
  status: ApprovalStatus;
  /** X.509 identity of the proposer — NFR-05 attribution. */
  maker_id: string;
  maker_msp: string;
  checker_id?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Private: the amount under approval, the threshold it breached, and the
 * payload awaiting a second signature. All three are commercial, so none of
 * them may sit on the channel (PRIVACY-DESIGN.md §2.1) — an approval record
 * whose amount were public would announce the value of every large deal.
 *
 * `reason` is free text a human wrote and can name any figure, so it is
 * private for the same reason invoice rejection reasons are (§3.2).
 */
export interface ApprovalPrivate {
  amount: number;
  threshold: number;
  proposed?: unknown;
  reason?: string;
  salt: string;
}

export interface GateRequest<P> {
  txType: string;
  entityId: string;
  /** Organisation whose threshold governs and whose users may sign. */
  orgId: string;
  amount: number;
  /** Replayed verbatim to the checker. Omit for transitions with no payload. */
  proposed?: P;
}

export type GateResult<P> =
  | { proceed: true; payload?: P; approval?: ApprovalIndex }
  | { proceed: false; approval: ApprovalIndex };

/** Shape returned to the client when a transition is parked for a checker. */
export function pendingResponse(approval: ApprovalIndex): string {
  return JSON.stringify({
    pending_approval: {
      tx_type: approval.tx_type,
      entity_id: approval.entity_id,
      org_id: approval.org_id,
      status: approval.status,
      maker_id: approval.maker_id,
      created_at: approval.created_at,
    },
  });
}

export function approvalKey(ctx: Context, txType: string, entityId: string): string {
  return ctx.stub.createCompositeKey(APPROVAL, [txType, entityId]);
}

function txTimestamp(ctx: Context): string {
  const ts = ctx.stub.getTxTimestamp();
  return new Date(ts.seconds.low * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

async function readIndex(ctx: Context, key: string): Promise<ApprovalIndex | null> {
  const data = await ctx.stub.getState(key);
  if (!data || data.length === 0) return null;
  return JSON.parse(data.toString()) as ApprovalIndex;
}

async function readPrivate(ctx: Context, key: string): Promise<ApprovalPrivate | null> {
  try {
    const data = await ctx.stub.getPrivateData(COLLECTION, key);
    if (!data || data.length === 0) return null;
    return JSON.parse(data.toString()) as ApprovalPrivate;
  } catch {
    return null; // not a collection member — the boundary working
  }
}

// Index rebuilt field by field, never spread from a merged view — the rule that
// two leaks in Block 4 were shipped for want of (PRIVACY-DESIGN.md §12).
async function write(
  ctx: Context, key: string, index: ApprovalIndex, priv: ApprovalPrivate | null,
): Promise<void> {
  const clean: ApprovalIndex = {
    tx_type: index.tx_type, entity_id: index.entity_id,
    org_id: index.org_id, org_msp: index.org_msp, status: index.status,
    maker_id: index.maker_id, maker_msp: index.maker_msp, checker_id: index.checker_id,
    created_at: index.created_at, updated_at: index.updated_at,
  };
  await ctx.stub.putState(key, Buffer.from(JSON.stringify(clean)));
  if (priv) {
    await ctx.stub.putPrivateData(COLLECTION, key, Buffer.from(JSON.stringify(priv)));
  }
}

/**
 * Only the approving organisation's own users may sign. The platform is NOT
 * admitted here, unlike every other access check in these chaincodes.
 *
 * Elsewhere PlatformMSP is allowed through because it custodies the data and
 * endorses every transaction (PRIVACY-DESIGN.md §11.1). A second signature is
 * different in kind: the control exists so that two people inside the buyer or
 * the lender agree, and letting the platform operator countersign a buyer's
 * ₹2.5cr order would make the control mean nothing it claims to mean. The
 * platform signs only where the platform is itself the approving org.
 */
function assertOrgMember(ctx: Context, orgMsp: string, what: string): void {
  const caller = ctx.clientIdentity.getMSPID();
  if (caller !== orgMsp) {
    throw new Error(`${caller} may not approve ${what} — that is ${orgMsp}'s decision`);
  }
}

/**
 * The approving organisation's MSP and its threshold for this transaction type,
 * in one cross-chaincode read of onboarding-cc.
 *
 * getOrganization returns the thresholds only to the organisation itself or the
 * platform, so the absence of that field is itself the access decision: a
 * caller who cannot see the threshold cannot run the gate, and the transition
 * aborts. That is the same boundary Block 4 put around the risk tier, reused
 * rather than re-stated.
 *
 * Fails closed throughout. An unset threshold is 0, which means every
 * transaction of that type needs two signatures — the safe reading of "above
 * the configured threshold", and the reading that makes a forgotten
 * configuration loud instead of permissive.
 */
async function approvingOrg(
  ctx: Context, orgId: string, txType: string,
): Promise<{ orgMsp: string; threshold: number }> {
  const res = await ctx.stub.invokeChaincode(ONBOARDING_CC, ['getOrganization', orgId], CHANNEL);
  if (res.status !== 200) {
    throw new Error(`Maker-checker threshold lookup for ${orgId}/${txType} failed: ${res.message}`);
  }
  const body = res.payload ? res.payload.toString() : '';
  if (!body) {
    throw new Error(`Maker-checker threshold lookup for ${orgId}/${txType} returned nothing`);
  }
  const org = JSON.parse(body) as {
    msp_id?: string;
    maker_checker_thresholds?: Record<string, number>;
  };
  if (!org.msp_id) {
    throw new Error(`Organisation ${orgId} has no MSP — cannot determine who may approve ${txType}`);
  }
  if (!org.maker_checker_thresholds) {
    throw new Error(
      `${ctx.clientIdentity.getMSPID()} may not read ${orgId}'s maker-checker thresholds, ` +
      `so it may not propose ${txType} on ${orgId}'s behalf`,
    );
  }
  const threshold = org.maker_checker_thresholds[txType] ?? 0;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    throw new Error(`Maker-checker threshold for ${orgId}/${txType} is not a number: ${threshold}`);
  }
  return { orgMsp: org.msp_id, threshold };
}

/**
 * Run the gate for one transition. Call it after the state machine has been
 * checked, so a replay against an already-transitioned entity is rejected by
 * the entity's own rules before an approval record is touched.
 */
export async function gate<P>(ctx: Context, req: GateRequest<P>): Promise<GateResult<P>> {
  const what = `${req.txType} on ${req.entityId}`;
  const key = approvalKey(ctx, req.txType, req.entityId);
  const existing = await readIndex(ctx, key);

  // A completed cycle is not a new one. Normally the entity's own state machine
  // rejects the replay before the gate is reached — but approveFinancing leaves
  // the request at Offered, so without this a second call would fall through to
  // the threshold branch, overwrite the Approved record and reset the agreed
  // figure. A Rejected record must not be overwritten either: it is the only
  // place the refusal and its reason exist (NFR-05).
  if (existing && existing.status === 'Approved') {
    throw new Error(`${what} has already been approved by ${existing.checker_id}`);
  }
  if (existing && existing.status === 'Rejected') {
    throw new Error(
      `${what} was refused by ${existing.checker_id} — raise a new one rather than re-proposing this`,
    );
  }

  if (existing && existing.status === 'PendingApproval') {
    assertOrgMember(ctx, existing.org_msp, what);
    const checker = ctx.clientIdentity.getID();
    if (checker === existing.maker_id) {
      throw new Error(
        `${what} was proposed by this identity — a checker must be a different user (BR-09)`,
      );
    }
    const priv = await readPrivate(ctx, key);
    if (!priv) {
      throw new Error(`Proposed payload for ${what} is not readable on this peer`);
    }
    existing.status = 'Approved';
    existing.checker_id = checker;
    existing.updated_at = txTimestamp(ctx);
    await write(ctx, key, existing, priv);
    ctx.stub.setEvent('ApprovalGranted', Buffer.from(JSON.stringify({
      tx_type: existing.tx_type, entity_id: existing.entity_id,
      org_id: existing.org_id, status: existing.status,
    })));
    return { proceed: true, payload: priv.proposed as P | undefined, approval: existing };
  }

  const { orgMsp, threshold } = await approvingOrg(ctx, req.orgId, req.txType);
  assertOrgMember(ctx, orgMsp, what);
  if (req.amount <= threshold) return { proceed: true, payload: req.proposed };

  const now = txTimestamp(ctx);
  const index: ApprovalIndex = {
    tx_type: req.txType,
    entity_id: req.entityId,
    org_id: req.orgId,
    org_msp: orgMsp,
    status: 'PendingApproval',
    maker_id: ctx.clientIdentity.getID(),
    maker_msp: ctx.clientIdentity.getMSPID(),
    created_at: now,
    updated_at: now,
  };
  await write(ctx, key, index, {
    amount: req.amount,
    threshold,
    proposed: req.proposed,
    // Deterministic across endorsers; the tx id is the only entropy chaincode
    // may use (PRIVACY-DESIGN.md §3.3).
    salt: ctx.stub.getTxID(),
  });
  ctx.stub.setEvent('ApprovalRequested', Buffer.from(JSON.stringify({
    tx_type: index.tx_type, entity_id: index.entity_id,
    org_id: index.org_id, status: index.status,
  })));
  return { proceed: false, approval: index };
}

/**
 * The pending record for a transition, if there is one.
 *
 * A caller needs this to tell a maker's call from a checker's BEFORE reading
 * transient data — the checker sends none, so demanding a payload up front
 * would reject the second signature.
 */
export async function pendingFor(
  ctx: Context, txType: string, entityId: string,
): Promise<ApprovalIndex | null> {
  const index = await readIndex(ctx, approvalKey(ctx, txType, entityId));
  return index && index.status === 'PendingApproval' ? index : null;
}

/** A checker declines. The entity does not move; the record says who refused. */
export async function reject(
  ctx: Context, txType: string, entityId: string, reason: string,
): Promise<string> {
  if (!reason) throw new Error('A rejection reason is required (NFR-05)');
  const what = `${txType} on ${entityId}`;
  const key = approvalKey(ctx, txType, entityId);
  const index = await readIndex(ctx, key);
  if (!index) throw new Error(`No approval pending for ${what}`);
  if (index.status !== 'PendingApproval') {
    throw new Error(`Approval for ${what} is already ${index.status}`);
  }
  assertOrgMember(ctx, index.org_msp, what);
  const checker = ctx.clientIdentity.getID();
  if (checker === index.maker_id) {
    throw new Error(`${what} was proposed by this identity — a checker must be a different user (BR-09)`);
  }

  // Not defaulted: readPrivate() swallows a failed read, so a fallback of zeros
  // would write zeros over the real amount and threshold and call it a refusal.
  const priv = await readPrivate(ctx, key);
  if (!priv) throw new Error(`Proposed payload for ${what} is not readable on this peer`);
  priv.reason = reason;
  index.status = 'Rejected';
  index.checker_id = checker;
  index.updated_at = txTimestamp(ctx);
  await write(ctx, key, index, priv);
  ctx.stub.setEvent('ApprovalRejected', Buffer.from(JSON.stringify({
    tx_type: index.tx_type, entity_id: index.entity_id,
    org_id: index.org_id, status: index.status,
  })));
  return JSON.stringify(index);
}

/** One approval record, with the figures when the caller is entitled to them. */
export async function read(ctx: Context, txType: string, entityId: string): Promise<string> {
  const key = approvalKey(ctx, txType, entityId);
  const index = await readIndex(ctx, key);
  if (!index) throw new Error(`No approval record for ${txType} on ${entityId}`);
  const caller = ctx.clientIdentity.getMSPID();
  if (caller !== index.org_msp && caller !== 'PlatformMSP') return JSON.stringify(index);
  const priv = await readPrivate(ctx, key);
  return JSON.stringify({ ...index, ...(priv ?? {}) });
}

/**
 * The approval queue. Scoped to what the caller may act on: an organisation
 * sees its own queue and the platform sees all of it. Figures are left out —
 * the queue is a worklist, and the record itself carries the amount.
 */
export async function listPending(ctx: Context, orgId?: string): Promise<string> {
  const caller = ctx.clientIdentity.getMSPID();
  const out: ApprovalIndex[] = [];
  // Iterated by hand rather than for-await: fabric-shim's StateQueryIterator
  // exposes next()/close() and has no async-iterator symbol, and it must be
  // closed or the peer leaks the query.
  const iterator = await ctx.stub.getStateByPartialCompositeKey(APPROVAL, []);
  try {
    let res = await iterator.next();
    while (!res.done) {
      const value = res.value?.value;
      if (value && value.length > 0) {
        const index = JSON.parse(Buffer.from(value).toString()) as ApprovalIndex;
        const visible = caller === 'PlatformMSP' || index.org_msp === caller;
        if (index.status === 'PendingApproval' && visible && (!orgId || index.org_id === orgId)) {
          out.push(index);
        }
      }
      res = await iterator.next();
    }
  } finally {
    await iterator.close();
  }
  return JSON.stringify(out);
}
