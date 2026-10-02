import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectGateway, disconnectGateway } from './fabric/gateway.js';
import { connectPolygon } from './polygon/provider.js';
import { openBridgeStore } from './bridge/index.js';
import { startBridge } from './services/bridge.service.js';

// ─── Bridge worker ────────────────────────────────────────────────────────────
// The bridge as its own process (NEW-PLAN Block 6 HA).
//
// Inside the API it scaled with the API: every replica ran its own bridge, all
// of them watching the same events and racing to release the same escrow. The
// lease fixes the correctness of that, but the shape is still wrong — the bridge
// is a singleton background worker and the API is a horizontally scaled request
// handler, and they want different replica counts and different restart
// behaviour.
//
// Run this instead of letting the API start a bridge:
//   npm run worker        (and leave BRIDGE_IN_API unset in the API's env)
//
// Several workers may run at once. Exactly one holds the lease and processes;
// the rest stand by and take over within the TTL if it dies. That is the point of
// running more than one.

async function main(): Promise<void> {
  if (!env.ESCROW_VAULT_ADDRESS) {
    throw new Error('ESCROW_VAULT_ADDRESS is not set — the bridge has no escrow vault to drive');
  }

  await connectGateway();
  await connectPolygon();
  const store = await openBridgeStore();
  const bridge = startBridge(store);

  logger.info({ owner: bridge.owner }, 'Bridge worker started');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Bridge worker shutting down');

    const forced = setTimeout(() => {
      logger.warn('Bridge worker drain timed out — forcing exit');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    // Resign first: a standby takes over in seconds rather than waiting out the
    // lease TTL. Then drop the connections the handlers were using.
    await bridge.stop();
    await store.close();
    try {
      await disconnectGateway();
    } catch (err) {
      logger.warn({ err }, 'Error disconnecting Fabric Gateway');
    }

    clearTimeout(forced);
    logger.info('Bridge worker stopped');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, 'Bridge worker failed to start');
  process.exit(1);
});
