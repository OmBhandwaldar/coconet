import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../errors/AppError.js';

// ─── Role-based access control ────────────────────────────────────────────────
// Permissions follow the org's type, which onboarding-cc already records. The
// point is structural: a supplier must not be able to raise a purchase order
// against itself, and an auditor must not be able to write at all.
//
// Platform is allowed through every guard — it is the operator identity the
// bridge and reconciliation jobs run as.

export type OrgType = 'Buyer' | 'Supplier' | 'Lender' | 'Platform' | 'Auditor';

export function requireOrgType(...allowed: OrgType[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) { next(new UnauthorizedError('Authentication required')); return; }
    const orgType = req.auth.org_type as OrgType;
    if (orgType === 'Platform' || allowed.includes(orgType)) { next(); return; }
    next(new ForbiddenError(
      `${orgType} is not permitted to perform this action (requires ${allowed.join(' or ')})`,
    ));
  };
}

/**
 * The auditor has observer access by charter (BRD: auditor-channel is read-only),
 * so it is blocked from every mutating verb globally rather than route by route —
 * a new write endpoint is then safe by default.
 */
export function enforceReadOnlyForObservers(req: Request, _res: Response, next: NextFunction): void {
  if (req.auth?.org_type === 'Auditor' && req.method !== 'GET' && req.method !== 'HEAD') {
    next(new ForbiddenError('Auditor access is read-only'));
    return;
  }
  next();
}
