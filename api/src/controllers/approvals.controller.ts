import { NextFunction, Request, Response } from 'express';
import * as service from '../services/approvals.service.js';
import { Gated, isPending } from '../services/approvals.service.js';

/**
 * Answer a gated transition. A parked one is 202 Accepted — the request was
 * valid and recorded, and a second signature will complete it. Returning 200
 * with the unchanged entity would tell the client the transition had happened.
 */
export function respondGated<T>(req: Request, res: Response, result: Gated<T>, okStatus = 200): void {
  if (isPending(result)) {
    res.status(202).json({
      success: true,
      data: result.pending_approval,
      pending_approval: true,
      correlationId: req.correlationId,
    });
    return;
  }
  res.status(okStatus).json({ success: true, data: result, correlationId: req.correlationId });
}

export async function listPending(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = typeof req.query.org_id === 'string' ? req.query.org_id : undefined;
    const approvals = await service.listPending(orgId);
    res.json({ success: true, data: approvals, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function getApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const approval = await service.getApproval(req.params.txType, req.params.entityId);
    res.json({ success: true, data: approval, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function rejectApproval(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const approval = await service.rejectApproval(
      req.params.txType, req.params.entityId, req.body.reason,
    );
    res.json({ success: true, data: approval, correlationId: req.correlationId });
  } catch (err) { next(err); }
}
