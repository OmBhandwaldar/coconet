import { env } from './config/env.js';
import { logger } from './config/logger.js';
import app from './app.js';
import { connectGateway, disconnectGateway } from './fabric/gateway.js';
import { connectPolygon } from './polygon/provider.js';
import { startBridge } from './services/bridge.service.js';
import { startActivityFeed } from './services/activity-feed.service.js';

async function tryConnectFabric(): Promise<boolean> {
  try {
    await connectGateway();
    return true;
  } catch (err) {
    logger.warn(
      { reason: (err as Error).message },
      'Fabric Gateway not available — API will start without chain connectivity. ' +
        'Run scripts/generate-artifacts.ps1, docker compose up, then scripts/setup-channel.ps1 to enable.',
    );
    return false;
  }
}

async function tryConnectPolygon(): Promise<boolean> {
  try {
    await connectPolygon();
    return true;
  } catch (err) {
    logger.warn(
      { reason: (err as Error).message },
      'Polygon provider not available — API will start without chain connectivity. ' +
        'Ensure the Hardhat container is up at ' + env.POLYGON_RPC_URL + '.',
    );
    return false;
  }
}

async function bootstrap(): Promise<void> {
  const [fabricOk, polygonOk] = await Promise.all([tryConnectFabric(), tryConnectPolygon()]);

  // Cross-chain bridge needs both chains; skip if either is down (API still serves).
  if (fabricOk && polygonOk && env.ESCROW_VAULT_ADDRESS) {
    try {
      startBridge();
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Bridge failed to start');
    }
  }

  // Activity feed needs Fabric for chaincode events; Polygon events included when available.
  if (fabricOk) {
    try {
      startActivityFeed({ polygon: polygonOk && !!env.ESCROW_VAULT_ADDRESS });
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'Activity feed failed to start');
    }
  }

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, fabric: fabricOk, polygon: polygonOk },
      'CocoNet API started',
    );
  });

  // Drain in the right order: stop accepting connections, let in-flight requests
  // finish, and only then drop the chain connections they may still be using.
  // Disconnecting Fabric first (as this did) fails any request mid-transaction.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down — draining in-flight requests...');

    const forced = setTimeout(() => {
      logger.warn({ timeoutMs: env.SHUTDOWN_TIMEOUT_MS }, 'Drain timed out — forcing exit');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    forced.unref();

    await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info('Server closed to new connections');

    if (fabricOk) {
      try {
        await disconnectGateway();
      } catch (err) {
        logger.warn({ err }, 'Error disconnecting Fabric Gateway');
      }
    }

    clearTimeout(forced);
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Bootstrap failed');
  process.exit(1);
});
