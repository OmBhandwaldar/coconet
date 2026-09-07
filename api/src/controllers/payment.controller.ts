import { NextFunction, Request, Response } from 'express';
import * as service from '../services/payment.service.js';

export function initiate(req: Request, res: Response, next: NextFunction): void {
  try {
    const payment = service.initiatePayment(req.body);
    res.status(201).json({ success: true, data: payment, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export function confirm(req: Request, res: Response, next: NextFunction): void {
  try {
    const payment = service.confirmPayment(req.params.id);
    res.json({ success: true, data: payment, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export function get(req: Request, res: Response, next: NextFunction): void {
  try {
    const payment = service.getPayment(req.params.id);
    res.json({ success: true, data: payment, correlationId: req.correlationId });
  } catch (err) { next(err); }
}
