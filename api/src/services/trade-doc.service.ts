import { env } from '../config/env.js';
import { invoke, invokeWithTransient, query } from '../fabric/fabric.service.js';
import { newSalt, partyMsps } from '../fabric/private-data.js';
import type { Gated } from './approvals.service.js';
import type { CreatePOInput, SubmitInvoiceInput } from '../validators/trade-doc.validator.ts';

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
  checks: { po_link: boolean; grn_link: boolean; amount_within_po: boolean; qty_within_grn: boolean };
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
  created_at: string;
  updated_at: string;
}

const cc = env.FABRIC_CHAINCODE_TRADE_DOC;

// ─── Purchase Orders ──────────────────────────────────────────────────────────
/**
 * Splits the request the way PRIVACY-DESIGN.md §2.1 requires: identifiers,
 * parties and the document hash go on the channel as arguments; every
 * commercial figure goes to the private collection as transient data, carrying
 * a fresh salt so the public hash of a round figure is not brute-forceable.
 */
export async function createPO(input: CreatePOInput): Promise<PurchaseOrder> {
  const {
    po_id, buyer_id, supplier_id, doc_hash,
    currency, gross_value, item_description, quantity, price_per_unit,
    delivery_terms, payment_terms,
  } = input as CreatePOInput & Record<string, unknown>;

  const party_msps = await partyMsps(buyer_id, supplier_id);
  const index = { po_id, buyer_id, supplier_id, party_msps, doc_hash };
  const payload = {
    currency, gross_value, item_description, quantity, price_per_unit,
    delivery_terms, payment_terms, salt: newSalt(),
  };
  return invokeWithTransient<PurchaseOrder>(cc, 'createPO', [JSON.stringify(index)], payload);
}
/**
 * Draft → Issued, the act that commits the buyer and therefore the act
 * maker-checker gates (BR-09). Above the buyer's PO_ISSUE threshold the first
 * call parks it and returns the pending record; a second user in the buyer's
 * org completes it by calling this again.
 */
export async function issuePO(poId: string): Promise<Gated<PurchaseOrder>> {
  return invoke<Gated<PurchaseOrder>>(cc, 'issuePO', poId);
}
export async function getPurchaseOrder(poId: string): Promise<PurchaseOrder> {
  return query<PurchaseOrder>(cc, 'getPurchaseOrder', poId);
}
export async function acknowledgePO(poId: string, supplierId: string): Promise<PurchaseOrder> {
  return invoke<PurchaseOrder>(cc, 'acknowledgePO', poId, supplierId);
}
export async function amendPO(poId: string, changes: Record<string, unknown>, justification: string): Promise<PurchaseOrder> {
  return invoke<PurchaseOrder>(cc, 'amendPO', poId, JSON.stringify(changes), justification);
}
export async function lockPO(poId: string): Promise<PurchaseOrder> {
  return invoke<PurchaseOrder>(cc, 'lockPO', poId);
}
export async function fulfillPO(poId: string): Promise<PurchaseOrder> {
  return invoke<PurchaseOrder>(cc, 'fulfillPO', poId);
}

// ─── Goods Receipt ──────────────────────────────────────────────────────────
export async function createGRN(grnId: string, poId: string, receivedQty: number, docHash?: string): Promise<GoodsReceipt> {
  // Received quantity is a commercial figure: transient, with its own salt.
  return invokeWithTransient<GoodsReceipt>(
    cc, 'createGRN', [grnId, poId, docHash ?? ''],
    { received_qty: receivedQty, salt: newSalt() },
  );
}
export async function acceptGRN(grnId: string): Promise<Gated<GoodsReceipt>> {
  return invoke<Gated<GoodsReceipt>>(cc, 'acceptGRN', grnId);
}
export async function getGRN(grnId: string): Promise<GoodsReceipt> {
  return query<GoodsReceipt>(cc, 'getGRN', grnId);
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
export async function submitInvoice(input: SubmitInvoiceInput): Promise<Invoice> {
  const {
    invoice_id, supplier_id, buyer_id, po_id, grn_id, doc_hash,
    amount, quantity, currency, due_date,
  } = input as SubmitInvoiceInput & Record<string, unknown>;

  const index = { invoice_id, supplier_id, buyer_id, po_id, grn_id, doc_hash };
  const payload = { amount, quantity, currency: currency ?? 'INR', due_date, salt: newSalt() };
  return invokeWithTransient<Invoice>(cc, 'submitInvoice', [JSON.stringify(index)], payload);
}
export async function runThreeWayMatch(invoiceId: string): Promise<Invoice> {
  return invoke<Invoice>(cc, 'runThreeWayMatch', invoiceId);
}
export async function reviseInvoice(invoiceId: string, amount: number, quantity: number, docHash?: string): Promise<Invoice> {
  return invokeWithTransient<Invoice>(
    cc, 'reviseInvoice', [invoiceId, docHash ?? ''],
    { amount, quantity, salt: newSalt() },
  );
}
export async function getInvoice(invoiceId: string): Promise<Invoice> {
  return query<Invoice>(cc, 'getInvoice', invoiceId);
}
export async function approveInvoice(invoiceId: string): Promise<Gated<Invoice>> {
  return invoke<Gated<Invoice>>(cc, 'approveInvoice', invoiceId);
}
export async function rejectInvoice(invoiceId: string, reason: string): Promise<Invoice> {
  return invoke<Invoice>(cc, 'rejectInvoice', invoiceId, reason);
}
export async function disputeInvoice(invoiceId: string, reason: string): Promise<Invoice> {
  return invoke<Invoice>(cc, 'disputeInvoice', invoiceId, reason);
}
