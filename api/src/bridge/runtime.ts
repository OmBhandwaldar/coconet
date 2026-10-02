import type { BridgeHandle } from '../services/bridge.service.js';
import type { BridgeStore } from './store.js';

// ─── Bridge runtime handles ───────────────────────────────────────────────────
// The store and the lease handle are created during bootstrap, and the HTTP
// layer needs to read them. They live here rather than in server.ts so a
// controller can reach them without importing the server and starting it as a
// side effect of being imported — which is also what makes the routes testable.
let store: BridgeStore | null = null;
let handle: BridgeHandle | null = null;

export function setBridgeRuntime(s: BridgeStore | null, h: BridgeHandle | null): void {
  store = s;
  handle = h;
}

export function bridgeStore(): BridgeStore | null { return store; }
export function bridgeHandle(): BridgeHandle | null { return handle; }
