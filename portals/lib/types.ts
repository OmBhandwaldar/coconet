// Shapes mirror the API service interfaces (api/src/services/*).

export interface PurchaseOrder {
  po_id: string;
  buyer_id: string;
  supplier_id: string;
  currency: string;
  gross_value: number;
  quantity: number;
  status: string;
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
  match_result?: { passed: boolean };
}

export interface GRN {
  grn_id: string;
  po_id: string;
  received_qty: number;
  accepted_qty?: number;
  status: string;
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
