import { ethers, JsonRpcProvider, NonceManager, Wallet } from 'ethers';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let provider: JsonRpcProvider | null = null;
// A single shared NonceManager so the platform signer's nonces stay sequential
// across the many txs the API/bridge send (escrow create, approve, fund, release).
// Without it, back-to-back txs collide ("nonce too low / already used").
let signer: NonceManager | null = null;

export async function connectPolygon(): Promise<void> {
  provider = new ethers.JsonRpcProvider(env.POLYGON_RPC_URL, env.POLYGON_CHAIN_ID);
  signer = new NonceManager(new Wallet(env.POLYGON_PRIVATE_KEY, provider));
  const blockNumber = await provider.getBlockNumber();
  logger.info({ blockNumber, chainId: env.POLYGON_CHAIN_ID }, 'Polygon provider connected');
}

export function getProvider(): JsonRpcProvider {
  if (!provider) throw new Error('Polygon provider not connected. Call connectPolygon() first.');
  return provider;
}

export function getSigner(): NonceManager {
  if (!signer) throw new Error('Polygon signer not ready. Call connectPolygon() first.');
  return signer;
}
