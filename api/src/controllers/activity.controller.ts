import { NextFunction, Request, Response } from 'express';
import { list } from '../services/activity.service.js';

export function getActivity(req: Request, res: Response, next: NextFunction): void {
  try {
    const deal = typeof req.query.deal === 'string' && req.query.deal ? req.query.deal : undefined;
    const after = req.query.after != null ? Number(req.query.after) : undefined;
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const data = list({ deal, after: Number.isFinite(after as number) ? after : undefined, limit });
    res.json({ success: true, data, correlationId: req.correlationId });
  } catch (err) {
    next(err);
  }
}
