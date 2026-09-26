import { NextFunction, Request, Response } from 'express';
import { findUser, verifySecret } from '../auth/users.js';
import { issueToken } from '../auth/jwt.js';
import { UnauthorizedError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username, secret } = req.body ?? {};
    const user = typeof username === 'string' ? findUser(username) : undefined;

    // One message and one code path for both "no such user" and "wrong secret",
    // so the endpoint cannot be used to enumerate valid usernames.
    const ok = !!user && typeof secret === 'string' && verifySecret(secret, user.secretHash);
    if (!ok) {
      logger.warn({ username, correlationId: req.correlationId }, 'Failed login attempt');
      throw new UnauthorizedError('Invalid credentials');
    }

    const { token, claims } = issueToken(user);
    logger.info({ username: claims.sub, org: claims.org_id, correlationId: req.correlationId }, 'Login');
    res.json({
      success: true,
      data: {
        token,
        user: {
          username: claims.sub,
          display_name: user.displayName,
          org_id: claims.org_id,
          org_type: claims.org_type,
          msp_id: claims.msp_id,
          role: claims.role,
        },
      },
      correlationId: req.correlationId,
    });
  } catch (err) { next(err); }
}

export async function me(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({
      success: true,
      data: {
        username: req.auth!.sub,
        org_id: req.auth!.org_id,
        org_type: req.auth!.org_type,
        msp_id: req.auth!.msp_id,
        wallet_label: req.auth!.wallet_label,
        role: req.auth!.role,
      },
      correlationId: req.correlationId,
    });
  } catch (err) { next(err); }
}
