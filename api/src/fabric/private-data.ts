import * as crypto from 'crypto';
import { query } from './fabric.service.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// ─── Private payload plumbing (PRIVACY-DESIGN.md §2.2, §3.3) ─────────────────

/**
 * 128 bits from a CSPRNG, one per private item.
 *
 * Fabric publishes a hash of every private value to every peer on the channel.
 * A discount rate has a few hundred plausible values and invoice amounts are
 * usually round, so without a salt a non-party can recover the figure by hashing
 * candidates until one matches. One fresh salt per item — reusing it across a
 * deal's items lets one cracked value unlock the rest.
 */
export function newSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

// org_id -> MSP id, from onboarding-cc. Membership changes rarely and a wrong
// answer fails closed in chaincode, so a process-lifetime cache is enough.
const mspCache = new Map<string, string>();

export async function mspForOrg(orgId: string): Promise<string> {
  const cached = mspCache.get(orgId);
  if (cached) return cached;

  const org = await query<{ msp_id?: string }>(
    env.FABRIC_CHAINCODE_ONBOARDING, 'getOrganization', orgId,
  );
  if (!org?.msp_id) throw new Error(`Organization ${orgId} has no msp_id registered`);
  mspCache.set(orgId, org.msp_id);
  return org.msp_id;
}

/**
 * The MSPs entitled to a deal's payload. Platform is always included — it is
 * party to every deal and custodies the canonical copy (§2.2.1).
 */
export async function partyMsps(...orgIds: (string | undefined)[]): Promise<string[]> {
  const ids = orgIds.filter((o): o is string => !!o);
  const msps = await Promise.all(ids.map(mspForOrg));
  const set = new Set(msps);
  set.add(env.FABRIC_MSP_ID);
  const result = [...set];
  logger.debug({ orgIds: ids, party_msps: result }, 'Resolved deal parties');
  return result;
}
