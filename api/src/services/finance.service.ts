import { env } from '../config/env.js';
import { invoke, query } from '../fabric/fabric.service.js';
import { getInvoice } from './trade-doc.service.js';

export type ProductType = 'PreShipment' | 'InvoiceDiscounting';
export type AssetType = 'PO' | 'Invoice';
export type FinanceStatus =
  | 'Requested' | 'Validating' | 'Under Review' | 'Offered' | 'Accepted'
  | 'Disbursed' | 'Repaid' | 'Defaulted' | 'Recovered' | 'Closed';

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
  security_interest_state: 'None' | 'Perfected' | 'Released';
  status: FinanceStatus;
  eligibility?: { passed: boolean; checks: Record<string, boolean>; reasons: string[]; at: string };
  disbursement_ref?: string;
  payment_ref?: string;
  created_at: string;
  updated_at: string;
}

export interface Quote {
  advance_rate?: number;
  discount_rate?: number;
  interest_rate?: number;
  tenor_days?: number;
}

export interface NetSettlement {
  gross_disbursement: number;
  pre_shipment_principal: number;
  accrued_interest: number;
  settled_amount: number;
  net_to_supplier: number;
}

const cc = env.FABRIC_CHAINCODE_FINANCE;

// ─── Create ─────────────────────────────────────────────────────────────────
export interface PreShipmentInput {
  request_id: string; po_id: string; requestor_org_id: string; requested_amount: number; lender_id?: string;
}
export async function createPreShipment(input: PreShipmentInput): Promise<FinanceRequest> {
  const payload = {
    request_id: input.request_id,
    product_type: 'PreShipment' as const,
    asset_type: 'PO' as const,
    asset_id: input.po_id,
    requestor_org_id: input.requestor_org_id,
    requested_amount: input.requested_amount,
    lender_id: input.lender_id,
  };
  return invoke<FinanceRequest>(cc, 'createFinanceRequest', JSON.stringify(payload));
}

export interface InvoiceDiscountingInput {
  request_id: string; invoice_id: string; requestor_org_id: string; requested_amount: number;
  lender_id: string; discount_rate: number;
}
export async function createInvoiceDiscounting(input: InvoiceDiscountingInput): Promise<FinanceRequest> {
  const payload = {
    request_id: input.request_id,
    product_type: 'InvoiceDiscounting' as const,
    asset_type: 'Invoice' as const,
    asset_id: input.invoice_id,
    requestor_org_id: input.requestor_org_id,
    requested_amount: input.requested_amount,
    lender_id: input.lender_id,
    discount_rate: input.discount_rate,
  };
  return invoke<FinanceRequest>(cc, 'createFinanceRequest', JSON.stringify(payload));
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
export async function getFinanceRequest(requestId: string): Promise<FinanceRequest> {
  return query<FinanceRequest>(cc, 'getFinanceRequest', requestId);
}
export async function validateEligibility(requestId: string): Promise<FinanceRequest> {
  return invoke<FinanceRequest>(cc, 'validateEligibility', requestId);
}
export async function submitQuote(requestId: string, quote: Quote): Promise<FinanceRequest> {
  return invoke<FinanceRequest>(cc, 'submitQuote', requestId, JSON.stringify(quote));
}
export async function approveFinancing(requestId: string, approvedAmount: number): Promise<FinanceRequest> {
  return invoke<FinanceRequest>(cc, 'approveFinancing', requestId, String(approvedAmount));
}
export async function acceptOffer(requestId: string): Promise<FinanceRequest> {
  return invoke<FinanceRequest>(cc, 'acceptOffer', requestId);
}
export async function disburseFunds(requestId: string, disbursementRef: string, netAmount?: number): Promise<FinanceRequest> {
  return invoke<FinanceRequest>(cc, 'disburseFunds', requestId, disbursementRef, netAmount === undefined ? '' : String(netAmount));
}
export async function recordRepayment(requestId: string, amount: number, paymentRef: string): Promise<FinanceRequest> {
  return invoke<FinanceRequest>(cc, 'recordRepayment', requestId, String(amount), paymentRef);
}

// ─── Net settlement (service layer, per MVP-PLAN Block 4) ──────────────────────
// At invoice discounting, the lender pays the discounted invoice value but the
// supplier's outstanding pre-shipment loan + interest is deducted first. Interest
// accrues over the agreed tenor (deterministic for the demo; a production build
// would use elapsed days from disbursement).
export function computeNetSettlement(
  invoiceAmount: number,
  discountRate: number,
  preShipmentPrincipal: number,
  interestRate: number,
  tenorDays: number,
): NetSettlement {
  const gross = Math.round(invoiceAmount * (1 - discountRate));
  const interest = Math.round((preShipmentPrincipal * interestRate * tenorDays) / 365);
  const settled = preShipmentPrincipal + interest;
  return {
    gross_disbursement: gross,
    pre_shipment_principal: preShipmentPrincipal,
    accrued_interest: interest,
    settled_amount: settled,
    net_to_supplier: gross - settled,
  };
}

export interface DiscountingDisbursementResult {
  finance_request: FinanceRequest;
  settlement: NetSettlement;
  pre_shipment_request_id: string;
}

// Disburse an accepted invoice-discounting request, auto-settling a linked
// pre-shipment loan and paying the supplier the net.
export async function disburseWithNetSettlement(
  discountingRequestId: string,
  preShipmentRequestId: string,
  disbursementRef: string,
): Promise<DiscountingDisbursementResult> {
  const disc = await getFinanceRequest(discountingRequestId);
  const preShip = await getFinanceRequest(preShipmentRequestId);
  const invoice = await getInvoice(disc.asset_id);

  const settlement = computeNetSettlement(
    invoice.amount,
    disc.discount_rate ?? 0,
    preShip.disbursed_amount ?? 0,
    preShip.interest_rate ?? 0,
    preShip.tenor_days ?? 0,
  );

  // The discounting request's requested_amount is the lender's gross payout; disburseFunds
  // records it as disbursed_amount and the supplier's net as net_disbursed.
  const fr = await disburseFunds(discountingRequestId, disbursementRef, settlement.net_to_supplier);
  // Auto-settle the pre-shipment loan.
  await recordRepayment(preShipmentRequestId, settlement.settled_amount, `NET-SETTLE:${discountingRequestId}`);

  return { finance_request: fr, settlement, pre_shipment_request_id: preShipmentRequestId };
}
