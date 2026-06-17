import { env } from '../config/env.js';
import { invoke, query } from '../fabric/fabric.service.js';
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
export async function createPO(input: CreatePOInput): Promise<PurchaseOrder> {
  return invoke<PurchaseOrder>(cc, 'createPO', JSON.stringify(input));
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
export async function createGRN(grnId: string, poId: string, receivedQty: number): Promise<GoodsReceipt> {
  return invoke<GoodsReceipt>(cc, 'createGRN', grnId, poId, String(receivedQty));
}
export async function acceptGRN(grnId: string): Promise<GoodsReceipt> {
  return invoke<GoodsReceipt>(cc, 'acceptGRN', grnId);
}
export async function getGRN(grnId: string): Promise<GoodsReceipt> {
  return query<GoodsReceipt>(cc, 'getGRN', grnId);
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
export async function submitInvoice(input: SubmitInvoiceInput): Promise<Invoice> {
  return invoke<Invoice>(cc, 'submitInvoice', JSON.stringify(input));
}
export async function runThreeWayMatch(invoiceId: string): Promise<Invoice> {
  return invoke<Invoice>(cc, 'runThreeWayMatch', invoiceId);
}
export async function getInvoice(invoiceId: string): Promise<Invoice> {
  return query<Invoice>(cc, 'getInvoice', invoiceId);
}
export async function approveInvoice(invoiceId: string): Promise<Invoice> {
  return invoke<Invoice>(cc, 'approveInvoice', invoiceId);
}
export async function rejectInvoice(invoiceId: string, reason: string): Promise<Invoice> {
  return invoke<Invoice>(cc, 'rejectInvoice', invoiceId, reason);
}
export async function disputeInvoice(invoiceId: string, reason: string): Promise<Invoice> {
  return invoke<Invoice>(cc, 'disputeInvoice', invoiceId, reason);
}
