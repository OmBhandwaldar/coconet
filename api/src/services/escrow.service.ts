import { id as keccakId } from 'ethers';
import { env } from '../config/env.js';
import { evmAddressFor } from '../config/evm-accounts.js';
import { factoryContract, usdcContract, vaultContract } from '../polygon/escrow.client.js';

const USDC_DECIMALS = 1_000_000n; // 6 decimals
const STATUS = ['None', 'Created', 'Funded', 'Released', 'Refunded'] as const;

export interface EscrowView {
  escrow_payment_id: string;
  buyer: string;
  beneficiary: string;
  token: string;
  amount_usd: number;
  linked_asset_id: string;
  funded: boolean;
  invoice_approved: boolean;
  status: (typeof STATUS)[number];
}

export interface CreateInstructionInput {
  escrow_payment_id: string;   // human label, e.g. "ESC-BS-INV-2024-1102"
  buyer_org_id: string;
  beneficiary_org_id: string;
  linked_invoice_id: string;
  amount_usd: number;          // whole USD; converted to 6-decimal USDC base units
  expiry_at?: number;
}

// invoiceId → escrowPaymentId (bytes32). Used by the bridge to correlate a Fabric
// InvoiceApproved event to a Polygon escrow. The chain is the source of truth:
// rebuilt from the factory's EscrowInstructionCreated events on bridge start and
// kept live, so the correlation survives API restarts (no separate datastore).
const invoiceToEscrowId = new Map<string, string>();

export function escrowIdForInvoice(invoiceId: string): string | undefined {
  return invoiceToEscrowId.get(invoiceId);
}

export function linkInvoiceToEscrow(invoiceId: string, escrowId: string): void {
  invoiceToEscrowId.set(invoiceId, escrowId);
}

// bytes32 escrowPaymentId derived deterministically from the human label.
export function escrowIdBytes(label: string): string {
  return keccakId(label);
}

// Rebuild invoice→escrow links from the factory's past EscrowInstructionCreated
// events (restart-safe; chain is authoritative). Returns the number of links loaded.
export async function rebuildInvoiceLinks(): Promise<number> {
  const events = await factoryContract().queryFilter('EscrowInstructionCreated');
  let n = 0;
  for (const ev of events) {
    const args = (ev as { args?: { linkedAssetId: string; escrowPaymentId: string } }).args;
    if (!args) continue;
    invoiceToEscrowId.set(args.linkedAssetId, args.escrowPaymentId);
    n++;
  }
  return n;
}

export async function createInstruction(input: CreateInstructionInput): Promise<EscrowView> {
  const idB = escrowIdBytes(input.escrow_payment_id);
  const buyer = evmAddressFor(input.buyer_org_id);
  const beneficiary = evmAddressFor(input.beneficiary_org_id);
  const amount = BigInt(input.amount_usd) * USDC_DECIMALS;

  const tx = await factoryContract().createEscrowInstruction(
    idB, buyer, beneficiary, env.USDC_ADDRESS, amount, input.linked_invoice_id, BigInt(input.expiry_at ?? 0),
  );
  await tx.wait();

  linkInvoiceToEscrow(input.linked_invoice_id, idB);
  return getEscrow(input.escrow_payment_id);
}

export async function fund(escrowPaymentId: string): Promise<EscrowView> {
  const idB = escrowIdBytes(escrowPaymentId);
  const inst = await factoryContract().getEscrowInstruction(idB);
  const amount: bigint = inst.amount;

  await (await usdcContract().approve(env.ESCROW_VAULT_ADDRESS, amount)).wait();
  await (await vaultContract().fundEscrow(idB)).wait();
  return getEscrow(escrowPaymentId);
}

// Rule-0C: refund the buyer before release (cancel / dispute priority).
export async function refund(escrowPaymentId: string): Promise<EscrowView> {
  await (await vaultContract().refund(escrowIdBytes(escrowPaymentId))).wait();
  return getEscrow(escrowPaymentId);
}

export async function getEscrow(escrowPaymentId: string): Promise<EscrowView> {
  const e = await vaultContract().getEscrow(escrowIdBytes(escrowPaymentId));
  return {
    escrow_payment_id: escrowPaymentId,
    buyer: e.buyer,
    beneficiary: e.beneficiary,
    token: e.token,
    amount_usd: Number(e.amount / USDC_DECIMALS),
    linked_asset_id: e.linkedAssetId,
    funded: e.funded,
    invoice_approved: e.invoiceApproved,
    status: STATUS[Number(e.status)] ?? 'None',
  };
}

// USDC balance (in whole USD) of an address — used to verify release moved value.
export async function usdcBalance(address: string): Promise<number> {
  const bal: bigint = await usdcContract().balanceOf(address);
  return Number(bal / USDC_DECIMALS);
}
