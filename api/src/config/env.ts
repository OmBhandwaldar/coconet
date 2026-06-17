import { config as dotenvConfig } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// env.ts lives at api/src/config/env.ts → project root is three levels up.
const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(here, '..', '..', '..');

// Load .env from project root regardless of where the process was started.
// dotenv does NOT override values already present in process.env, so test setup wins.
dotenvConfig({ path: resolve(PROJECT_ROOT, '.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  MONGO_URI: z.string().url(),

  MINIO_ENDPOINT: z.string().default('localhost'),
  MINIO_PORT: z.coerce.number().default(9000),
  MINIO_ACCESS_KEY: z.string(),
  MINIO_SECRET_KEY: z.string(),
  MINIO_BUCKET_DOCUMENTS: z.string().default('trade-documents'),
  // NOTE: z.coerce.boolean() is a footgun — Boolean("false") === true. Parse the
  // string explicitly so MINIO_USE_SSL=false actually disables TLS.
  MINIO_USE_SSL: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),

  FABRIC_CHANNEL_NAME: z.string().default('buyer-supplier-channel'),
  FABRIC_CHAINCODE_ONBOARDING: z.string().default('onboarding-cc'),
  FABRIC_CHAINCODE_TRADE_DOC: z.string().default('trade-doc-cc'),
  FABRIC_CHAINCODE_FINANCE: z.string().default('finance-cc'),
  FABRIC_CHAINCODE_PROVENANCE: z.string().default('provenance-cc'),
  FABRIC_CHAINCODE_DISPUTE: z.string().default('dispute-cc'),
  FABRIC_CHAINCODE_AUDIT: z.string().default('audit-cc'),
  FABRIC_GATEWAY_PEER_ENDPOINT: z.string().default('localhost:10051'),
  FABRIC_GATEWAY_PEER_HOST_ALIAS: z.string().default('peer0.platform.coconet.local'),
  FABRIC_CRYPTO_PATH: z.string(),
  FABRIC_MSP_ID: z.string().default('PlatformMSP'),
  FABRIC_CERT_PATH: z.string(),
  FABRIC_KEY_DIR_PATH: z.string(),
  FABRIC_TLS_CERT_PATH: z.string(),

  POLYGON_RPC_URL: z.string().url().default('http://localhost:8545'),
  POLYGON_CHAIN_ID: z.coerce.number().default(31337),
  POLYGON_PRIVATE_KEY: z.string(),
  ESCROW_FACTORY_ADDRESS: z.string().default(''),
  ESCROW_VAULT_ADDRESS: z.string().default(''),
  USDC_ADDRESS: z.string().default(''),

  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('8h'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
