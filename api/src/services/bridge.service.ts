import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getChaincodeEvents } from '../fabric/gateway.js';
import { factoryContract, vaultContract } from '../polygon/escrow.client.js';
import { escrowIdForInvoice, linkInvoiceToEscrow, rebuildInvoiceLinks } from './escrow.service.js';

// The Fabric↔Polygon bridge. Correlation key: escrowPaymentId.
//   Fabric → Polygon: trade-doc-cc 'InvoiceApproved' → flip the Polygon condition → auto-release.
//   Polygon → Fabric: EscrowVault 'FundsReleased' → audit (stubbed until audit-cc, Ring 1).
let started = false;

export function startBridge(): void {
  if (started) return;
  started = true;
  void initLinks();
  void watchFabricInvoiceApproved();
  watchPolygonReleases();
  logger.info('Bridge service started (Fabric↔Polygon)');
}

// Restart-safe correlation: rebuild invoice→escrow links from chain, then keep
// the map live by subscribing to new EscrowInstructionCreated events.
async function initLinks(): Promise<void> {
  try {
    const n = await rebuildInvoiceLinks();
    logger.info({ links: n }, 'Bridge: rebuilt invoice→escrow links from chain');
    factoryContract().on('EscrowInstructionCreated', (escrowPaymentId: string, _beneficiary: string, _amount: bigint, linkedAssetId: string) => {
      linkInvoiceToEscrow(linkedAssetId, escrowPaymentId);
      logger.debug({ linkedAssetId, escrowPaymentId }, 'Bridge: linked new escrow instruction');
    });
  } catch (err) {
    logger.warn({ reason: (err as Error).message }, 'Bridge: could not initialise escrow links');
  }
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
        const escrowId = escrowIdForInvoice(invoiceId);
        if (!escrowId) {
          logger.debug({ invoiceId }, 'Bridge: InvoiceApproved with no linked escrow — ignoring');
          continue;
        }
        await handleInvoiceApproved(escrowId, invoiceId);
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'Bridge: failed handling InvoiceApproved');
      }
    }
  } catch (err) {
    logger.warn({ reason: (err as Error).message }, 'Bridge: Fabric event stream unavailable');
  }
}

// Flip the invoiceApproved condition on Polygon, then release if all conditions hold.
// escrowId is the bytes32 escrowPaymentId.
export async function handleInvoiceApproved(escrowId: string, invoiceId: string): Promise<void> {
  const vault = vaultContract();

  await (await vault.markInvoiceApproved(escrowId)).wait();
  logger.info({ escrowId, invoiceId }, 'Bridge: marked invoiceApproved on Polygon escrow');

  const e = await vault.getEscrow(escrowId);
  // status 2 == Funded; release needs funded + invoiceApproved (Rule-0A + Rule-0B).
  if (Number(e.status) === 2 && e.funded && e.invoiceApproved) {
    await (await vault.release(escrowId)).wait();
    logger.info({ escrowId }, 'Bridge: all conditions met → escrow released');
  } else {
    logger.info({ escrowId, status: Number(e.status), funded: e.funded }, 'Bridge: conditions not yet complete — awaiting funding');
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
