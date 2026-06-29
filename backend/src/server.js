import { createApp } from './app.js';
import { config } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import { startHoldSweeper } from './jobs/holdSweeper.js';
import { logger } from './utils/logger.js';

async function start() {
  await connectDb();
  await connectRedis();

  const sweeper = startHoldSweeper();

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`BookMySeat API listening on :${config.port} [${config.env}]`);
  });

  const shutdown = async (signal) => {
    logger.warn(`${signal} received, shutting down`);
    clearInterval(sweeper);
    server.close(async () => {
      await disconnectRedis().catch(() => {});
      await disconnectDb().catch(() => {});
      logger.info('Shutdown complete');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref(); // force exit if drain hangs
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
