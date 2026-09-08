import { ConflictError, NotFoundError, ValidationError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';
import { record, type Actor } from './activity.service.js';
import { generateUtr, isValidIfsc, transferMode, type TransferMode } from '../adapters/bank.adapter.js';

// Off-chain bank settlement rail — the alternative to the on-chain escrow.
// Deliberately NOT on any ledger: this mirrors how a real NEFT/RTGS payment sits
// outside the chain, with only its reference (UTR) available for reconciliation.
// In-memory store (same approach as the activity feed) — a demo deal is short-lived.

export type PaymentStatus = 'Initiated' | 'Credited';

// Which leg of the deal this transfer settles.
export type PaymentPurpose = 'PreShipment' | 'Discounting' | 'Settlement';

const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  PreShipment: 'Pre-shipment disbursement',
  Discounting: 'Discounting payout',
  Settlement: 'Settlement',
};

export interface BankAccount {
  beneficiary_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  branch: string;
}

// How the reference was obtained: through a bank payment-initiation API (we get the
// UTR back), or keyed in by the payer who already paid from their own banking channel.
export type EntryMode = 'api' | 'manual';

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
  mode: TransferMode;
  entry_mode: EntryMode;
  utr: string;
  status: PaymentStatus;
  linked_invoice_id?: string;
  initiated_at: string;
  credited_at?: string;
}

export interface InitiatePaymentInput {
  payment_id: string;
  payer_org_id: string;
  beneficiary_org_id: string;
  beneficiary_name: string;
  account_number: string;
  ifsc: string;
  bank_name: string;
  branch: string;
  amount_inr: number;
  purpose: PaymentPurpose;
  utr?: string; // supplied when the payer already paid elsewhere; generated otherwise
  linked_invoice_id?: string;
}

const payments = new Map<string, BankPayment>();

// Demo consortium roles — who a given org id is, for attributing each transfer.
const ORG_ROLE: Record<string, Actor> = {
  'tata-001': 'Buyer',
  'bharat-001': 'Supplier',
  'hdfc-001': 'Lender',
};
const roleOf = (orgId: string): Actor | null => ORG_ROLE[orgId] ?? null;

// Deal code is the D-XXXX token embedded in linked entity ids (PAY-D-AB12).
function dealFrom(id: string): string | null {
  const m = id.match(/D-[0-9A-Z]+/);
  return m ? m[0] : null;
}

export function initiatePayment(input: InitiatePaymentInput): BankPayment {
  if (payments.has(input.payment_id)) {
    throw new ConflictError(`Payment ${input.payment_id} already exists`);
  }
  const ifsc = input.ifsc.toUpperCase();
  if (!isValidIfsc(ifsc)) {
    throw new ValidationError(`Invalid IFSC "${input.ifsc}" — expected 4 letters, 0, then 6 characters (e.g. HDFC0001234)`);
  }

  const mode = transferMode(input.amount_inr);
  const payment: BankPayment = {
    payment_id: input.payment_id,
    deal: dealFrom(input.payment_id),
    payer_org_id: input.payer_org_id,
    beneficiary_org_id: input.beneficiary_org_id,
    beneficiary_name: input.beneficiary_name,
    account_number: input.account_number,
    ifsc,
    bank_name: input.bank_name,
    branch: input.branch,
    amount_inr: input.amount_inr,
    purpose: input.purpose,
    mode,
    entry_mode: input.utr ? 'manual' : 'api',
    utr: input.utr?.trim().toUpperCase() || generateUtr(ifsc, mode),
    status: 'Initiated',
    linked_invoice_id: input.linked_invoice_id,
    initiated_at: new Date().toISOString(),
  };
  payments.set(payment.payment_id, payment);
  saveBankAccount(input.beneficiary_org_id, {
    beneficiary_name: input.beneficiary_name,
    account_number: input.account_number,
    ifsc,
    bank_name: input.bank_name,
    branch: input.branch,
  }, payment.deal);

  logger.info({ payment_id: payment.payment_id, mode, utr: payment.utr, entry_mode: payment.entry_mode }, 'Bank transfer initiated (mock rail)');
  recordActivity(payment, 'BankTransferInitiated');
  return payment;
}

// Beneficiary confirms the credit — stands in for bank reconciliation / a webhook.
export function confirmPayment(paymentId: string): BankPayment {
  const payment = payments.get(paymentId);
  if (!payment) throw new NotFoundError(`Payment ${paymentId}`);
  if (payment.status === 'Credited') {
    throw new ConflictError(`Payment ${paymentId} is already credited`);
  }
  payment.status = 'Credited';
  payment.credited_at = new Date().toISOString();

  logger.info({ payment_id: paymentId, utr: payment.utr }, 'Bank transfer credited (mock rail)');
  recordActivity(payment, 'BankTransferCredited');
  return payment;
}

export function getPayment(paymentId: string): BankPayment {
  const payment = payments.get(paymentId);
  if (!payment) throw new NotFoundError(`Payment ${paymentId}`);
  return payment;
}

function recordActivity(p: BankPayment, event: string): void {
  record({
    ts: new Date().toISOString(),
    chain: 'bank',
    source: 'bank-rail',
    event,
    label: event === 'BankTransferInitiated'
      ? `${PURPOSE_LABEL[p.purpose]} ${p.entry_mode === 'manual' ? 'recorded' : 'initiated'} · ${p.mode}`
      : `${PURPOSE_LABEL[p.purpose]} credited`,
    entity_id: p.payment_id,
    deal: p.deal,
    tx: p.utr, // the UTR is this rail's equivalent of a transaction reference
    block: null,
    // The payer initiates; the beneficiary confirms the credit.
    actor: event === 'BankTransferInitiated' ? roleOf(p.payer_org_id) : roleOf(p.beneficiary_org_id),
  });
}

// Beneficiary accounts, remembered so a party's details are entered once.
// Scoped per deal: within a deal the second transfer to the same party reuses
// them, but each new deal starts clean. (A production org master would hold
// these once per organization instead.)
const accounts = new Map<string, BankAccount>();

const accountKey = (orgId: string, deal?: string | null) => (deal ? `${deal}:${orgId}` : orgId);

export function saveBankAccount(orgId: string, account: BankAccount, deal?: string | null): BankAccount {
  const stored = { ...account, ifsc: account.ifsc.toUpperCase() };
  if (!isValidIfsc(stored.ifsc)) {
    throw new ValidationError(`Invalid IFSC "${account.ifsc}" — expected 4 letters, 0, then 6 characters (e.g. HDFC0001234)`);
  }
  accounts.set(accountKey(orgId, deal), stored);
  return stored;
}

export function getBankAccount(orgId: string, deal?: string | null): BankAccount | null {
  return accounts.get(accountKey(orgId, deal)) ?? null;
}
