// ─── User directory ───────────────────────────────────────────────────────────
// Maps a human to (a) the consortium org they act for, (b) the X.509 wallet
// identity that signs their transactions, and (c) their role for maker-checker.
//
// Fabric CA is the eventual authority here: enrolling a user returns their
// credentials, so this directory becomes a CA lookup rather than a table. Until
// then the mapping is explicit, and production must supply it via AUTH_USERS —
// the dev secrets below are refused outside development (see assertSafe()).
//
// The User1/User2 split per org is deliberate: it mirrors the maker/checker pairs
// in EXAMPLE-FLOW, so Block 5 has two distinct signing identities per org to
// enforce checker != maker against.
import * as crypto from 'crypto';
import { env } from '../config/env.js';
import { ORG_PROFILES, OrgProfile } from './wallet.js';

export type OrgType = 'Buyer' | 'Supplier' | 'Lender' | 'Platform' | 'Auditor';

export interface DirectoryUser {
  username: string;
  displayName: string;
  orgId: string;
  orgType: OrgType;
  orgKey: string;
  /** cryptogen user whose identity signs for this person. */
  walletUser: string;
  /** 'maker' | 'checker' — consumed by Block 5. */
  role: string;
  secretHash: string;
}

const SCRYPT_KEYLEN = 64;

export function hashSecret(secret: string, salt: string): string {
  return `${salt}:${crypto.scryptSync(secret, salt, SCRYPT_KEYLEN).toString('hex')}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [salt, expected] = stored.split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(secret, salt, SCRYPT_KEYLEN).toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Development seed — the cast from EXAMPLE-FLOW. Secrets are '<username>-dev-secret'.
const DEV_SEED: Omit<DirectoryUser, 'secretHash'>[] = [
  { username: 'rajesh',   displayName: 'Rajesh (Procurement Manager)', orgId: 'tata-001',   orgType: 'Buyer',    orgKey: 'buyer',    walletUser: 'User1', role: 'maker' },
  { username: 'priya',    displayName: 'Priya (Senior Procurement Head)', orgId: 'tata-001', orgType: 'Buyer',   orgKey: 'buyer',    walletUser: 'User2', role: 'checker' },
  { username: 'suresh',   displayName: 'Suresh (Sales Director)',      orgId: 'bharat-001', orgType: 'Supplier', orgKey: 'supplier', walletUser: 'User1', role: 'maker' },
  { username: 'kavitha',  displayName: 'Kavitha (Finance Manager)',    orgId: 'bharat-001', orgType: 'Supplier', orgKey: 'supplier', walletUser: 'User2', role: 'checker' },
  { username: 'amit',     displayName: 'Amit (Relationship Manager)',  orgId: 'hdfc-001',   orgType: 'Lender',   orgKey: 'lender',   walletUser: 'User1', role: 'maker' },
  { username: 'nandita',  displayName: 'Nandita (Credit Head)',        orgId: 'hdfc-001',   orgType: 'Lender',   orgKey: 'lender',   walletUser: 'User2', role: 'checker' },
  { username: 'platform', displayName: 'Platform Operator',            orgId: 'platform-001', orgType: 'Platform', orgKey: 'platform', walletUser: 'Admin', role: 'operator' },
  { username: 'auditor',  displayName: 'Consortium Auditor',           orgId: 'auditor-001', orgType: 'Auditor', orgKey: 'auditor',  walletUser: 'User1', role: 'observer' },
];

function buildDirectory(): Map<string, DirectoryUser> {
  const map = new Map<string, DirectoryUser>();

  if (env.AUTH_USERS) {
    // Production shape: [{ username, displayName, orgId, orgType, orgKey,
    // walletUser, role, secretHash }] — secretHash is 'salt:scrypt-hex'.
    const parsed = JSON.parse(env.AUTH_USERS) as DirectoryUser[];
    for (const u of parsed) map.set(u.username, u);
    return map;
  }

  for (const u of DEV_SEED) {
    map.set(u.username, { ...u, secretHash: hashSecret(`${u.username}-dev-secret`, 'coconet-dev') });
  }
  return map;
}

const directory = buildDirectory();

// JWT secrets shipped as placeholders. If one of these is in use, the deployment
// has not been configured, whatever NODE_ENV claims.
const PLACEHOLDER_JWT_SECRETS = new Set([
  'change-me-in-production',
  'test-secret-at-least-16-chars',
]);

/**
 * Refuse to run on well-known development credentials.
 *
 * NODE_ENV defaults to 'development', so keying only on NODE_ENV === 'production'
 * means a deploy that simply forgets to set it comes up with this directory and
 * its published secrets live. The JWT secret is checked as a second, independent
 * signal of an unconfigured deployment.
 */
export function assertSafe(): void {
  if (env.AUTH_USERS) return;

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_USERS must be set in production — refusing to start with the development user directory.',
    );
  }

  if (env.NODE_ENV !== 'test' && !PLACEHOLDER_JWT_SECRETS.has(env.JWT_SECRET)) {
    // A real JWT secret with no user directory means this is not a dev box.
    throw new Error(
      'A non-placeholder JWT_SECRET is set but AUTH_USERS is not. Refusing to start the ' +
      'development user directory (published secrets) against what looks like a real deployment.',
    );
  }
}

export function findUser(username: string): DirectoryUser | undefined {
  return directory.get(username);
}

export function orgProfileFor(user: DirectoryUser): OrgProfile {
  const profile = ORG_PROFILES.find((o) => o.key === user.orgKey);
  if (!profile) throw new Error(`No org profile for key '${user.orgKey}'`);
  return profile;
}

export function listUsernames(): string[] {
  return [...directory.keys()];
}
