import * as fs from 'fs';
import { env } from './env.js';
import { logger } from './logger.js';

// ─── Secret resolution ────────────────────────────────────────────────────────
// A seam between "the code needs a signing key" and "where that key lives".
//
// Resolution order:
//   1. <NAME>_FILE  — a path, as Docker/Kubernetes secrets mount them
//   2. <NAME>       — the environment, for local development
//
// A Vault or KMS client becomes a third resolver here without any caller
// changing. Production signing should move to a KMS or HSM so the key is never
// materialised in the process at all; this class is the place that changes.

// Well-known development keys that must never reach production. The first is
// Hardhat's default account #0 — published in their docs and funded on every
// local node, so anyone who knows it can drain anything it controls.
const PUBLIC_TEST_SECRETS = new Set([
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  'change-me-in-production',
]);

export class SecretError extends Error {}

export function getSecret(name: string, { required = true } = {}): string {
  const fromFile = process.env[`${name}_FILE`];
  let value: string | undefined;

  if (fromFile) {
    try {
      value = fs.readFileSync(fromFile, 'utf8').trim();
    } catch (err) {
      throw new SecretError(`${name}_FILE is set but unreadable: ${(err as Error).message}`);
    }
  } else {
    value = process.env[name];
  }

  if (!value) {
    if (required) throw new SecretError(`Secret ${name} is not configured (set ${name} or ${name}_FILE)`);
    return '';
  }

  if (env.NODE_ENV === 'production') {
    if (PUBLIC_TEST_SECRETS.has(value)) {
      throw new SecretError(
        `${name} is set to a publicly known development value. Refusing to start in production.`,
      );
    }
    if (!fromFile) {
      logger.warn(
        { secret: name },
        'Secret read from the environment in production — prefer a mounted secret file or a KMS/Vault resolver',
      );
    }
  }

  return value;
}
