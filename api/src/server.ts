import { env } from './config/env.js';
import { logger } from './config/logger.js';
import app from './app.js';
import { connectGateway, disconnectGateway } from './fabric/gateway.js';
import { connectPolygon } from './polygon/provider.js';

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

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, fabric: fabricOk, polygon: polygonOk },
      'CocoNet API started',
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...');
    if (fabricOk) {
      try {
        await disconnectGateway();
      } catch (err) {
        logger.warn({ err }, 'Error disconnecting Fabric Gateway');
      }
    }
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.fatal({ err }, 'Bootstrap failed');
  process.exit(1);
});
