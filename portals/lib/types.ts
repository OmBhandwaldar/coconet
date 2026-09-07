// Shapes mirror the API service interfaces (api/src/services/*).

export interface PurchaseOrder {
  po_id: string;
  buyer_id: string;
  supplier_id: string;
  currency: string;
  gross_value: number;
  quantity: number;
  status: string;
  price_per_unit?: number;
  item_description?: string;
  delivery_terms?: string;
  payment_terms?: string;
  doc_hash?: string;
  created_at?: string;
}

export interface Invoice {
  invoice_id: string;
  supplier_id: string;
  buyer_id: string;
  po_id: string;
  grn_id: string;
  amount: number;
  quantity: number;
  status: string;
  assignment_status?: string;
  assigned_to?: string;
  match_result?: { passed: boolean; reasons?: string[] };
  due_date?: string;
  doc_hash?: string;
  created_at?: string;
}

export interface GRN {
  grn_id: string;
  po_id: string;
  received_qty: number;
  accepted_qty?: number;
  doc_hash?: string;
  status: string;
  created_at?: string;
}

export interface FinanceRequest {
  request_id: string;
  product_type: 'PreShipment' | 'InvoiceDiscounting';
  asset_type: 'PO' | 'Invoice';
  asset_id: string;
  requestor_org_id: string;
  lender_id?: string;
  requested_amount: number;
  approved_amount?: number;
  disbursed_amount?: number;
  net_disbursed?: number;
  advance_rate?: number;
  interest_rate?: number;
  tenor_days?: number;
  discount_rate?: number;
  security_interest_state: string;
  status: string;
  eligibility?: { passed: boolean };
}

export interface Escrow {
  escrow_payment_id: string;
  buyer: string;
  beneficiary: string;
  amount_usd: number;
  linked_asset_id: string;
  funded: boolean;
  invoice_approved: boolean;
  status: string; // None | Created | Funded | Released | Refunded
}

export interface Settlement {
  gross_disbursement: number;
  pre_shipment_principal: number;
  accrued_interest: number;
  settled_amount: number;
  net_to_supplier: number;
}

export interface ActivityEntry {
  seq: number;
  ts: string;
  chain: 'fabric' | 'polygon' | 'bank';
  source: string;
  event: string;
  label: string;
  actor: 'Buyer' | 'Supplier' | 'Lender' | 'Platform' | 'System' | null;
  entity_id: string | null;
  deal: string | null;
  tx: string | null;
  block: number | null;
}

export type PaymentPurpose = 'PreShipment' | 'Discounting' | 'Settlement';

export interface BankAccount {
  beneficiary_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  branch: string;
}

export interface BankPayment {
  payment_id: string;
  deal: string | null;
  payer_org_id: string;
  beneficiary_org_id: string;
  beneficiary_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  branch: string;
  amount_inr: number;
  purpose: PaymentPurpose;
  mode: 'NEFT' | 'RTGS';
  entry_mode: 'api' | 'manual';
  utr: string;
  status: 'Initiated' | 'Credited';
  linked_invoice_id?: string;
  initiated_at: string;
  credited_at?: string;
}
