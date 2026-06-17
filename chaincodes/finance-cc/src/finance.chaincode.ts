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

export interface FinanceRequest {
  request_id: string;
  product_type: ProductType;
  asset_type: AssetType;
  asset_id: string;
  requestor_org_id: string;
  lender_id?: string;
  requested_amount: number;
  advance_rate?: number;
  discount_rate?: number;
  interest_rate?: number;
  tenor_days?: number;
  approved_amount?: number;
  disbursed_amount?: number;
  net_disbursed?: number;
  repayment_amount?: number;
  security_interest_state: SecurityInterestState;
  status: FinanceStatus;
  eligibility?: { passed: boolean; checks: Record<string, boolean>; reasons: string[]; at: string };
  disbursement_ref?: string;
  payment_ref?: string;
  created_at: string;
  updated_at: string;
}

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
    const input = JSON.parse(reqJson) as Partial<FinanceRequest>;

    if (!input.request_id) throw new Error('request_id is required');
    if (!input.product_type) throw new Error('product_type is required');
    if (!input.asset_type) throw new Error('asset_type is required');
    if (!input.asset_id) throw new Error('asset_id is required');
    if (!input.requestor_org_id) throw new Error('requestor_org_id is required');
    if (input.requested_amount === undefined) throw new Error('requested_amount is required');
    if (!(input.requested_amount > 0)) throw new Error('requested_amount must be positive');
    if (input.product_type !== 'PreShipment' && input.product_type !== 'InvoiceDiscounting') {
      throw new Error(`Invalid product_type: ${input.product_type}`);
    }
    if (input.asset_type !== 'PO' && input.asset_type !== 'Invoice') {
      throw new Error(`Invalid asset_type: ${input.asset_type}`);
    }
    if (await this.exists(ctx, this.frKey(input.request_id))) {
      throw new Error(`Finance request ${input.request_id} already exists`);
    }

    const now = this.txTimestamp(ctx);
    const fr: FinanceRequest = {
      request_id: input.request_id,
      product_type: input.product_type,
      asset_type: input.asset_type,
      asset_id: input.asset_id,
      requestor_org_id: input.requestor_org_id,
      lender_id: input.lender_id,
      requested_amount: input.requested_amount,
      security_interest_state: 'None',
      status: 'Requested',
      created_at: now,
      updated_at: now,
    };
    await ctx.stub.putState(this.frKey(fr.request_id), Buffer.from(JSON.stringify(fr)));
    ctx.stub.setEvent('FinanceRequestCreated', Buffer.from(JSON.stringify({
      request_id: fr.request_id, product_type: fr.product_type, asset_id: fr.asset_id,
    })));
    return JSON.stringify(fr);
  }

  // ═══ Rule-01 (eligibility, cross-chaincode read) + Rule-02 (no active lien) ═══
  @Transaction()
  async validateEligibility(ctx: Context, requestId: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
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
    fr.eligibility = { passed, checks, reasons, at: this.txTimestamp(ctx) };
    fr.updated_at = this.txTimestamp(ctx);
    if (passed) fr.status = 'Under Review';
    await ctx.stub.putState(this.frKey(requestId), Buffer.from(JSON.stringify(fr)));
    ctx.stub.setEvent(passed ? 'FinanceEligibilityPassed' : 'FinanceEligibilityFailed',
      Buffer.from(JSON.stringify({ request_id: requestId, reasons })));
    if (!passed) throw new Error(`Eligibility failed: ${reasons.join('; ')}`);
    return JSON.stringify(fr);
  }

  @Transaction()
  async assignLender(ctx: Context, requestId: string, lenderId: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    if (!lenderId) throw new Error('lenderId is required');
    fr.lender_id = lenderId;
    fr.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.frKey(requestId), Buffer.from(JSON.stringify(fr)));
    ctx.stub.setEvent('LenderAssigned', Buffer.from(JSON.stringify({ request_id: requestId, lender_id: lenderId })));
    return JSON.stringify(fr);
  }

  // ═══ Quote → Approve → Accept ═════════════════════════════════════════════════
  @Transaction()
  async submitQuote(ctx: Context, requestId: string, quoteJson: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertTransition(fr.status, 'Offered');
    const q = JSON.parse(quoteJson) as Partial<FinanceRequest>;
    if (q.advance_rate !== undefined) fr.advance_rate = q.advance_rate;
    if (q.discount_rate !== undefined) fr.discount_rate = q.discount_rate;
    if (q.interest_rate !== undefined) fr.interest_rate = q.interest_rate;
    if (q.tenor_days !== undefined) fr.tenor_days = q.tenor_days;
    fr.status = 'Offered';
    fr.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.frKey(requestId), Buffer.from(JSON.stringify(fr)));
    ctx.stub.setEvent('FinanceOffered', Buffer.from(JSON.stringify({ request_id: requestId })));
    return JSON.stringify(fr);
  }

  // Maker-checker is storage-only until Ring 11; this records the approved amount.
  @Transaction()
  async approveFinancing(ctx: Context, requestId: string, approvedAmount: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    if (fr.status !== 'Offered') throw new Error(`Cannot approve a request in status ${fr.status}`);
    const amount = Number(approvedAmount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid approved amount: ${approvedAmount}`);
    fr.approved_amount = amount;
    fr.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.frKey(requestId), Buffer.from(JSON.stringify(fr)));
    ctx.stub.setEvent('FinanceApproved', Buffer.from(JSON.stringify({ request_id: requestId, approved_amount: amount })));
    return JSON.stringify(fr);
  }

  // Supplier accepts the offer → perfects the lien (Rule-02) and locks the asset
  // on trade-doc-cc, atomically in this transaction.
  @Transaction()
  async acceptOffer(ctx: Context, requestId: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
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
      await this.crossInvoke(ctx, 'assignInvoice', fr.asset_id, fr.lender_id);
    }
    await ctx.stub.putState(lockKey, Buffer.from(JSON.stringify({ request_id: requestId, at: this.txTimestamp(ctx) })));

    fr.status = 'Accepted';
    fr.security_interest_state = 'Perfected';
    fr.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.frKey(requestId), Buffer.from(JSON.stringify(fr)));
    ctx.stub.setEvent('FinanceAccepted', Buffer.from(JSON.stringify({
      request_id: requestId, asset_type: fr.asset_type, asset_id: fr.asset_id,
    })));
    return JSON.stringify(fr);
  }

  // ═══ Disburse → Repay ═════════════════════════════════════════════════════════
  @Transaction()
  async disburseFunds(ctx: Context, requestId: string, disbursementRef: string, netAmount: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertTransition(fr.status, 'Disbursed');
    const gross = fr.approved_amount ?? fr.requested_amount;
    fr.disbursed_amount = gross;
    if (netAmount !== undefined && netAmount !== '') {
      const net = Number(netAmount);
      if (!Number.isFinite(net) || net < 0) throw new Error(`Invalid net amount: ${netAmount}`);
      fr.net_disbursed = net;
    } else {
      fr.net_disbursed = gross;
    }
    fr.disbursement_ref = disbursementRef ?? '';
    fr.status = 'Disbursed';
    fr.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.frKey(requestId), Buffer.from(JSON.stringify(fr)));
    ctx.stub.setEvent('FinanceDisbursed', Buffer.from(JSON.stringify({
      request_id: requestId, disbursed_amount: gross, net_disbursed: fr.net_disbursed,
    })));
    return JSON.stringify(fr);
  }

  @Transaction()
  async recordRepayment(ctx: Context, requestId: string, amount: string, paymentRef: string): Promise<string> {
    const fr = await this.getFR(ctx, requestId);
    this.assertTransition(fr.status, 'Repaid');
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error(`Invalid repayment amount: ${amount}`);
    fr.repayment_amount = amt;
    fr.payment_ref = paymentRef ?? '';
    fr.status = 'Repaid';
    fr.security_interest_state = 'Released';
    fr.updated_at = this.txTimestamp(ctx);
    // Release the Rule-02 lien so the asset can move on.
    const lockKey = this.lockKey(fr.asset_type, fr.asset_id);
    if (await this.exists(ctx, lockKey)) await ctx.stub.deleteState(lockKey);
    await ctx.stub.putState(this.frKey(requestId), Buffer.from(JSON.stringify(fr)));
    ctx.stub.setEvent('FinanceRepaid', Buffer.from(JSON.stringify({ request_id: requestId, amount: amt })));
    return JSON.stringify(fr);
  }

  @Transaction(false)
  @Returns('string')
  async getFinanceRequest(ctx: Context, requestId: string): Promise<string> {
    return JSON.stringify(await this.getFR(ctx, requestId));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
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

  private async getFR(ctx: Context, requestId: string): Promise<FinanceRequest> {
    const data = await ctx.stub.getState(this.frKey(requestId));
    if (!data || data.length === 0) throw new Error(`Finance request ${requestId} not found`);
    return JSON.parse(data.toString()) as FinanceRequest;
  }
}
