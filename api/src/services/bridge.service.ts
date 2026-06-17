import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getChaincodeEvents } from '../fabric/gateway.js';
import { vaultContract } from '../polygon/escrow.client.js';
import { escrowForInvoice, escrowIdBytes } from './escrow.service.js';

// The Fabric↔Polygon bridge. Correlation key: escrowPaymentId.
//   Fabric → Polygon: trade-doc-cc 'InvoiceApproved' → flip the Polygon condition → auto-release.
//   Polygon → Fabric: EscrowVault 'FundsReleased' → audit (stubbed until audit-cc, Ring 1).
let started = false;

export function startBridge(): void {
  if (started) return;
  started = true;
  void watchFabricInvoiceApproved();
  watchPolygonReleases();
  logger.info('Bridge service started (Fabric↔Polygon)');
}

// ─── Fabric → Polygon ─────────────────────────────────────────────────────────
async function watchFabricInvoiceApproved(): Promise<void> {
  try {
    const events = await getChaincodeEvents(env.FABRIC_CHAINCODE_TRADE_DOC);
    for await (const event of events) {
      if (event.eventName !== 'InvoiceApproved') continue;
      try {
        const payload = JSON.parse(Buffer.from(event.payload).toString());
        const invoiceId: string = payload.invoice_id;
        const escrowLabel = escrowForInvoice(invoiceId);
        if (!escrowLabel) {
          logger.debug({ invoiceId }, 'Bridge: InvoiceApproved with no linked escrow — ignoring');
          continue;
        }
        await handleInvoiceApproved(escrowLabel, invoiceId);
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'Bridge: failed handling InvoiceApproved');
      }
    }
  } catch (err) {
    logger.warn({ reason: (err as Error).message }, 'Bridge: Fabric event stream unavailable');
  }
}

// Flip the invoiceApproved condition on Polygon, then release if all conditions hold.
export async function handleInvoiceApproved(escrowLabel: string, invoiceId: string): Promise<void> {
  const idB = escrowIdBytes(escrowLabel);
  const vault = vaultContract();

  await (await vault.markInvoiceApproved(idB)).wait();
  logger.info({ escrowLabel, invoiceId }, 'Bridge: marked invoiceApproved on Polygon escrow');

  const e = await vault.getEscrow(idB);
  // status 2 == Funded; release needs funded + invoiceApproved (Rule-0A + Rule-0B).
  if (Number(e.status) === 2 && e.funded && e.invoiceApproved) {
    await (await vault.release(idB)).wait();
    logger.info({ escrowLabel }, 'Bridge: all conditions met → escrow released');
  } else {
    logger.info({ escrowLabel, status: Number(e.status), funded: e.funded }, 'Bridge: conditions not yet complete — awaiting funding');
  }
}

// ─── Polygon → Fabric ─────────────────────────────────────────────────────────
function watchPolygonReleases(): void {
  const vault = vaultContract();
  vault.on('FundsReleased', (escrowPaymentId: string, beneficiary: string, amount: bigint) => {
    // Stub audit write — audit-cc arrives in Ring 1. For now, log the settlement.
    logger.info(
      { escrowPaymentId, beneficiary, amount: amount.toString() },
      'Bridge: FundsReleased on Polygon → audit (stub)',
    );
  });
}
