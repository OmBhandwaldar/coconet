import { NextFunction, Request, Response } from 'express';
import * as bridge from '../services/bridge.service.js';
import { getInvoice } from '../services/trade-doc.service.js';
import { bridgeHandle, bridgeStore } from '../bridge/runtime.js';
import { AppError, ValidationError } from '../errors/AppError.js';

// ─── Bridge operations (NEW-PLAN Block 6) ────────────────────────────────────
// A dead letter nobody can see is the same as a dropped event. These endpoints
// exist so the durable state the bridge now keeps is reachable by an operator
// rather than only by reading the database by hand.

function requireStore() {
  const store = bridgeStore();
  if (!store) {
    throw new AppError(503, 'The bridge is not running in this process', 'BRIDGE_UNAVAILABLE');
  }
  return store;
}

export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data = await bridge.bridgeStatus(requireStore(), bridgeHandle() ?? undefined);
    res.json({ success: true, data, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function deadLetters(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 500);
    const data = await requireStore().listDeadLetters(limit);
    res.json({ success: true, data, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

/**
 * Reopen a dead letter. The retry loop picks it up on its next sweep and
 * re-executes it from the payload stored with the entry, so this does not
 * depend on the Fabric stream redelivering the event.
 */
export async function reopen(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const key = req.body?.key;
    if (typeof key !== 'string' || !key) throw new ValidationError('key is required');
    const reopened = await requireStore().reopenDeadLetter(key);
    if (!reopened) throw new AppError(404, `No dead letter for key '${key}'`, 'NOT_FOUND');
    res.json({ success: true, data: { key, status: 'reopened' }, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

/**
 * Run reconciliation on demand.
 *
 * It reads invoice status through the normal service, so it sees exactly what a
 * caller would — a drift report built from a privileged back door would not
 * prove the two chains agree as the platform actually reads them.
 */
export async function reconcile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const drift = await bridge.reconcile(async (invoiceId) => {
      const invoice = await getInvoice(invoiceId);
      return invoice?.status ?? 'Unknown';
    });
    res.json({
      success: true,
      data: { in_sync: drift.length === 0, drift },
      correlationId: req.correlationId,
    });
  } catch (err) { next(err); }
}
