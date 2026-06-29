import { redis } from '../config/redis.js';
import { logger } from './logger.js';

// Cache-aside helpers. All fail open: on a Redis error we fall back to the DB
// instead of throwing. Values are JSON, so pass plain objects (.lean()/.toJSON()).

// Return the cached value, or run producer, cache it, and return.
export async function cacheGetOrSet(key, ttlSeconds, producer) {
  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return { value: JSON.parse(cached), hit: true };
    }
  } catch (err) {
    logger.warn({ err, key }, 'cache read failed');
  }

  const value = await producer();

  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (err) {
    logger.warn({ err, key }, 'cache write failed');
  }
  return { value, hit: false };
}

export async function cacheDel(...keys) {
  if (!keys.length) return;
  try {
    await redis.del(keys);
  } catch (err) {
    logger.warn({ err, keys }, 'cache delete failed');
  }
}

// Delete keys matching a pattern via SCAN (avoids blocking KEYS).
export async function cacheDelPattern(pattern) {
  try {
    const stream = redis.scanStream({ match: pattern, count: 100 });
    const pending = [];
    for await (const keys of stream) {
      if (keys.length) pending.push(redis.del(keys));
    }
    await Promise.all(pending);
  } catch (err) {
    logger.warn({ err, pattern }, 'cache pattern delete failed');
  }
}
