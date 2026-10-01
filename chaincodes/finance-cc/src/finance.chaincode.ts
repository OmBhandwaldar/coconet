import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';

// Same channel as trade-doc-cc; cross-chaincode calls stay in-channel.
const CHANNEL = 'buyer-supplier-channel';
const TRADE_DOC_CC = 'trade-doc-cc';

export type ProductType = 'PreShipment' | 'InvoiceDiscounting';
export type AssetType = 'PO' | 'Invoice';
export type FinanceStatus =
  | 'Requested' | 'Validating' | 'Under Review' | 'Offered' | 'Accepted'
  | 'Disbursed' | 'Repaid' | 'Defaulted' | 'Recovered' | 'Closed';
export type SecurityInterestState = 'None' | 'Perfected' | 'Released';

// ─── Public index vs private payload (PRIVACY-DESIGN.md §2.1) ────────────────
// Financing terms are the most commercially sensitive data on the platform: a
// competing lender who learns a rival's discount rate has learned its pricing
// (§1.1). Rates, fees, tenor and every amount live in the private collection.
//
// The channel keeps what the rules need: which asset is being financed, who the
// parties are, the state machine position, the Rule-02 lien state, and whether
// eligibility passed — a boolean reveals nothing about the money.
export interface FinanceIndex {
  request_id: string;
  product_type: ProductType;
  asset_type: AssetType;
  asset_id: string;
  requestor_org_id: string;
  lender_id?: string;
  lender_msp?: string;
  /** MSPs entitled to the terms. Checked on every private read (§4.1). */
  party_msps: string[];
  security_interest_state: SecurityInterestState;
  status: FinanceStatus;
  /** Outcome and per-check booleans only — the reasons text names figures. */
  eligibility?: { passed: boolean; checks: Record<string, boolean>; at: string };
  disbursement_ref?: string;
  payment_ref?: string;
  created_at: string;
  updated_at: string;
}

export interface FinancePrivate {
  requested_amount: number;
  advance_rate?: number;
  discount_rate?: number;
  interest_rate?: number;
  tenor_days?: number;
  approved_amount?: number;
  disbursed_amount?: number;
  net_disbursed?: number;
  repayment_amount?: number;
  eligibility_reasons?: string[];
  /** 128-bit salt — a discount rate has few enough plausible values to
   *  brute-force against the public hash without one (§3.3). */
  salt: string;
}

export type FinanceRequest = FinanceIndex & Partial<FinancePrivate>;

const FR_TRANSITIONS: Record<FinanceStatus, FinanceStatus[]> = {
  Requested: ['Validating', 'Under Review', 'Closed'],
  Validating: ['Under Review', 'Closed'],
  'Under Review': ['Offered', 'Closed'],
  Offered: ['Accepted', 'Closed'],
  Accepted: ['Disbursed', 'Closed'],
  Disbursed: ['Repaid', 'Defaulted', 'Closed'],
  Repaid: ['Recovered', 'Closed'],
  Defaulted: ['Recovered', 'Closed'],
  Recovered: ['Closed'],
  Closed: [],
};

// Invoice statuses that may be discounted (FR-FIN, Rule-01).
const FINANCEABLE_INVOICE_STATUSES = ['Approved', 'Eligible'];
// PO statuses that may back pre-shipment finance (must be lockable downstream).
const FINANCEABLE_PO_STATUSES = ['Acknowledged', 'Amended'];

@Info({ title: 'FinanceChaincode', description: 'FR-FIN-01 to FR-FIN-04, BR-04, BR-05' })
export class FinanceChaincode extends Contract {

  private txTimestamp(ctx: Context): string {
    const ts = ctx.stub.getTxTimestamp();
    return new Date(ts.seconds.low * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
  }

  // ═══ Create ═════════════════════════════════════════════════════════════════
  @Transaction()
  async createFinanceRequest(ctx: Context, reqJson: string): Promise<string> {
    const input = JSON.parse(reqJson) as Partial<FinanceIndex>;
    const priv = this.transientPayload<Partial<FinancePrivate>>(ctx);

    if (!input.request_id) throw new Error('request_id is required');
    if (!input.product_type) throw new Error('product_type is required');
    if (!input.asset_type) throw new Error('asset_type is required');
    if (!input.asset_id) throw new Error('asset_id is required');
    if (!input.requestor_org_id) throw new Error('requestor_org_id is required');
    if (priv.requested_amount === undefined) throw new Error('requested_amount is required');
    if (!(priv.requested_amount > 0)) throw new Error('requested_amount must be positive');
    if (!priv.salt) throw new Error('salt is required — a discount rate is brute-forceable without one');
    if (input.product_type !== 'PreShipment' && input.product_type !== 'InvoiceDiscounting') {
      throw new Error(`Invalid product_type: ${input.product_type}`);
    }
    if (input.asset_type !== 'PO' && input.asset_type !== 'Invoice') {
      throw new Error(`Invalid asset_type: ${input.asset_type}`);
    }
    if (await this.exists(ctx, this.frKey(input.request_id))) {
      throw new Error(`Finance request ${input.request_id} already exists`);
    }

    if (!input.party_msps?.length) throw new Error('party_msps is required');
    this.assertParty(ctx, input.party_msps, `finance request ${input.request_id}`);

    const now = this.txTimestamp(ctx);
    const fr: FinanceRequest = {
      request_id: input.request_id,
      product_type: input.product_type,
      asset_type: input.asset_type,
      asset_id: input.asset_id,
      requestor_org_id: input.requestor_org_id,
      lender_id: input.lender_id,
      // Needed when the invoice is assigned: the assignee must be added to the
      // invoice's party set or it cannot read the receivable it now owns.
      lender_msp: input.lender_msp,
      party_msps: input.party_msps ?? [],
      requested_amount: priv.requested_amount,
      // Discounting carries its rate from the outset; the other terms arrive
      // with the lender's quote. All of them are private either way.
      discount_rate: priv.discount_rate,
      advance_rate: priv.advance_rate,
      interest_rate: priv.interest_rate,
      tenor_days: priv.tenor_days,
      salt: priv.salt,
      security_interest_state: 'None',
      status: 'Requested',
      created_at: now,
      updated_at: now,
    };
    await this.persistIndex(ctx, fr);
    await this.persistPrivate(ctx, fr);
    ctx.stub.setEvent('FinanceRequestCreated', Buffer.from(JSON.stringify({
      request_id: fr.request_id, product_type: fr.product_type,
      asset_type: fr.asset_type, asset_id: fr.asset_id, status: fr.status,
    })));
    return JSON.stringify(fr);
  }

  // ═══ Rule-01 (eligibility, cross-chaincode read) + Rule-02 (no active lien) ═══
  @Transaction()
  async validateEligibility(ctx: Context, requestId: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertParty(ctx, fr.party_msps, `finance request ${requestId}`);
    this.assertTransition(fr.status, 'Under Review');

    const checks: Record<string, boolean> = {};
    const reasons: string[] = [];

    // Rule-02: no active lien/assignment on the asset.
    const lockFree = !(await this.exists(ctx, this.lockKey(fr.asset_type, fr.asset_id)));
    checks.no_active_lien = lockFree;
    if (!lockFree) reasons.push(`Asset ${fr.asset_type} ${fr.asset_id} already has an active lien (Rule-02)`);

    // Rule-01: asset must exist and be in a financeable on-chain state.
    if (fr.asset_type === 'Invoice') {
      const inv = await this.crossQuery(ctx, 'getInvoice', fr.asset_id);
      const statusOk = !!inv && FINANCEABLE_INVOICE_STATUSES.includes(inv.status);
      const matchOk = !!inv && !!inv.match_result && inv.match_result.passed === true;
      checks.invoice_financeable = statusOk;
      checks.three_way_match_passed = matchOk;
      if (!statusOk) reasons.push(`Invoice ${fr.asset_id} not in a financeable status (need Approved/Eligible)`);
      if (!matchOk) reasons.push(`Invoice ${fr.asset_id} has not passed 3-way match (Rule-01)`);
    } else {
      const po = await this.crossQuery(ctx, 'getPurchaseOrder', fr.asset_id);
      const poOk = !!po && FINANCEABLE_PO_STATUSES.includes(po.status);
      checks.po_financeable = poOk;
      if (!poOk) reasons.push(`PO ${fr.asset_id} not in a financeable status (need Acknowledged/Amended)`);
    }

    const passed = reasons.length === 0;
    // Outcome and per-check booleans are public; the reasons text names the
    // request and its asset, so it goes to the private payload.
    fr.eligibility = { passed, checks, at: this.txTimestamp(ctx) };
    fr.eligibility_reasons = reasons;
    fr.updated_at = this.txTimestamp(ctx);
    if (passed) fr.status = 'Under Review';
    await this.persistIndex(ctx, fr);
    await this.persistPrivate(ctx, fr);
    // `reasons` is free text and stays in fr.eligibility. Only the check NAMES
    // that failed leave the chaincode, so the event says what failed, not by how much.
    const failed_checks = Object.entries(checks).filter(([, ok]) => !ok).map(([check]) => check);
    ctx.stub.setEvent(passed ? 'FinanceEligibilityPassed' : 'FinanceEligibilityFailed',
      Buffer.from(JSON.stringify({ request_id: requestId, status: fr.status, failed_checks })));
    if (!passed) throw new Error(`Eligibility failed: ${reasons.join('; ')}`);
    return JSON.stringify(fr);
  }

  @Transaction()
  async assignLender(ctx: Context, requestId: string, lenderId: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertParty(ctx, fr.party_msps, `finance request ${requestId}`);
    if (!lenderId) throw new Error('lenderId is required');
    fr.lender_id = lenderId;
    fr.updated_at = this.txTimestamp(ctx);
    await this.persistIndex(ctx, fr);
    await this.persistPrivate(ctx, fr);
    ctx.stub.setEvent('LenderAssigned', Buffer.from(JSON.stringify({ request_id: requestId, lender_id: lenderId })));
    return JSON.stringify(fr);
  }

  // ═══ Quote → Approve → Accept ═════════════════════════════════════════════════
  @Transaction()
  async submitQuote(ctx: Context, requestId: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertParty(ctx, fr.party_msps, `finance request ${requestId}`);
    this.assertTransition(fr.status, 'Offered');
    const q = this.transientPayload<Partial<FinancePrivate>>(ctx) as Partial<FinanceRequest>;
    if (q.advance_rate !== undefined) fr.advance_rate = q.advance_rate;
    if (q.discount_rate !== undefined) fr.discount_rate = q.discount_rate;
    if (q.interest_rate !== undefined) fr.interest_rate = q.interest_rate;
    if (q.tenor_days !== undefined) fr.tenor_days = q.tenor_days;
    fr.status = 'Offered';
    fr.updated_at = this.txTimestamp(ctx);
    await this.persistIndex(ctx, fr);
    await this.persistPrivate(ctx, fr);
    ctx.stub.setEvent('FinanceOffered', Buffer.from(JSON.stringify({ request_id: requestId })));
    return JSON.stringify(fr);
  }

  // Maker-checker is storage-only until Ring 11; this records the approved amount.
  @Transaction()
  async approveFinancing(ctx: Context, requestId: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertParty(ctx, fr.party_msps, `finance request ${requestId}`);
    if (fr.status !== 'Offered') throw new Error(`Cannot approve a request in status ${fr.status}`);
    const priv = this.transientPayload<Partial<FinancePrivate>>(ctx);
    const amount = Number(priv.approved_amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid approved amount: ${priv.approved_amount}`);
    fr.approved_amount = amount;
    fr.updated_at = this.txTimestamp(ctx);
    await this.persistIndex(ctx, fr);
    await this.persistPrivate(ctx, fr);
    ctx.stub.setEvent('FinanceApproved', Buffer.from(JSON.stringify({ request_id: requestId, status: fr.status })));
    return JSON.stringify(fr);
  }

  // Supplier accepts the offer → perfects the lien (Rule-02) and locks the asset
  // on trade-doc-cc, atomically in this transaction.
  @Transaction()
  async acceptOffer(ctx: Context, requestId: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertParty(ctx, fr.party_msps, `finance request ${requestId}`);
    this.assertTransition(fr.status, 'Accepted');

    const lockKey = this.lockKey(fr.asset_type, fr.asset_id);
    if (await this.exists(ctx, lockKey)) {
      throw new Error(`Asset ${fr.asset_type} ${fr.asset_id} already locked (Rule-02)`);
    }
    // Reflect the lien on trade-doc-cc (same-tx cross-invoke).
    if (fr.asset_type === 'PO') {
      await this.crossInvoke(ctx, 'lockPO', fr.asset_id);
    } else {
      if (!fr.lender_id) throw new Error('lender_id is required before assigning an invoice');
      if (!fr.lender_msp) throw new Error('lender_msp is required to assign an invoice');
      await this.crossInvoke(ctx, 'assignInvoice', fr.asset_id, fr.lender_id, fr.lender_msp);
    }
    await ctx.stub.putState(lockKey, Buffer.from(JSON.stringify({ request_id: requestId, at: this.txTimestamp(ctx) })));

    fr.status = 'Accepted';
    fr.security_interest_state = 'Perfected';
    fr.updated_at = this.txTimestamp(ctx);
    await this.persistIndex(ctx, fr);
    await this.persistPrivate(ctx, fr);
    ctx.stub.setEvent('FinanceAccepted', Buffer.from(JSON.stringify({
      request_id: requestId, asset_type: fr.asset_type, asset_id: fr.asset_id, status: fr.status,
    })));
    return JSON.stringify(fr);
  }

  // ═══ Disburse → Repay ═════════════════════════════════════════════════════════
  @Transaction()
  async disburseFunds(ctx: Context, requestId: string, disbursementRef: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertParty(ctx, fr.party_msps, `finance request ${requestId}`);
    this.assertTransition(fr.status, 'Disbursed');
    const dPriv = this.transientPayload<Partial<FinancePrivate>>(ctx);
    const gross = fr.approved_amount ?? fr.requested_amount;
    fr.disbursed_amount = gross;
    if (dPriv.net_disbursed !== undefined) {
      const net = Number(dPriv.net_disbursed);
      if (!Number.isFinite(net) || net < 0) throw new Error(`Invalid net amount: ${dPriv.net_disbursed}`);
      fr.net_disbursed = net;
    } else {
      fr.net_disbursed = gross;
    }
    fr.disbursement_ref = disbursementRef ?? '';
    fr.status = 'Disbursed';
    fr.updated_at = this.txTimestamp(ctx);
    await this.persistIndex(ctx, fr);
    await this.persistPrivate(ctx, fr);
    ctx.stub.setEvent('FinanceDisbursed', Buffer.from(JSON.stringify({
      request_id: requestId, status: fr.status,
    })));
    return JSON.stringify(fr);
  }

  @Transaction()
  async recordRepayment(ctx: Context, requestId: string, paymentRef: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertParty(ctx, fr.party_msps, `finance request ${requestId}`);
    this.assertTransition(fr.status, 'Repaid');
    const rPriv = this.transientPayload<Partial<FinancePrivate>>(ctx);
    const amt = Number(rPriv.repayment_amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error(`Invalid repayment amount: ${rPriv.repayment_amount}`);
    fr.repayment_amount = amt;
    fr.payment_ref = paymentRef ?? '';
    fr.status = 'Repaid';
    fr.security_interest_state = 'Released';
    fr.updated_at = this.txTimestamp(ctx);
    // Release the Rule-02 lien so the asset can move on.
    const lockKey = this.lockKey(fr.asset_type, fr.asset_id);
    if (await this.exists(ctx, lockKey)) await ctx.stub.deleteState(lockKey);
    await this.persistIndex(ctx, fr);
    await this.persistPrivate(ctx, fr);
    ctx.stub.setEvent('FinanceRepaid', Buffer.from(JSON.stringify({ request_id: requestId, status: fr.status })));
    return JSON.stringify(fr);
  }

  @Transaction(false)
  @Returns('string')
  async getFinanceRequest(ctx: Context, requestId: string): Promise<string> {
    const index = await this.getFRIndex(ctx, requestId);
    // A competing lender sees the request exists and its state — never the rate.
    if (!this.isParty(ctx, index.party_msps)) return JSON.stringify(index);
    const priv = await this.getPrivate<FinancePrivate>(ctx, this.frKey(requestId));
    return JSON.stringify({ ...index, ...(priv ?? {}) });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  // Canonical payload lives in the platform org's implicit collection — the
  // custody decision in PRIVACY-DESIGN.md §2.2.1.
  private readonly PRIVATE_COLLECTION = '_implicit_org_PlatformMSP';

  private transientPayload<T>(ctx: Context, key = 'payload'): T {
    const raw = ctx.stub.getTransient()?.get(key);
    if (!raw || raw.length === 0) {
      throw new Error(`Transient '${key}' is required — financing terms must not be passed as an argument`);
    }
    return JSON.parse(Buffer.from(raw).toString()) as T;
  }

  private async putPrivate(ctx: Context, key: string, value: unknown): Promise<void> {
    await ctx.stub.putPrivateData(this.PRIVATE_COLLECTION, key, Buffer.from(JSON.stringify(value)));
  }

  private async getPrivate<T>(ctx: Context, key: string): Promise<T | null> {
    try {
      const data = await ctx.stub.getPrivateData(this.PRIVATE_COLLECTION, key);
      if (!data || data.length === 0) return null;
      return JSON.parse(data.toString()) as T;
    } catch {
      return null; // not a collection member — the boundary working
    }
  }

  /** §4.1: collections say who holds data, never who may ask for it. */
  private isParty(ctx: Context, partyMsps: string[] | undefined): boolean {
    const caller = ctx.clientIdentity.getMSPID();
    if (caller === 'PlatformMSP') return true;
    return Array.isArray(partyMsps) && partyMsps.includes(caller);
  }

  private assertParty(ctx: Context, partyMsps: string[] | undefined, what: string): void {
    if (!this.isParty(ctx, partyMsps)) {
      throw new Error(`${ctx.clientIdentity.getMSPID()} is not a party to ${what}`);
    }
  }

  // Index rebuilt field by field — spreading the merged view would publish the
  // terms the collection exists to hide, and a field added later would leak.
  private async persistIndex(ctx: Context, fr: FinanceRequest | FinanceIndex): Promise<void> {
    const index: FinanceIndex = {
      request_id: fr.request_id, product_type: fr.product_type, asset_type: fr.asset_type,
      asset_id: fr.asset_id, requestor_org_id: fr.requestor_org_id,
      lender_id: fr.lender_id, lender_msp: fr.lender_msp, party_msps: fr.party_msps,
      security_interest_state: fr.security_interest_state, status: fr.status,
      eligibility: fr.eligibility, disbursement_ref: fr.disbursement_ref,
      payment_ref: fr.payment_ref, created_at: fr.created_at, updated_at: fr.updated_at,
    };
    await ctx.stub.putState(this.frKey(fr.request_id), Buffer.from(JSON.stringify(index)));
  }

  private async persistPrivate(ctx: Context, fr: FinanceRequest): Promise<void> {
    if (fr.salt === undefined) return; // payload unreadable here — leave it alone
    const payload: FinancePrivate = {
      requested_amount: fr.requested_amount!, advance_rate: fr.advance_rate,
      discount_rate: fr.discount_rate, interest_rate: fr.interest_rate,
      tenor_days: fr.tenor_days, approved_amount: fr.approved_amount,
      disbursed_amount: fr.disbursed_amount, net_disbursed: fr.net_disbursed,
      repayment_amount: fr.repayment_amount, eligibility_reasons: fr.eligibility_reasons,
      salt: fr.salt,
    };
    await this.putPrivate(ctx, this.frKey(fr.request_id), payload);
  }

  private frKey(id: string): string { return `FR:${id}`; }
  private lockKey(assetType: string, assetId: string): string { return `LOCK:${assetType}:${assetId}`; }

  private async exists(ctx: Context, key: string): Promise<boolean> {
    const data = await ctx.stub.getState(key);
    return data !== null && data.length > 0;
  }

  private assertTransition(from: FinanceStatus, to: FinanceStatus): void {
    if (!FR_TRANSITIONS[from].includes(to)) throw new Error(`Illegal finance transition ${from} → ${to}`);
  }

  // Read-only cross-chaincode query into trade-doc-cc on the same channel.
  private async crossQuery(ctx: Context, fn: string, ...args: string[]): Promise<any> {
    const res = await ctx.stub.invokeChaincode(TRADE_DOC_CC, [fn, ...args], CHANNEL);
    if (res.status !== 200) throw new Error(`${TRADE_DOC_CC}.${fn} failed: ${res.message}`);
    const payload = res.payload ? res.payload.toString() : '';
    return payload ? JSON.parse(payload) : null;
  }

  // State-changing cross-chaincode invoke; writes commit within this transaction.
  private async crossInvoke(ctx: Context, fn: string, ...args: string[]): Promise<void> {
    const res = await ctx.stub.invokeChaincode(TRADE_DOC_CC, [fn, ...args], CHANNEL);
    if (res.status !== 200) throw new Error(`${TRADE_DOC_CC}.${fn} failed: ${res.message}`);
  }

  private async getFRIndex(ctx: Context, requestId: string): Promise<FinanceIndex> {
    const data = await ctx.stub.getState(this.frKey(requestId));
    if (!data || data.length === 0) throw new Error(`Finance request ${requestId} not found`);
    return JSON.parse(data.toString()) as FinanceIndex;
  }

  private async getFR(ctx: Context, requestId: string): Promise<FinanceRequest> {
    const index = await this.getFRIndex(ctx, requestId);
    const priv = await this.getPrivate<FinancePrivate>(ctx, this.frKey(requestId));
    return { ...index, ...(priv ?? {}) };
  }
}
