import { logger } from '../config/logger.js';

// ─── Backoff ──────────────────────────────────────────────────────────────────
// Retries are spaced because the failures worth retrying are transient and
// shared: an RPC node that is down is down for every pending delivery at once.
// Retrying them all immediately and in lockstep is how a brief outage becomes a
// thundering herd the moment it clears — hence the jitter, which is not decoration.

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  /** Fraction of the delay to randomise, 0–1. */
  jitter?: number;
}

export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 1_000;
  const max = opts.maxMs ?? 60_000;
  const jitter = opts.jitter ?? 0.3;
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const spread = exponential * jitter;
  // Centred on the exponential value, so the mean delay is the intended one.
  const delay = exponential - spread / 2 + Math.random() * spread;
  return Math.round(Math.max(0, Math.min(max, delay)));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an operation in-process, for the short-lived failures worth absorbing
 * before the durable inbox gets involved — one flaky RPC call, not a chain that
 * is down. Anything that outlives this becomes a stored failure and is retried
 * across restarts instead, which is the part that must not depend on this
 * process staying alive.
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  { attempts = 3, label = 'operation', ...backoff }: BackoffOptions & { attempts?: number; label?: string } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastError = err;
      if (attempt === attempts) break;
      const delay = backoffDelay(attempt, backoff);
      logger.warn(
        { label, attempt, attempts, delayMs: delay, err: (err as Error).message },
        'Bridge: retrying after failure',
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
