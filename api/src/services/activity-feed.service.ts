import type { EventLog } from 'ethers';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getChaincodeEvents } from '../fabric/gateway.js';
import { factoryContract, vaultContract } from '../polygon/escrow.client.js';
import {
  record, linkEscrow, escrowMeta, dealFrom, entityFromFabricPayload, LABELS,
} from './activity.service.js';

// Populates the in-memory activity log from both chains: replays history on start
// (Fabric from block 0, Polygon via queryFilter) then stays live.
let started = false;

export function startActivityFeed(opts: { polygon: boolean }): void {
  if (started) return;
  started = true;
  for (const cc of [env.FABRIC_CHAINCODE_ONBOARDING, env.FABRIC_CHAINCODE_TRADE_DOC, env.FABRIC_CHAINCODE_FINANCE]) {
    void watchChaincode(cc);
  }
  if (opts.polygon) {
    void initPolygon();
  }
  logger.info('Activity feed started (replaying on-chain history)');
}

// ─── Fabric ───────────────────────────────────────────────────────────────────
async function watchChaincode(cc: string): Promise<void> {
  try {
    const events = await getChaincodeEvents(cc, { startBlock: 0n }); // replay + live
    for await (const ev of events) {
      try {
        const payload = ev.payload?.length ? JSON.parse(Buffer.from(ev.payload).toString()) : {};
        const entity = entityFromFabricPayload(payload);
        record({
          ts: new Date().toISOString(),
          chain: 'fabric',
          source: cc,
          event: ev.eventName,
          label: LABELS[ev.eventName] ?? ev.eventName,
          entity_id: entity,
          deal: dealFrom(entity),
          tx: ev.transactionId,
          block: Number(ev.blockNumber),
        });
      } catch {
        /* skip malformed payload */
      }
    }
  } catch (err) {
    logger.warn({ cc, reason: (err as Error).message }, 'Activity: chaincode stream unavailable');
  }
}

// ─── Polygon ────────────────────────────────────────────────────────────────
const VAULT_EVENTS = ['EscrowFunded', 'FundsReleased', 'FundsRefunded'] as const;
const seenPolygon = new Set<string>(); // dedupe backfill vs live by tx#event#logIndex

async function initPolygon(): Promise<void> {
  const factory = factoryContract();
  const vault = vaultContract();
  try {
    // Backfill: instructions first so the escrowId→deal map is populated.
    for (const log of (await factory.queryFilter('EscrowInstructionCreated', 0)) as EventLog[]) {
      recordPolygon('EscrowInstructionCreated', log.args ?? [], log.transactionHash, log.blockNumber, log.index);
    }
    for (const name of VAULT_EVENTS) {
      for (const log of (await vault.queryFilter(name, 0)) as EventLog[]) {
        recordPolygon(name, log.args ?? [], log.transactionHash, log.blockNumber, log.index);
      }
    }
  } catch (err) {
    logger.warn({ reason: (err as Error).message }, 'Activity: Polygon backfill failed');
  }
  // Live.
  factory.on('EscrowInstructionCreated', (...a: unknown[]) => onLive('EscrowInstructionCreated', a));
  for (const name of VAULT_EVENTS) {
    vault.on(name, (...a: unknown[]) => onLive(name, a));
  }
}

function onLive(name: string, cbArgs: unknown[]): void {
  const payload = cbArgs[cbArgs.length - 1] as { args?: unknown[]; log?: { transactionHash?: string; blockNumber?: number; index?: number } };
  const log = payload?.log ?? {};
  recordPolygon(name, payload?.args ?? [], log.transactionHash, log.blockNumber, log.index);
}

function recordPolygon(name: string, args: readonly unknown[], tx?: string, block?: number, logIndex?: number): void {
  const key = `${tx}#${name}#${logIndex}`;
  if (seenPolygon.has(key)) return;
  seenPolygon.add(key);

  const escrowId = String(args[0] ?? '');
  let entity: string | null = null;
  let deal: string | null = null;
  if (name === 'EscrowInstructionCreated') {
    const linked = String(args[3] ?? '');
    linkEscrow(escrowId, linked);
    entity = linked;
    deal = dealFrom(linked);
  } else {
    const meta = escrowMeta(escrowId);
    entity = meta?.entity ?? (escrowId ? `${escrowId.slice(0, 10)}…` : null);
    deal = meta?.deal ?? null;
  }
  record({
    ts: new Date().toISOString(),
    chain: 'polygon',
    source: 'escrow',
    event: name,
    label: LABELS[name] ?? name,
    entity_id: entity,
    deal,
    tx: tx ?? null,
    block: block ?? null,
  });
}
