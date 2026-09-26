import { AsyncLocalStorage } from 'node:async_hooks';
import type { AuthClaims } from './jwt.js';

// ─── Caller identity context ──────────────────────────────────────────────────
// Carries the authenticated caller from the HTTP layer down to the Fabric
// gateway without threading an identity argument through every controller and
// service signature — which would touch ~50 call sites and blur the
// Routes → Controllers → Services → SDK layering the project keeps.
//
// Work that runs outside a request (the bridge, the activity feed, startup
// replay) has no context and falls back to the platform operator identity.
const storage = new AsyncLocalStorage<AuthClaims>();

export function runAs<T>(claims: AuthClaims, fn: () => T): T {
  return storage.run(claims, fn);
}

export function currentCaller(): AuthClaims | undefined {
  return storage.getStore();
}

/** Wallet label for the current caller, or undefined for background work. */
export function currentWalletLabel(): string | undefined {
  return storage.getStore()?.wallet_label;
}
