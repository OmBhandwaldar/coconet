// ─── Network identity wallet ──────────────────────────────────────────────────
// The seam between "who is this user" and "which X.509 identity signs their
// transactions on Fabric".
//
// Today entries are read from the cryptogen material in fabric-network/crypto-config
// (Admin / User1 / User2 per org). Fabric CA replaces the SOURCE of these entries —
// enroll() returns a cert instead of reading one off disk — without changing this
// interface, the auth middleware, RBAC or the gateway. That swap is the remaining
// half of Block 3; see NEW-PLAN.md.
import * as fs from 'fs';
import * as path from 'path';
import { env, PROJECT_ROOT } from '../config/env.js';

export interface NetworkIdentity {
  /** Wallet label — stable, and what a JWT carries. */
  label: string;
  /** Fabric MSP the transaction endorses under. */
  mspId: string;
  /** Consortium org id, as registered in onboarding-cc. */
  orgId: string;
  certificate: Buffer;
  privateKeyPem: Buffer;
}

export interface OrgProfile {
  /** Short key used in wallet labels, e.g. 'buyer'. */
  key: string;
  /** Fabric MSP id, e.g. 'BuyerMSP'. */
  mspId: string;
  /** cryptogen domain, e.g. 'buyer.coconet.local'. */
  domain: string;
}

// The five consortium orgs, mirroring fabric-network/config/configtx.yaml.
export const ORG_PROFILES: OrgProfile[] = [
  { key: 'buyer', mspId: 'BuyerMSP', domain: 'buyer.coconet.local' },
  { key: 'supplier', mspId: 'SupplierMSP', domain: 'supplier.coconet.local' },
  { key: 'lender', mspId: 'LenderMSP', domain: 'lender.coconet.local' },
  { key: 'platform', mspId: 'PlatformMSP', domain: 'platform.coconet.local' },
  { key: 'auditor', mspId: 'AuditorMSP', domain: 'auditor.coconet.local' },
];

export function orgProfileByMsp(mspId: string): OrgProfile | undefined {
  return ORG_PROFILES.find((o) => o.mspId === mspId);
}

function resolvePath(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
}

function readSingleFile(dir: string): Buffer {
  const files = fs.readdirSync(dir);
  if (files.length === 0) throw new Error(`No file found in ${dir}`);
  return fs.readFileSync(path.join(dir, files[0]));
}

/**
 * Load the X.509 identity for `user` (e.g. 'User1', 'Admin') in `org`.
 * Throws if the material is absent — callers decide whether that is fatal.
 */
export function loadIdentity(org: OrgProfile, user: string, orgId: string): NetworkIdentity {
  const base = path.join(
    resolvePath(env.FABRIC_CRYPTO_PATH),
    'peerOrganizations',
    org.domain,
    'users',
    `${user}@${org.domain}`,
    'msp',
  );
  return {
    label: `${user}@${org.key}`,
    mspId: org.mspId,
    orgId,
    certificate: readSingleFile(path.join(base, 'signcerts')),
    privateKeyPem: readSingleFile(path.join(base, 'keystore')),
  };
}

export function identityExists(org: OrgProfile, user: string): boolean {
  const dir = path.join(
    resolvePath(env.FABRIC_CRYPTO_PATH),
    'peerOrganizations',
    org.domain,
    'users',
    `${user}@${org.domain}`,
    'msp',
    'signcerts',
  );
  try {
    return fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}
