import { Request, Response, NextFunction } from 'express';
import { verifyToken, type AuthClaims } from '../auth/jwt.js';
import { UnauthorizedError } from '../errors/AppError.js';

/**
 * Verifies the bearer token and attaches the caller's identity to the request.
 * Everything downstream — RBAC, and the Fabric identity that signs the
 * transaction — reads from req.auth.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Authentication required'));
    return;
  }
  try {
    req.auth = verifyToken(header.slice('Bearer '.length).trim());
    next();
  } catch {
    // Expired, wrong issuer, bad signature, malformed — all the same to a caller.
    next(new UnauthorizedError('Invalid or expired token'));
  }
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }
  }
}
