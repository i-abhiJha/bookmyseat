import Redis from 'ioredis';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

// Shared Redis client (cache, locks, rate limiting). lazyConnect so tests
// control when the connection opens.
export const redis = new Redis(config.redisUrl, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error({ err }, 'Redis error'));

export async function connectRedis() {
  if (redis.status === 'ready' || redis.status === 'connecting') return redis;
  await redis.connect();
  return redis;
}

export async function disconnectRedis() {
  await redis.quit();
}
