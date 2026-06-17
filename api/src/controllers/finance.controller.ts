import { NextFunction, Request, Response } from 'express';
import * as service from '../services/finance.service.js';

export async function createPreShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fr = await service.createPreShipment(req.body);
    res.status(201).json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function createInvoiceDiscounting(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fr = await service.createInvoiceDiscounting(req.body);
    res.status(201).json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function get(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fr = await service.getFinanceRequest(req.params.id);
    res.json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function validateEligibility(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fr = await service.validateEligibility(req.params.id);
    res.json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function submitQuote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fr = await service.submitQuote(req.params.id, req.body);
    res.json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function approve(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fr = await service.approveFinancing(req.params.id, req.body.approved_amount);
    res.json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function accept(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fr = await service.acceptOffer(req.params.id);
    res.json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function disburse(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.body.pre_shipment_request_id) {
      const result = await service.disburseWithNetSettlement(
        req.params.id, req.body.pre_shipment_request_id, req.body.disbursement_ref);
      res.json({ success: true, data: result, correlationId: req.correlationId });
      return;
    }
    const fr = await service.disburseFunds(req.params.id, req.body.disbursement_ref, req.body.net_amount);
    res.json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function repay(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const fr = await service.recordRepayment(req.params.id, req.body.amount, req.body.payment_ref);
    res.json({ success: true, data: fr, correlationId: req.correlationId });
  } catch (err) { next(err); }
}
