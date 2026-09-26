import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { DirectoryUser } from './users.js';
import { orgProfileFor } from './users.js';

// What every authenticated request carries. `walletLabel` is the wallet entry
// whose X.509 identity signs this user's Fabric transactions — which is what
// makes a ledger entry attributable to a person rather than to Platform Admin.
export interface AuthClaims {
  sub: string;
  org_id: string;
  org_type: string;
  msp_id: string;
  wallet_label: string;
  role: string;
}

export function issueToken(user: DirectoryUser): { token: string; claims: AuthClaims } {
  const profile = orgProfileFor(user);
  const claims: AuthClaims = {
    sub: user.username,
    org_id: user.orgId,
    org_type: user.orgType,
    msp_id: profile.mspId,
    wallet_label: `${user.walletUser}@${user.orgKey}`,
    role: user.role,
  };
  const token = jwt.sign(claims, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: 'coconet-api',
  } as jwt.SignOptions);
  return { token, claims };
}

export function verifyToken(token: string): AuthClaims {
  return jwt.verify(token, env.JWT_SECRET, { issuer: 'coconet-api' }) as AuthClaims;
}
