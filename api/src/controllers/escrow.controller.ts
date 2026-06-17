import { NextFunction, Request, Response } from 'express';
import * as service from '../services/escrow.service.js';

export async function createInstruction(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const escrow = await service.createInstruction(req.body);
    res.status(201).json({ success: true, data: escrow, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const escrow = await service.getEscrow(req.params.id);
    res.json({ success: true, data: escrow, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function fund(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const escrow = await service.fund(req.params.id);
    res.json({ success: true, data: escrow, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function refund(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const escrow = await service.refund(req.params.id);
    res.json({ success: true, data: escrow, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function status(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const escrow = await service.getEscrow(req.params.id);
    res.json({ success: true, data: { escrow_payment_id: escrow.escrow_payment_id, status: escrow.status, funded: escrow.funded, invoice_approved: escrow.invoice_approved }, correlationId: req.correlationId });
  } catch (err) { next(err); }
}
