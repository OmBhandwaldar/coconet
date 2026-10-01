import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';
import { gate, listPending, pendingResponse, read as readApproval, reject } from './maker-checker';

// ─── Types ──────────────────────────────────────────────────────────────────
export type POStatus =
  | 'Draft' | 'Issued' | 'Acknowledged' | 'Amended' | 'Locked' | 'Fulfilled' | 'Closed';
export type GRNStatus = 'Received' | 'Accepted';
export type InvoiceStatus =
  | 'Draft' | 'Submitted' | 'Matched' | 'Approved' | 'Eligible'
  | 'Assigned' | 'Settled' | 'Disputed' | 'Closed';

// ─── Public index vs private payload (PRIVACY-DESIGN.md §2.1) ────────────────
// Channel public state carries only what rules and cross-chain correlation need:
// identifiers, parties, status, document hashes. Every commercial figure lives in
// the private collection, so a channel member who is not party to the deal can
// see that it exists but not what it is worth.
export interface POIndex {
  po_id: string;
  buyer_id: string;
  supplier_id: string;
  /** MSPs entitled to the payload. Checked on every private read (§4.1). */
  party_msps: string[];
  doc_hash?: string;
  status: POStatus;
  amendment_count: number;
  created_at: string;
  updated_at: string;
}

export interface POPrivate {
  currency: string;
  gross_value: number;
  item_description: string;
  quantity: number;
  price_per_unit: number;
  delivery_terms: string;
  payment_terms: string;
  amendments: { changed_fields: string[]; changes: Record<string, unknown>; justification: string; at: string }[];
  /** 128-bit client-generated salt — without it the public hash of a round
   *  figure is recoverable by brute force (PRIVACY-DESIGN.md §3.3). */
  salt: string;
}

/** The merged view returned to an entitled caller. */
export type PurchaseOrder = POIndex & Partial<POPrivate>;

export interface GRNIndex {
  grn_id: string;
  po_id: string;
  party_msps: string[];
  doc_hash?: string;
  status: GRNStatus;
  created_at: string;
  updated_at: string;
}

export interface GRNPrivate {
  received_qty: number;
  accepted_qty?: number;
  salt: string;
}

export type GoodsReceipt = GRNIndex & Partial<GRNPrivate>;

// Outcome and per-check booleans stay public: finance-cc reads match_result.passed
// across chaincodes to enforce Rule-01, and a boolean reveals nothing commercial.
// `reasons` is free text built from both documents' figures, so it goes private.
export interface MatchResult {
  passed: boolean;
  checks: {
    po_link: boolean;
    grn_link: boolean;
    amount_within_po: boolean;
    qty_within_grn: boolean;
  };
  matched_at: string;
}

export interface InvoiceIndex {
  invoice_id: string;
  supplier_id: string;
  buyer_id: string;
  po_id: string;
  grn_id: string;
  party_msps: string[];
  doc_hash: string;
  status: InvoiceStatus;
  match_result?: MatchResult;
  assignment_status: 'Unassigned' | 'Assigned';
  assigned_to?: string;
  created_at: string;
  updated_at: string;
}

export interface InvoicePrivate {
  amount: number;
  quantity: number;
  currency: string;
  due_date: string;
  /** Free text naming both documents' figures — never public. */
  match_reasons?: string[];
  salt: string;
}

export type Invoice = InvoiceIndex & Partial<InvoicePrivate>;

// ─── State machines ─────────────────────────────────────────────────────────
const PO_TRANSITIONS: Record<POStatus, POStatus[]> = {
  Draft: ['Issued'],
  Issued: ['Acknowledged', 'Amended', 'Closed'],
  Acknowledged: ['Amended', 'Locked', 'Closed'],
  Amended: ['Acknowledged', 'Locked', 'Closed'],
  Locked: ['Fulfilled', 'Closed'],
  Fulfilled: ['Closed'],
  Closed: [],
};

const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  Draft: ['Submitted'],
  Submitted: ['Matched', 'Disputed', 'Closed'],
  Matched: ['Approved', 'Disputed', 'Closed'],
  Approved: ['Eligible', 'Assigned', 'Disputed', 'Closed'],
  Eligible: ['Assigned', 'Disputed', 'Closed'],
  Assigned: ['Settled', 'Disputed', 'Closed'],
  Settled: ['Closed'],
  Disputed: ['Closed'],
  Closed: [],
};

@Info({ title: 'TradeDocChaincode', description: 'FR-DOC-01 to FR-DOC-04, BR-02' })
export class TradeDocChaincode extends Contract {

  // Deterministic timestamp from the tx proposal — identical across endorsers.
  private txTimestamp(ctx: Context): string {
    const ts = ctx.stub.getTxTimestamp();
    return new Date(ts.seconds.low * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
  }

  // ═══ Purchase Orders ════════════════════════════════════════════════════════

  /**
   * Identifiers, parties and status are passed as arguments and land on the
   * channel. Every commercial figure arrives as transient data and lands only
   * in the private collection, so it never appears in the transaction proposal
   * that endorsers and the orderer see.
   */
  @Transaction()
  async createPO(ctx: Context, poJson: string): Promise<string> {
    const input = JSON.parse(poJson) as Partial<POIndex>;
    const priv = this.transientPayload<Partial<POPrivate>>(ctx);

    if (!input.po_id) throw new Error('po_id is required');
    if (!input.buyer_id) throw new Error('buyer_id is required');
    if (!input.supplier_id) throw new Error('supplier_id is required');
    if (!input.party_msps?.length) throw new Error('party_msps is required');
    if (!priv.currency) throw new Error('currency is required');
    if (priv.gross_value === undefined) throw new Error('gross_value is required');
    if (priv.quantity === undefined) throw new Error('quantity is required');
    if (priv.price_per_unit === undefined) throw new Error('price_per_unit is required');
    if (!priv.item_description) throw new Error('item_description is required');
    if (!priv.salt) throw new Error('salt is required — predictable private data is brute-forceable');

    if (!(priv.gross_value > 0)) throw new Error('gross_value must be positive');
    if (!(priv.quantity > 0)) throw new Error('quantity must be positive');
    if (!(priv.price_per_unit > 0)) throw new Error('price_per_unit must be positive');

    // The submitter cannot write a deal it is not part of.
    this.assertParty(ctx, input.party_msps, `purchase order ${input.po_id}`);

    if (await this.exists(ctx, this.poKey(input.po_id))) {
      throw new Error(`Purchase order ${input.po_id} already exists`);
    }
    if (input.doc_hash) await this.registerDocHash(ctx, input.doc_hash, 'PO', input.po_id);

    const now = this.txTimestamp(ctx);
    const index: POIndex = {
      po_id: input.po_id,
      buyer_id: input.buyer_id,
      supplier_id: input.supplier_id,
      party_msps: input.party_msps,
      doc_hash: input.doc_hash,
      // A PO is born a draft. Issuing it is the act that commits the buyer,
      // so issuing is what maker-checker gates (BR-09) — see issuePO below.
      status: 'Draft',
      amendment_count: 0,
      created_at: now,
      updated_at: now,
    };
    const payload: POPrivate = {
      currency: priv.currency,
      gross_value: priv.gross_value,
      item_description: priv.item_description,
      quantity: priv.quantity,
      price_per_unit: priv.price_per_unit,
      delivery_terms: priv.delivery_terms ?? '',
      payment_terms: priv.payment_terms ?? '',
      amendments: [],
      salt: priv.salt,
    };

    await ctx.stub.putState(this.poKey(index.po_id), Buffer.from(JSON.stringify(index)));
    await this.putPrivate(ctx, this.poKey(index.po_id), payload);
    ctx.stub.setEvent('POCreated', Buffer.from(JSON.stringify({
      po_id: index.po_id, buyer_id: index.buyer_id, supplier_id: index.supplier_id,
      status: index.status, doc_hash: index.doc_hash,
    })));
    return JSON.stringify({ ...index, ...payload });
  }

  /**
   * Draft → Issued, the point at which the buyer is committed to the order.
   *
   * Above the buyer's PO_ISSUE threshold this needs two signatures: the first
   * call parks the transition and returns the pending record, the second call
   * by a different user in the buyer's org commits it.
   */
  @Transaction()
  async issuePO(ctx: Context, poId: string): Promise<string> {
    const po = await this.getPO(ctx, poId);
    this.assertPOTransition(po.status, 'Issued');
    if (po.gross_value === undefined) {
      throw new Error(`Private payload for PO ${poId} is not readable on this peer`);
    }

    const decision = await gate(ctx, {
      txType: 'PO_ISSUE',
      entityId: poId,
      orgId: po.buyer_id,
      amount: po.gross_value,
    });
    if (!decision.proceed) return pendingResponse(decision.approval);

    po.status = 'Issued';
    po.updated_at = this.txTimestamp(ctx);
    await this.persistPOIndex(ctx, po);
    ctx.stub.setEvent('POIssued', Buffer.from(JSON.stringify({
      po_id: poId, buyer_id: po.buyer_id, supplier_id: po.supplier_id, status: po.status,
    })));
    return JSON.stringify(po);
  }

  @Transaction()
  async acknowledgePO(ctx: Context, poId: string, supplierId: string): Promise<string> {
    const po = await this.getPO(ctx, poId);
    if (po.supplier_id !== supplierId) {
      throw new Error(`Only supplier ${po.supplier_id} can acknowledge PO ${poId}`);
    }
    this.assertPOTransition(po.status, 'Acknowledged');
    po.status = 'Acknowledged';
    po.updated_at = this.txTimestamp(ctx);
    await this.persistPOIndex(ctx, po);
    ctx.stub.setEvent('POAcknowledged', Buffer.from(JSON.stringify({ po_id: poId, supplier_id: supplierId })));
    return JSON.stringify(po);
  }

  @Transaction()
  async amendPO(ctx: Context, poId: string, changesJson: string, justification: string): Promise<string> {
    const po = await this.getPO(ctx, poId);
    this.assertPOTransition(po.status, 'Amended');
    if (!justification) throw new Error('justification is required for an amendment');

    const changes = JSON.parse(changesJson) as Partial<PurchaseOrder>;
    const amendable: (keyof PurchaseOrder)[] = [
      'gross_value', 'quantity', 'price_per_unit', 'delivery_terms', 'payment_terms', 'item_description',
    ];
    const applied: Record<string, unknown> = {};
    for (const key of amendable) {
      if (changes[key] !== undefined) {
        (po as unknown as Record<string, unknown>)[key] = changes[key];
        applied[key] = changes[key];
      }
    }
    po.status = 'Amended';
    po.updated_at = this.txTimestamp(ctx);

    // The amended VALUES are commercial data: they go to the private payload.
    // Public state records only that an amendment happened.
    const priv = (await this.getPrivate<POPrivate>(ctx, this.poKey(poId)));
    if (!priv) throw new Error(`Private payload for ${poId} is not readable on this peer`);
    for (const [k, v] of Object.entries(applied)) (priv as unknown as Record<string, unknown>)[k] = v;
    priv.amendments.push({
      changed_fields: Object.keys(applied), changes: applied,
      justification, at: this.txTimestamp(ctx),
    });
    await this.putPrivate(ctx, this.poKey(poId), priv);

    const index: POIndex = {
      po_id: po.po_id, buyer_id: po.buyer_id, supplier_id: po.supplier_id,
      party_msps: po.party_msps, doc_hash: po.doc_hash, status: po.status,
      amendment_count: priv.amendments.length,
      created_at: po.created_at, updated_at: po.updated_at,
    };
    await ctx.stub.putState(this.poKey(poId), Buffer.from(JSON.stringify(index)));
    ctx.stub.setEvent('POAmended', Buffer.from(JSON.stringify({
      po_id: poId, status: po.status, changed_fields: Object.keys(applied),
    })));
    // Return the merged view the caller expects — index plus the amended payload.
    return JSON.stringify({ ...index, ...priv });
  }

  @Transaction()
  async lockPO(ctx: Context, poId: string): Promise<string> {
    return this.transitionPO(ctx, poId, 'Locked', 'POLocked');
  }

  @Transaction()
  async fulfillPO(ctx: Context, poId: string): Promise<string> {
    return this.transitionPO(ctx, poId, 'Fulfilled', 'POFulfilled');
  }

  @Transaction()
  async closePO(ctx: Context, poId: string): Promise<string> {
    return this.transitionPO(ctx, poId, 'Closed', 'POClosed');
  }

  @Transaction(false)
  @Returns('string')
  async getPurchaseOrder(ctx: Context, poId: string): Promise<string> {
    const index = await this.getPOIndex(ctx, poId);
    // A non-party sees that the order exists and its status — never its value.
    if (!this.isParty(ctx, index.party_msps)) return JSON.stringify(index);
    const priv = await this.getPrivate<POPrivate>(ctx, this.poKey(poId));
    return JSON.stringify({ ...index, ...(priv ?? {}) });
  }

  // ═══ Goods Receipt (minimal) ════════════════════════════════════════════════

  @Transaction()
  /** Received quantity is a commercial figure and arrives as transient data. */
  async createGRN(ctx: Context, grnId: string, poId: string, docHash: string): Promise<string> {
    if (!grnId) throw new Error('grn_id is required');
    const priv = this.transientPayload<Partial<GRNPrivate>>(ctx);
    const index = await this.getPOIndex(ctx, poId); // validates the PO exists
    this.assertParty(ctx, index.party_msps, `GRN ${grnId}`);

    if (await this.exists(ctx, this.grnKey(grnId))) {
      throw new Error(`GRN ${grnId} already exists`);
    }
    const qty = Number(priv.received_qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Invalid received_qty: ${priv.received_qty}`);
    if (!priv.salt) throw new Error('salt is required — predictable private data is brute-forceable');

    const now = this.txTimestamp(ctx);
    // The GRN inherits the PO's party set — the same people are entitled to it.
    const grnIndex: GRNIndex = {
      grn_id: grnId,
      po_id: index.po_id,
      party_msps: index.party_msps,
      doc_hash: docHash || undefined,
      status: 'Received',
      created_at: now,
      updated_at: now,
    };
    const payload: GRNPrivate = { received_qty: qty, salt: priv.salt };

    if (docHash) await this.registerDocHash(ctx, docHash, 'GRN', grnId);
    await ctx.stub.putState(this.grnKey(grnId), Buffer.from(JSON.stringify(grnIndex)));
    await this.putPrivate(ctx, this.grnKey(grnId), payload);
    ctx.stub.setEvent('GRNCreated', Buffer.from(JSON.stringify({
      grn_id: grnId, po_id: index.po_id, status: grnIndex.status, doc_hash: grnIndex.doc_hash,
    })));
    return JSON.stringify({ ...grnIndex, ...payload });
  }

  @Transaction()
  async acceptGRN(ctx: Context, grnId: string): Promise<string> {
    const index = await this.getGRNIndex(ctx, grnId);
    if (index.status !== 'Received') throw new Error(`Cannot accept GRN in status ${index.status}`);
    this.assertParty(ctx, index.party_msps, `GRN ${grnId}`);

    const priv = await this.getPrivate<GRNPrivate>(ctx, this.grnKey(grnId));
    if (!priv) throw new Error(`Private payload for GRN ${grnId} is not readable on this peer`);

    // Accepting goods is the buyer's commitment that they arrived as ordered,
    // and everything downstream — the 3-way match, financing eligibility,
    // escrow release — rests on it. The value at stake is the order's, since a
    // GRN carries quantities and no money of its own.
    const po = await this.getPO(ctx, index.po_id);
    if (po.gross_value === undefined) {
      throw new Error(`Private payload for PO ${index.po_id} is not readable on this peer`);
    }
    const decision = await gate(ctx, {
      txType: 'GRN_ACCEPT',
      entityId: grnId,
      orgId: po.buyer_id,
      amount: po.gross_value,
    });
    if (!decision.proceed) return pendingResponse(decision.approval);

    index.status = 'Accepted';
    index.updated_at = this.txTimestamp(ctx);
    priv.accepted_qty = priv.received_qty; // full acceptance (minimal GRN)

    await ctx.stub.putState(this.grnKey(grnId), Buffer.from(JSON.stringify(index)));
    await this.putPrivate(ctx, this.grnKey(grnId), priv);
    ctx.stub.setEvent('GRNAccepted', Buffer.from(JSON.stringify({ grn_id: grnId, status: index.status })));
    return JSON.stringify({ ...index, ...priv });
  }

  @Transaction(false)
  @Returns('string')
  async getGRN(ctx: Context, grnId: string): Promise<string> {
    const index = await this.getGRNIndex(ctx, grnId);
    if (!this.isParty(ctx, index.party_msps)) return JSON.stringify(index);
    const priv = await this.getPrivate<GRNPrivate>(ctx, this.grnKey(grnId));
    return JSON.stringify({ ...index, ...(priv ?? {}) });
  }

  // ═══ Invoices ═══════════════════════════════════════════════════════════════

  @Transaction()
  async submitInvoice(ctx: Context, invoiceJson: string): Promise<string> {
    const input = JSON.parse(invoiceJson) as Partial<InvoiceIndex>;
    const priv = this.transientPayload<Partial<InvoicePrivate>>(ctx);

    if (!input.invoice_id) throw new Error('invoice_id is required');
    if (!input.supplier_id) throw new Error('supplier_id is required');
    if (!input.buyer_id) throw new Error('buyer_id is required');
    if (!input.po_id) throw new Error('po_id is required');
    if (!input.grn_id) throw new Error('grn_id is required');
    if (priv.amount === undefined) throw new Error('amount is required');
    if (priv.quantity === undefined) throw new Error('quantity is required');
    if (!priv.due_date) throw new Error('due_date is required');
    if (!input.doc_hash) throw new Error('doc_hash is required');
    if (!(priv.amount > 0)) throw new Error('amount must be positive');
    if (!priv.salt) throw new Error('salt is required — predictable private data is brute-forceable');

    if (await this.exists(ctx, this.invKey(input.invoice_id))) {
      throw new Error(`Invoice ${input.invoice_id} already exists`);
    }
    // FR-DOC-04: block duplicate documents by hash.
    await this.registerDocHash(ctx, input.doc_hash, 'Invoice', input.invoice_id);

    const now = this.txTimestamp(ctx);
    // The invoice inherits the PO's party set — same deal, same entitled orgs.
    const poIndex = await this.getPOIndex(ctx, input.po_id);
    this.assertParty(ctx, poIndex.party_msps, `invoice ${input.invoice_id}`);

    const index: InvoiceIndex = {
      invoice_id: input.invoice_id,
      supplier_id: input.supplier_id,
      buyer_id: input.buyer_id,
      po_id: input.po_id,
      grn_id: input.grn_id,
      party_msps: poIndex.party_msps,
      doc_hash: input.doc_hash,
      status: 'Submitted',
      assignment_status: 'Unassigned',
      created_at: now,
      updated_at: now,
    };
    const payload: InvoicePrivate = {
      amount: priv.amount!,
      quantity: priv.quantity!,
      currency: priv.currency ?? 'INR',
      due_date: priv.due_date!,
      salt: priv.salt!,
    };
    await ctx.stub.putState(this.invKey(index.invoice_id), Buffer.from(JSON.stringify(index)));
    await this.putPrivate(ctx, this.invKey(index.invoice_id), payload);
    ctx.stub.setEvent('InvoiceSubmitted', Buffer.from(JSON.stringify({
      invoice_id: index.invoice_id, po_id: index.po_id, grn_id: index.grn_id,
      status: index.status, doc_hash: index.doc_hash,
    })));
    return JSON.stringify({ ...index, ...payload });
  }

  // 3-way match: Invoice ↔ PO ↔ GRN (FR-DOC-03, Rule-01 inputs).
  @Transaction()
  async runThreeWayMatch(ctx: Context, invoiceId: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    if (invoice.status !== 'Submitted') {
      throw new Error(`3-way match requires invoice in Submitted, found ${invoice.status}`);
    }
    await this.applyMatch(ctx, invoice);
    await this.persistInvoiceIndex(ctx, invoice);
    await this.persistInvoicePrivate(ctx, invoice);
    return JSON.stringify(invoice);
  }

  // Evaluate the 3-way match against the in-memory invoice object and mutate it
  // (status, match_result) + emit the outcome event. The caller owns the single
  // putState — so a revise-then-match in one tx isn't defeated by Fabric not
  // surfacing same-tx uncommitted writes on a re-read.
  private async applyMatch(ctx: Context, invoice: Invoice): Promise<void> {
    const reasons: string[] = [];
    const po = await this.tryGetPO(ctx, invoice.po_id);
    const grn = await this.tryGetGRN(ctx, invoice.grn_id);

    const po_link = po !== null;
    const grn_link = grn !== null;
    if (!po_link) reasons.push(`PO ${invoice.po_id} not found`);
    if (!grn_link) reasons.push(`GRN ${invoice.grn_id} not found`);

    // GRN must reference the same PO.
    if (po_link && grn_link && grn!.po_id !== po!.po_id) {
      reasons.push(`GRN ${grn!.grn_id} is not linked to PO ${po!.po_id}`);
    }

    // gross_value lives in the private payload; if this peer cannot read it the
    // match cannot be decided here rather than silently passing.
    if (po_link && po!.gross_value === undefined) {
      throw new Error(`PO ${invoice.po_id} private payload is not readable on this peer — cannot match`);
    }
    if (invoice.amount === undefined || invoice.quantity === undefined) {
      throw new Error(`Invoice ${invoice.invoice_id} private payload is not readable on this peer — cannot match`);
    }
    const amount_within_po = po_link ? invoice.amount <= po!.gross_value! : false;
    if (po_link && !amount_within_po) {
      reasons.push(`Invoice amount exceeds PO gross value`);
    }

    const acceptedQty = grn_link ? (grn!.accepted_qty ?? 0) : 0;
    const qty_within_grn = grn_link ? invoice.quantity <= acceptedQty : false;
    if (grn_link && !qty_within_grn) {
      reasons.push(`Invoice quantity exceeds GRN accepted quantity`);
    }

    const passed = po_link && grn_link && amount_within_po && qty_within_grn && reasons.length === 0;
    // Outcome and per-check booleans are public — finance-cc reads passed across
    // chaincodes for Rule-01. The reasons text names figures, so it is private.
    invoice.match_result = {
      passed,
      checks: { po_link, grn_link, amount_within_po, qty_within_grn },
      matched_at: this.txTimestamp(ctx),
    };
    invoice.match_reasons = reasons;
    invoice.updated_at = this.txTimestamp(ctx);
    if (passed) {
      invoice.status = 'Matched';
      ctx.stub.setEvent('InvoiceMatched', Buffer.from(JSON.stringify({ invoice_id: invoice.invoice_id })));
    } else {
      // `reasons` holds both documents' figures in free text — it stays in state
      // (invoice.match_result) and never enters an event. Only the check NAMES go out.
      const failed_checks = Object.entries(invoice.match_result!.checks)
        .filter(([, ok]) => !ok)
        .map(([check]) => check);
      ctx.stub.setEvent('InvoiceMatchFailed', Buffer.from(JSON.stringify({
        invoice_id: invoice.invoice_id, status: invoice.status, failed_checks,
      })));
    }
  }

  // Correct a Submitted (not yet approved) invoice whose 3-way match failed, then
  // re-run the match. Ledger history preserves prior versions (audit intact). Only
  // legal pre-approval — once Matched/Approved/Assigned the invoice is immutable.
  @Transaction()
  async reviseInvoice(ctx: Context, invoiceId: string, docHash: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    if (invoice.status !== 'Submitted') {
      throw new Error(`Only a Submitted invoice can be revised, found ${invoice.status}`);
    }
    this.assertParty(ctx, invoice.party_msps, `invoice ${invoiceId}`);
    const priv = this.transientPayload<Partial<InvoicePrivate>>(ctx);
    const amt = Number(priv.amount);
    const qty = Number(priv.quantity);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error(`Invalid amount: ${priv.amount}`);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Invalid quantity: ${priv.quantity}`);

    if (docHash && docHash !== invoice.doc_hash) {
      await this.registerDocHash(ctx, docHash, 'Invoice', invoiceId); // FR-DOC-04 on the corrected doc
      invoice.doc_hash = docHash;
    }
    invoice.amount = amt;
    invoice.quantity = qty;
    ctx.stub.setEvent('InvoiceRevised', Buffer.from(JSON.stringify({
      invoice_id: invoiceId, status: invoice.status, doc_hash: invoice.doc_hash,
    })));

    // Re-run the 3-way match on the corrected figures, then persist once.
    await this.applyMatch(ctx, invoice);
    await this.persistInvoiceIndex(ctx, invoice);
    await this.persistInvoicePrivate(ctx, invoice);
    return JSON.stringify(invoice);
  }

  @Transaction()
  async approveInvoice(ctx: Context, invoiceId: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    this.assertInvoiceTransition(invoice.status, 'Approved');
    if (!invoice.match_result?.passed) {
      throw new Error(`Cannot approve invoice ${invoiceId}: 3-way match has not passed`);
    }
    if (invoice.amount === undefined) {
      throw new Error(`Private payload for invoice ${invoiceId} is not readable on this peer`);
    }

    const decision = await gate(ctx, {
      txType: 'INVOICE_APPROVE',
      entityId: invoiceId,
      orgId: invoice.buyer_id,
      amount: invoice.amount,
    });
    if (!decision.proceed) return pendingResponse(decision.approval);

    invoice.status = 'Approved';
    invoice.updated_at = this.txTimestamp(ctx);
    await this.persistInvoiceIndex(ctx, invoice);
    ctx.stub.setEvent('InvoiceApproved', Buffer.from(JSON.stringify({ invoice_id: invoiceId })));
    return JSON.stringify(invoice);
  }

  @Transaction()
  async rejectInvoice(ctx: Context, invoiceId: string, reason: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    this.assertInvoiceTransition(invoice.status, 'Closed');
    invoice.status = 'Closed';
    invoice.updated_at = this.txTimestamp(ctx);
    await this.persistInvoiceIndex(ctx, invoice);
    ctx.stub.setEvent('InvoiceRejected', Buffer.from(JSON.stringify({ invoice_id: invoiceId, status: invoice.status })));
    return JSON.stringify(invoice);
  }

  @Transaction()
  async disputeInvoice(ctx: Context, invoiceId: string, reason: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    this.assertInvoiceTransition(invoice.status, 'Disputed');
    invoice.status = 'Disputed';
    invoice.updated_at = this.txTimestamp(ctx);
    await this.persistInvoiceIndex(ctx, invoice);
    ctx.stub.setEvent('InvoiceDisputed', Buffer.from(JSON.stringify({ invoice_id: invoiceId, status: invoice.status })));
    return JSON.stringify(invoice);
  }

  // Assign an approved invoice to a lender (invoice discounting / receivables finance).
  // Called cross-chaincode by finance-cc on lock, or directly. Locks against further assignment.
  @Transaction()
  /**
   * Assignment transfers the receivable, so the lender becomes a party to it and
   * is added to the invoice's party set. Without this the lender owns an invoice
   * it cannot read — which surfaced as the net-settlement maths producing NaN,
   * because the amount simply was not there to read.
   */
  async assignInvoice(ctx: Context, invoiceId: string, lenderId: string, lenderMsp: string): Promise<string> {
    if (!lenderId) throw new Error('lenderId is required');
    if (!lenderMsp) throw new Error('lenderMsp is required — the assignee must become a party to the invoice');
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    if (invoice.assignment_status === 'Assigned') {
      throw new Error(`Invoice ${invoiceId} is already assigned to ${invoice.assigned_to}`);
    }
    this.assertInvoiceTransition(invoice.status, 'Assigned');
    invoice.status = 'Assigned';
    invoice.assignment_status = 'Assigned';
    invoice.assigned_to = lenderId;
    if (!invoice.party_msps.includes(lenderMsp)) invoice.party_msps = [...invoice.party_msps, lenderMsp];
    invoice.updated_at = this.txTimestamp(ctx);
    await this.persistInvoiceIndex(ctx, invoice);
    ctx.stub.setEvent('InvoiceAssigned', Buffer.from(JSON.stringify({ invoice_id: invoiceId, assigned_to: lenderId })));
    return JSON.stringify(invoice);
  }

  @Transaction(false)
  @Returns('string')
  async getInvoice(ctx: Context, invoiceId: string): Promise<string> {
    const index = await this.getInvoiceIndex(ctx, invoiceId);
    // A non-party sees the invoice exists, its status and whether it matched —
    // never its amount. finance-cc relies on exactly that public surface.
    if (!this.isParty(ctx, index.party_msps)) return JSON.stringify(index);
    const priv = await this.getPrivate<InvoicePrivate>(ctx, this.invKey(invoiceId));
    return JSON.stringify({ ...index, ...(priv ?? {}) });
  }

  // ═══ Approval queue (BR-09) ═════════════════════════════════════════════════

  @Transaction()
  async rejectApproval(ctx: Context, txType: string, entityId: string, reason: string): Promise<string> {
    return reject(ctx, txType, entityId, reason);
  }

  @Transaction(false)
  @Returns('string')
  async getApproval(ctx: Context, txType: string, entityId: string): Promise<string> {
    return readApproval(ctx, txType, entityId);
  }

  @Transaction(false)
  @Returns('string')
  async listPendingApprovals(ctx: Context, orgId = ''): Promise<string> {
    return listPending(ctx, orgId || undefined);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  // ─── Private data plumbing (PRIVACY-DESIGN.md §2.2.1) ─────────────────────
  // The canonical payload lives in the platform org's implicit collection.
  // Implicit collections are endorsed and read by their own org only, so a
  // payload spread across every party's collection would need all of them to
  // endorse each write and would make chaincode reads non-deterministic across
  // endorsers. Platform is party to every deal, so one canonical copy keeps
  // logic deterministic while non-parties still never receive the bytes.
  private readonly PRIVATE_COLLECTION = '_implicit_org_PlatformMSP';

  /** Read the payload the caller supplied out-of-band, never as an argument. */
  private transientPayload<T>(ctx: Context, key = 'payload'): T {
    const transient = ctx.stub.getTransient();
    const raw = transient?.get(key);
    if (!raw || raw.length === 0) {
      throw new Error(`Transient '${key}' is required — commercial data must not be passed as an argument`);
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
      // A peer outside the collection cannot read it at all. That is the
      // boundary working, not an error worth surfacing.
      return null;
    }
  }

  /**
   * §4.1: collections say who HOLDS the data, never who may ASK for it, and
   * implicit collections have no memberOnlyRead to fall back on. Every private
   * read therefore checks the caller against the deal's party list here.
   */
  private assertParty(ctx: Context, partyMsps: string[] | undefined, what: string): void {
    if (!this.isParty(ctx, partyMsps)) {
      throw new Error(`${ctx.clientIdentity.getMSPID()} is not a party to ${what}`);
    }
  }

  /**
   * A record written before party sets existed has no list. Treat that as
   * "nobody but the custodian" rather than letting an undefined crash the
   * query — a missing party list must deny access, not throw a confusing 500.
   */
  private isParty(ctx: Context, partyMsps: string[] | undefined): boolean {
    const caller = ctx.clientIdentity.getMSPID();
    if (caller === 'PlatformMSP') return true;
    return Array.isArray(partyMsps) && partyMsps.includes(caller);
  }

  // ─── Index persistence ────────────────────────────────────────────────────
  // Each index is rebuilt field by field rather than spread from the merged
  // view. A merged object carries the private payload, so spreading it into
  // putState would publish exactly what the collection exists to hide — and a
  // private field added later would leak silently. Listing the public fields
  // explicitly makes that impossible.

  private async persistPOIndex(ctx: Context, po: PurchaseOrder | POIndex): Promise<void> {
    const index: POIndex = {
      po_id: po.po_id, buyer_id: po.buyer_id, supplier_id: po.supplier_id,
      party_msps: po.party_msps, doc_hash: po.doc_hash, status: po.status,
      amendment_count: po.amendment_count, created_at: po.created_at, updated_at: po.updated_at,
    };
    await ctx.stub.putState(this.poKey(po.po_id), Buffer.from(JSON.stringify(index)));
  }

  private async persistGRNIndex(ctx: Context, grn: GoodsReceipt | GRNIndex): Promise<void> {
    const index: GRNIndex = {
      grn_id: grn.grn_id, po_id: grn.po_id, party_msps: grn.party_msps,
      doc_hash: grn.doc_hash, status: grn.status,
      created_at: grn.created_at, updated_at: grn.updated_at,
    };
    await ctx.stub.putState(this.grnKey(grn.grn_id), Buffer.from(JSON.stringify(index)));
  }

  private async persistInvoiceIndex(ctx: Context, inv: Invoice | InvoiceIndex): Promise<void> {
    const index: InvoiceIndex = {
      invoice_id: inv.invoice_id, supplier_id: inv.supplier_id, buyer_id: inv.buyer_id,
      po_id: inv.po_id, grn_id: inv.grn_id, party_msps: inv.party_msps,
      doc_hash: inv.doc_hash, status: inv.status, match_result: inv.match_result,
      assignment_status: inv.assignment_status, assigned_to: inv.assigned_to,
      created_at: inv.created_at, updated_at: inv.updated_at,
    };
    await ctx.stub.putState(this.invKey(inv.invoice_id), Buffer.from(JSON.stringify(index)));
  }

  /** Write back only the private half of a merged invoice. */
  private async persistInvoicePrivate(ctx: Context, inv: Invoice): Promise<void> {
    if (inv.salt === undefined) return; // payload not readable here — leave it alone
    const payload: InvoicePrivate = {
      amount: inv.amount!, quantity: inv.quantity!, currency: inv.currency!,
      due_date: inv.due_date!, match_reasons: inv.match_reasons, salt: inv.salt,
    };
    await this.putPrivate(ctx, this.invKey(inv.invoice_id), payload);
  }

  private poKey(id: string): string { return `PO:${id}`; }
  private grnKey(id: string): string { return `GRN:${id}`; }
  private invKey(id: string): string { return `INV:${id}`; }
  private docHashKey(hash: string): string { return `DOCHASH:${hash}`; }

  private async exists(ctx: Context, key: string): Promise<boolean> {
    const data = await ctx.stub.getState(key);
    return data !== null && data.length > 0;
  }

  // FR-DOC-04: a document fingerprint may be registered once across all docs.
  private async registerDocHash(ctx: Context, hash: string, docType: string, docId: string): Promise<void> {
    const key = this.docHashKey(hash);
    if (await this.exists(ctx, key)) {
      const existing = JSON.parse((await ctx.stub.getState(key)).toString());
      throw new Error(`Duplicate document hash ${hash} already used by ${existing.doc_type} ${existing.doc_id}`);
    }
    await ctx.stub.putState(key, Buffer.from(JSON.stringify({ doc_type: docType, doc_id: docId })));
  }

  private assertPOTransition(from: POStatus, to: POStatus): void {
    if (!PO_TRANSITIONS[from].includes(to)) throw new Error(`Illegal PO transition ${from} → ${to}`);
  }

  private assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    if (!INVOICE_TRANSITIONS[from].includes(to)) throw new Error(`Illegal invoice transition ${from} → ${to}`);
  }

  private async transitionPO(ctx: Context, poId: string, to: POStatus, event: string): Promise<string> {
    const po = await this.getPO(ctx, poId);
    this.assertPOTransition(po.status, to);
    po.status = to;
    po.updated_at = this.txTimestamp(ctx);
    await this.persistPOIndex(ctx, po);
    ctx.stub.setEvent(event, Buffer.from(JSON.stringify({ po_id: poId, status: to })));
    return JSON.stringify(po);
  }

  /** Public index only — enough for the state machine, no commercial figures. */
  private async getPOIndex(ctx: Context, poId: string): Promise<POIndex> {
    const data = await ctx.stub.getState(this.poKey(poId));
    if (!data || data.length === 0) throw new Error(`Purchase order ${poId} not found`);
    return JSON.parse(data.toString()) as POIndex;
  }

  /**
   * Index merged with the private payload. The payload comes back only when the
   * executing peer holds the collection; on any other peer the figures are
   * simply absent, which is the boundary working rather than an error.
   */
  private async getPO(ctx: Context, poId: string): Promise<PurchaseOrder> {
    const index = await this.getPOIndex(ctx, poId);
    const priv = await this.getPrivate<POPrivate>(ctx, this.poKey(poId));
    return { ...index, ...(priv ?? {}) };
  }

  private async tryGetPO(ctx: Context, poId: string): Promise<PurchaseOrder | null> {
    const data = await ctx.stub.getState(this.poKey(poId));
    if (!data || data.length === 0) return null;
    const index = JSON.parse(data.toString()) as POIndex;
    const priv = await this.getPrivate<POPrivate>(ctx, this.poKey(poId));
    return { ...index, ...(priv ?? {}) };
  }

  private async getGRNIndex(ctx: Context, grnId: string): Promise<GRNIndex> {
    const data = await ctx.stub.getState(this.grnKey(grnId));
    if (!data || data.length === 0) throw new Error(`GRN ${grnId} not found`);
    return JSON.parse(data.toString()) as GRNIndex;
  }

  private async getGRNState(ctx: Context, grnId: string): Promise<GoodsReceipt> {
    const index = await this.getGRNIndex(ctx, grnId);
    const priv = await this.getPrivate<GRNPrivate>(ctx, this.grnKey(grnId));
    return { ...index, ...(priv ?? {}) };
  }

  private async tryGetGRN(ctx: Context, grnId: string): Promise<GoodsReceipt | null> {
    const data = await ctx.stub.getState(this.grnKey(grnId));
    if (!data || data.length === 0) return null;
    const index = JSON.parse(data.toString()) as GRNIndex;
    const priv = await this.getPrivate<GRNPrivate>(ctx, this.grnKey(grnId));
    return { ...index, ...(priv ?? {}) };
  }

  private async getInvoiceIndex(ctx: Context, invoiceId: string): Promise<InvoiceIndex> {
    const data = await ctx.stub.getState(this.invKey(invoiceId));
    if (!data || data.length === 0) throw new Error(`Invoice ${invoiceId} not found`);
    return JSON.parse(data.toString()) as InvoiceIndex;
  }

  private async getInvoiceState(ctx: Context, invoiceId: string): Promise<Invoice> {
    const index = await this.getInvoiceIndex(ctx, invoiceId);
    const priv = await this.getPrivate<InvoicePrivate>(ctx, this.invKey(invoiceId));
    return { ...index, ...(priv ?? {}) };
  }
}
