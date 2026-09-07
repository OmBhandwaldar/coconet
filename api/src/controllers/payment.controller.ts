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

export function getAccount(req: Request, res: Response, next: NextFunction): void {
  try {
    const account = service.getBankAccount(req.params.orgId);
    res.json({ success: true, data: account, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export function saveAccount(req: Request, res: Response, next: NextFunction): void {
  try {
    const account = service.saveBankAccount(req.params.orgId, req.body);
    res.json({ success: true, data: account, correlationId: req.correlationId });
  } catch (err) { next(err); }
}
