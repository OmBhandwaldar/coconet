import { NextFunction, Request, Response } from 'express';
import * as service from '../services/onboarding.service.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await service.createOrganization(req.body);
    res.status(201).json({ success: true, data: org, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function read(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await service.getOrganization(req.params.id);
    res.json({ success: true, data: org, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await service.updateOrganizationStatus(req.params.id, req.body.status);
    res.json({ success: true, data: org, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function assignRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await service.assignRole(req.params.id, req.body.role);
    res.json({ success: true, data: org, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function setRiskTier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await service.setRiskTier(req.params.id, req.body.risk_tier);
    res.json({ success: true, data: org, correlationId: req.correlationId });
  } catch (err) { next(err); }
}
