import { Contract } from '@hyperledger/fabric-gateway';
import { FabricError } from '../errors/AppError.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { getContract } from './gateway.js';

const decoder = new TextDecoder('utf-8');

// Parse chaincode response. Chaincode returns JSON strings, primitives, or empty buffers.
function parseResult(bytes: Uint8Array): unknown {
  if (bytes.length === 0) return null;
  const text = decoder.decode(bytes);
  try {
    return JSON.parse(text);
  } catch {
    // Chaincode returned a plain string (not JSON). Pass it through.
    return text;
  }
}

async function withContract<T>(
  ccName: string,
  fn: string,
  op: (contract: Contract) => Promise<Uint8Array>,
): Promise<T> {
  const contract = getContract(ccName);
  try {
    const bytes = await op(contract);
    return parseResult(bytes) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ chaincode: ccName, fn, err: message }, 'Fabric call failed');
    throw new FabricError(ccName, fn, message, err);
  }
}

// Submit a transaction (state-changing). Goes through endorse → order → commit.
export async function invoke<T = unknown>(
  ccName: string,
  fn: string,
  ...args: string[]
): Promise<T> {
  logger.debug({ chaincode: ccName, fn, args }, 'Fabric invoke');
  return withContract<T>(ccName, fn, (c) => c.submitTransaction(fn, ...args));
}

/**
 * Submit with a transient payload — commercial figures travel here, never as
 * arguments, so they do not appear in the transaction proposal that endorsers
 * and the orderer see (PRIVACY-DESIGN.md §2.2).
 *
 * The payload is deliberately absent from the debug log below; logging it would
 * undo the point of sending it out of band.
 *
 * `endorsingOrganizations` is required, not optional. The gateway will not
 * disclose transient data to peers outside its own organisation, so a buyer's
 * submission would otherwise fail with "no endorsers found in the gateway's
 * organization". The canonical payload lives in the platform org's implicit
 * collection (PRIVACY-DESIGN.md §2.2.1), and only that org can endorse a write
 * to it — so the platform MSP is named explicitly.
 */
export async function invokeWithTransient<T = unknown>(
  ccName: string,
  fn: string,
  args: string[],
  transient: Record<string, unknown>,
): Promise<T> {
  logger.debug({ chaincode: ccName, fn, args }, 'Fabric invoke (with transient payload)');
  return withContract<T>(ccName, fn, (c) =>
    c.submit(fn, {
      arguments: args,
      transientData: { payload: Buffer.from(JSON.stringify(transient)) },
      endorsingOrganizations: [env.FABRIC_MSP_ID],
    }),
  );
}

// Evaluate a query (read-only). Hits one peer, no consensus.
export async function query<T = unknown>(
  ccName: string,
  fn: string,
  ...args: string[]
): Promise<T> {
  logger.debug({ chaincode: ccName, fn, args }, 'Fabric query');
  return withContract<T>(ccName, fn, (c) => c.evaluateTransaction(fn, ...args));
}
