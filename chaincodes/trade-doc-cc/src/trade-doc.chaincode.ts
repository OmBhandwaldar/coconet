import { Context, Contract, Info, Returns, Transaction } from 'fabric-contract-api';

// ─── Types ──────────────────────────────────────────────────────────────────
export type POStatus =
  | 'Draft' | 'Issued' | 'Acknowledged' | 'Amended' | 'Locked' | 'Fulfilled' | 'Closed';
export type GRNStatus = 'Received' | 'Accepted';
export type InvoiceStatus =
  | 'Draft' | 'Submitted' | 'Matched' | 'Approved' | 'Eligible'
  | 'Assigned' | 'Settled' | 'Disputed' | 'Closed';

export interface PurchaseOrder {
  po_id: string;
  buyer_id: string;
  supplier_id: string;
  currency: string;
  gross_value: number;
  item_description: string;
  quantity: number;
  price_per_unit: number;
  delivery_terms: string;
  payment_terms: string;
  doc_hash?: string;
  status: POStatus;
  amendments: { changes: Record<string, unknown>; justification: string; at: string }[];
  created_at: string;
  updated_at: string;
}

export interface GoodsReceipt {
  grn_id: string;
  po_id: string;
  received_qty: number;
  accepted_qty?: number;
  doc_hash?: string;
  status: GRNStatus;
  created_at: string;
  updated_at: string;
}

export interface MatchResult {
  passed: boolean;
  checks: {
    po_link: boolean;
    grn_link: boolean;
    amount_within_po: boolean;
    qty_within_grn: boolean;
  };
  reasons: string[];
  matched_at: string;
}

export interface Invoice {
  invoice_id: string;
  supplier_id: string;
  buyer_id: string;
  po_id: string;
  grn_id: string;
  amount: number;
  quantity: number;
  currency: string;
  due_date: string;
  doc_hash: string;
  status: InvoiceStatus;
  match_result?: MatchResult;
  assignment_status: 'Unassigned' | 'Assigned';
  assigned_to?: string;
  created_at: string;
  updated_at: string;
}

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

  @Transaction()
  async createPO(ctx: Context, poJson: string): Promise<string> {
    const input = JSON.parse(poJson) as Partial<PurchaseOrder>;

    if (!input.po_id) throw new Error('po_id is required');
    if (!input.buyer_id) throw new Error('buyer_id is required');
    if (!input.supplier_id) throw new Error('supplier_id is required');
    if (!input.currency) throw new Error('currency is required');
    if (input.gross_value === undefined) throw new Error('gross_value is required');
    if (input.quantity === undefined) throw new Error('quantity is required');
    if (input.price_per_unit === undefined) throw new Error('price_per_unit is required');
    if (!input.item_description) throw new Error('item_description is required');

    if (!(input.gross_value > 0)) throw new Error('gross_value must be positive');
    if (!(input.quantity > 0)) throw new Error('quantity must be positive');
    if (!(input.price_per_unit > 0)) throw new Error('price_per_unit must be positive');

    if (await this.exists(ctx, this.poKey(input.po_id))) {
      throw new Error(`Purchase order ${input.po_id} already exists`);
    }
    if (input.doc_hash) await this.registerDocHash(ctx, input.doc_hash, 'PO', input.po_id);

    const now = this.txTimestamp(ctx);
    const po: PurchaseOrder = {
      po_id: input.po_id,
      buyer_id: input.buyer_id,
      supplier_id: input.supplier_id,
      currency: input.currency,
      gross_value: input.gross_value,
      item_description: input.item_description,
      quantity: input.quantity,
      price_per_unit: input.price_per_unit,
      delivery_terms: input.delivery_terms ?? '',
      payment_terms: input.payment_terms ?? '',
      doc_hash: input.doc_hash,
      status: 'Issued', // maker-checker is storage-only until Ring 11
      amendments: [],
      created_at: now,
      updated_at: now,
    };

    await ctx.stub.putState(this.poKey(po.po_id), Buffer.from(JSON.stringify(po)));
    ctx.stub.setEvent('POCreated', Buffer.from(JSON.stringify({
      po_id: po.po_id, buyer_id: po.buyer_id, supplier_id: po.supplier_id, gross_value: po.gross_value,
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
    await ctx.stub.putState(this.poKey(poId), Buffer.from(JSON.stringify(po)));
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
    po.amendments.push({ changes: applied, justification, at: this.txTimestamp(ctx) });
    po.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.poKey(poId), Buffer.from(JSON.stringify(po)));
    ctx.stub.setEvent('POAmended', Buffer.from(JSON.stringify({ po_id: poId, changes: applied })));
    return JSON.stringify(po);
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
    return JSON.stringify(await this.getPO(ctx, poId));
  }

  // ═══ Goods Receipt (minimal) ════════════════════════════════════════════════

  @Transaction()
  async createGRN(ctx: Context, grnId: string, poId: string, receivedQty: string, docHash: string): Promise<string> {
    if (!grnId) throw new Error('grn_id is required');
    const po = await this.getPO(ctx, poId); // validates PO exists
    if (await this.exists(ctx, this.grnKey(grnId))) {
      throw new Error(`GRN ${grnId} already exists`);
    }
    const qty = Number(receivedQty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Invalid received_qty: ${receivedQty}`);

    const now = this.txTimestamp(ctx);
    const grn: GoodsReceipt = {
      grn_id: grnId,
      po_id: po.po_id,
      received_qty: qty,
      doc_hash: docHash || undefined,
      status: 'Received',
      created_at: now,
      updated_at: now,
    };
    if (docHash) await this.registerDocHash(ctx, docHash, 'GRN', grnId);
    await ctx.stub.putState(this.grnKey(grnId), Buffer.from(JSON.stringify(grn)));
    ctx.stub.setEvent('GRNCreated', Buffer.from(JSON.stringify({ grn_id: grnId, po_id: po.po_id, received_qty: qty })));
    return JSON.stringify(grn);
  }

  @Transaction()
  async acceptGRN(ctx: Context, grnId: string): Promise<string> {
    const grn = await this.getGRNState(ctx, grnId);
    if (grn.status !== 'Received') throw new Error(`Cannot accept GRN in status ${grn.status}`);
    grn.status = 'Accepted';
    grn.accepted_qty = grn.received_qty; // full acceptance (minimal GRN)
    grn.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.grnKey(grnId), Buffer.from(JSON.stringify(grn)));
    ctx.stub.setEvent('GRNAccepted', Buffer.from(JSON.stringify({ grn_id: grnId, accepted_qty: grn.accepted_qty })));
    return JSON.stringify(grn);
  }

  @Transaction(false)
  @Returns('string')
  async getGRN(ctx: Context, grnId: string): Promise<string> {
    return JSON.stringify(await this.getGRNState(ctx, grnId));
  }

  // ═══ Invoices ═══════════════════════════════════════════════════════════════

  @Transaction()
  async submitInvoice(ctx: Context, invoiceJson: string): Promise<string> {
    const input = JSON.parse(invoiceJson) as Partial<Invoice>;

    if (!input.invoice_id) throw new Error('invoice_id is required');
    if (!input.supplier_id) throw new Error('supplier_id is required');
    if (!input.buyer_id) throw new Error('buyer_id is required');
    if (!input.po_id) throw new Error('po_id is required');
    if (!input.grn_id) throw new Error('grn_id is required');
    if (input.amount === undefined) throw new Error('amount is required');
    if (input.quantity === undefined) throw new Error('quantity is required');
    if (!input.due_date) throw new Error('due_date is required');
    if (!input.doc_hash) throw new Error('doc_hash is required');
    if (!(input.amount > 0)) throw new Error('amount must be positive');

    if (await this.exists(ctx, this.invKey(input.invoice_id))) {
      throw new Error(`Invoice ${input.invoice_id} already exists`);
    }
    // FR-DOC-04: block duplicate documents by hash.
    await this.registerDocHash(ctx, input.doc_hash, 'Invoice', input.invoice_id);

    const now = this.txTimestamp(ctx);
    const invoice: Invoice = {
      invoice_id: input.invoice_id,
      supplier_id: input.supplier_id,
      buyer_id: input.buyer_id,
      po_id: input.po_id,
      grn_id: input.grn_id,
      amount: input.amount,
      quantity: input.quantity,
      currency: input.currency ?? 'INR',
      due_date: input.due_date,
      doc_hash: input.doc_hash,
      status: 'Submitted',
      assignment_status: 'Unassigned',
      created_at: now,
      updated_at: now,
    };
    await ctx.stub.putState(this.invKey(invoice.invoice_id), Buffer.from(JSON.stringify(invoice)));
    ctx.stub.setEvent('InvoiceSubmitted', Buffer.from(JSON.stringify({
      invoice_id: invoice.invoice_id, po_id: invoice.po_id, amount: invoice.amount,
    })));
    return JSON.stringify(invoice);
  }

  // 3-way match: Invoice ↔ PO ↔ GRN (FR-DOC-03, Rule-01 inputs).
  @Transaction()
  async runThreeWayMatch(ctx: Context, invoiceId: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    if (invoice.status !== 'Submitted') {
      throw new Error(`3-way match requires invoice in Submitted, found ${invoice.status}`);
    }
    await this.applyMatch(ctx, invoice);
    await ctx.stub.putState(this.invKey(invoiceId), Buffer.from(JSON.stringify(invoice)));
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

    const amount_within_po = po_link ? invoice.amount <= po!.gross_value : false;
    if (po_link && !amount_within_po) {
      reasons.push(`Invoice amount ${invoice.amount} exceeds PO gross_value ${po!.gross_value}`);
    }

    const acceptedQty = grn_link ? (grn!.accepted_qty ?? 0) : 0;
    const qty_within_grn = grn_link ? invoice.quantity <= acceptedQty : false;
    if (grn_link && !qty_within_grn) {
      reasons.push(`Invoice quantity ${invoice.quantity} exceeds GRN accepted_qty ${acceptedQty}`);
    }

    const passed = po_link && grn_link && amount_within_po && qty_within_grn && reasons.length === 0;
    invoice.match_result = {
      passed,
      checks: { po_link, grn_link, amount_within_po, qty_within_grn },
      reasons,
      matched_at: this.txTimestamp(ctx),
    };
    invoice.updated_at = this.txTimestamp(ctx);
    if (passed) {
      invoice.status = 'Matched';
      ctx.stub.setEvent('InvoiceMatched', Buffer.from(JSON.stringify({ invoice_id: invoice.invoice_id })));
    } else {
      ctx.stub.setEvent('InvoiceMatchFailed', Buffer.from(JSON.stringify({ invoice_id: invoice.invoice_id, reasons })));
    }
  }

  // Correct a Submitted (not yet approved) invoice whose 3-way match failed, then
  // re-run the match. Ledger history preserves prior versions (audit intact). Only
  // legal pre-approval — once Matched/Approved/Assigned the invoice is immutable.
  @Transaction()
  async reviseInvoice(ctx: Context, invoiceId: string, amount: string, quantity: string, docHash: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    if (invoice.status !== 'Submitted') {
      throw new Error(`Only a Submitted invoice can be revised, found ${invoice.status}`);
    }
    const amt = Number(amount);
    const qty = Number(quantity);
    if (!Number.isFinite(amt) || amt <= 0) throw new Error(`Invalid amount: ${amount}`);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error(`Invalid quantity: ${quantity}`);

    if (docHash && docHash !== invoice.doc_hash) {
      await this.registerDocHash(ctx, docHash, 'Invoice', invoiceId); // FR-DOC-04 on the corrected doc
      invoice.doc_hash = docHash;
    }
    invoice.amount = amt;
    invoice.quantity = qty;
    ctx.stub.setEvent('InvoiceRevised', Buffer.from(JSON.stringify({ invoice_id: invoiceId, amount: amt, quantity: qty })));

    // Re-run the 3-way match on the corrected figures, then persist once.
    await this.applyMatch(ctx, invoice);
    await ctx.stub.putState(this.invKey(invoiceId), Buffer.from(JSON.stringify(invoice)));
    return JSON.stringify(invoice);
  }

  @Transaction()
  async approveInvoice(ctx: Context, invoiceId: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    this.assertInvoiceTransition(invoice.status, 'Approved');
    if (!invoice.match_result?.passed) {
      throw new Error(`Cannot approve invoice ${invoiceId}: 3-way match has not passed`);
    }
    invoice.status = 'Approved';
    invoice.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.invKey(invoiceId), Buffer.from(JSON.stringify(invoice)));
    ctx.stub.setEvent('InvoiceApproved', Buffer.from(JSON.stringify({ invoice_id: invoiceId })));
    return JSON.stringify(invoice);
  }

  @Transaction()
  async rejectInvoice(ctx: Context, invoiceId: string, reason: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    this.assertInvoiceTransition(invoice.status, 'Closed');
    invoice.status = 'Closed';
    invoice.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.invKey(invoiceId), Buffer.from(JSON.stringify(invoice)));
    ctx.stub.setEvent('InvoiceRejected', Buffer.from(JSON.stringify({ invoice_id: invoiceId, reason: reason ?? '' })));
    return JSON.stringify(invoice);
  }

  @Transaction()
  async disputeInvoice(ctx: Context, invoiceId: string, reason: string): Promise<string> {
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    this.assertInvoiceTransition(invoice.status, 'Disputed');
    invoice.status = 'Disputed';
    invoice.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.invKey(invoiceId), Buffer.from(JSON.stringify(invoice)));
    ctx.stub.setEvent('InvoiceDisputed', Buffer.from(JSON.stringify({ invoice_id: invoiceId, reason: reason ?? '' })));
    return JSON.stringify(invoice);
  }

  // Assign an approved invoice to a lender (invoice discounting / receivables finance).
  // Called cross-chaincode by finance-cc on lock, or directly. Locks against further assignment.
  @Transaction()
  async assignInvoice(ctx: Context, invoiceId: string, lenderId: string): Promise<string> {
    if (!lenderId) throw new Error('lenderId is required');
    const invoice = await this.getInvoiceState(ctx, invoiceId);
    if (invoice.assignment_status === 'Assigned') {
      throw new Error(`Invoice ${invoiceId} is already assigned to ${invoice.assigned_to}`);
    }
    this.assertInvoiceTransition(invoice.status, 'Assigned');
    invoice.status = 'Assigned';
    invoice.assignment_status = 'Assigned';
    invoice.assigned_to = lenderId;
    invoice.updated_at = this.txTimestamp(ctx);
    await ctx.stub.putState(this.invKey(invoiceId), Buffer.from(JSON.stringify(invoice)));
    ctx.stub.setEvent('InvoiceAssigned', Buffer.from(JSON.stringify({ invoice_id: invoiceId, assigned_to: lenderId })));
    return JSON.stringify(invoice);
  }

  @Transaction(false)
  @Returns('string')
  async getInvoice(ctx: Context, invoiceId: string): Promise<string> {
    return JSON.stringify(await this.getInvoiceState(ctx, invoiceId));
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
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
    await ctx.stub.putState(this.poKey(poId), Buffer.from(JSON.stringify(po)));
    ctx.stub.setEvent(event, Buffer.from(JSON.stringify({ po_id: poId, status: to })));
    return JSON.stringify(po);
  }

  private async getPO(ctx: Context, poId: string): Promise<PurchaseOrder> {
    const data = await ctx.stub.getState(this.poKey(poId));
    if (!data || data.length === 0) throw new Error(`Purchase order ${poId} not found`);
    return JSON.parse(data.toString()) as PurchaseOrder;
  }

  private async tryGetPO(ctx: Context, poId: string): Promise<PurchaseOrder | null> {
    const data = await ctx.stub.getState(this.poKey(poId));
    return data && data.length > 0 ? (JSON.parse(data.toString()) as PurchaseOrder) : null;
  }

  private async getGRNState(ctx: Context, grnId: string): Promise<GoodsReceipt> {
    const data = await ctx.stub.getState(this.grnKey(grnId));
    if (!data || data.length === 0) throw new Error(`GRN ${grnId} not found`);
    return JSON.parse(data.toString()) as GoodsReceipt;
  }

  private async tryGetGRN(ctx: Context, grnId: string): Promise<GoodsReceipt | null> {
    const data = await ctx.stub.getState(this.grnKey(grnId));
    return data && data.length > 0 ? (JSON.parse(data.toString()) as GoodsReceipt) : null;
  }

  private async getInvoiceState(ctx: Context, invoiceId: string): Promise<Invoice> {
    const data = await ctx.stub.getState(this.invKey(invoiceId));
    if (!data || data.length === 0) throw new Error(`Invoice ${invoiceId} not found`);
    return JSON.parse(data.toString()) as Invoice;
  }
}
