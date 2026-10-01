import { NextFunction, Request, Response } from 'express';
import * as service from '../services/onboarding.service.js';

export async function create(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await service.createOrganization(req.body);
    res.status(201).json({ success: true, data: org, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

// Two fields on an organisation are not network-wide facts: risk_tier is the
// platform's credit judgement of that member, and maker_checker_thresholds says
// how large a transaction it approves on one signature.
//
// Block 4 moved both into the private collection, so onboarding-cc is now the
// boundary and this is defence in depth rather than the control itself — the
// chaincode will not return them to a caller who is neither the platform nor
// the organisation concerned.
function redactOrg(org: Record<string, unknown>, viewerOrgId?: string, viewerOrgType?: string) {
  const privileged = viewerOrgType === 'Platform' || viewerOrgId === org.org_id;
  if (privileged) return org;
  const { risk_tier, maker_checker_thresholds, ...rest } = org;
  return rest;
}

export async function read(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await service.getOrganization(req.params.id);
    res.json({
      success: true,
      data: redactOrg(org as unknown as Record<string, unknown>, req.auth?.org_id, req.auth?.org_type),
      correlationId: req.correlationId,
    });
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

export async function setMakerCheckerThreshold(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await service.setMakerCheckerThreshold(req.params.id, req.params.txType, req.body.threshold);
    res.json({ success: true, data: org, correlationId: req.correlationId });
  } catch (err) { next(err); }
}

export async function getMakerCheckerThreshold(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.getMakerCheckerThreshold(req.params.id, req.params.txType);
    res.json({ success: true, data: result, correlationId: req.correlationId });
  } catch (err) { next(err); }
}
