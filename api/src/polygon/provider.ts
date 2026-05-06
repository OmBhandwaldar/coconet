import { ethers, JsonRpcProvider, Wallet } from 'ethers';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

let provider: JsonRpcProvider | null = null;
let signer: Wallet | null = null;

export async function connectPolygon(): Promise<void> {
  provider = new ethers.JsonRpcProvider(env.POLYGON_RPC_URL, env.POLYGON_CHAIN_ID);
  signer = new ethers.Wallet(env.POLYGON_PRIVATE_KEY, provider);
  const blockNumber = await provider.getBlockNumber();
  logger.info({ blockNumber, chainId: env.POLYGON_CHAIN_ID }, 'Polygon provider connected');
}

export function getProvider(): JsonRpcProvider {
  if (!provider) throw new Error('Polygon provider not connected. Call connectPolygon() first.');
  return provider;
}

export function getSigner(): Wallet {
  if (!signer) throw new Error('Polygon signer not ready. Call connectPolygon() first.');
  return signer;
}
