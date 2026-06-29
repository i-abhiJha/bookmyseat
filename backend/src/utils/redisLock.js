import { randomUUID } from 'crypto';
import { redis } from '../config/redis.js';
import { ApiError } from './ApiError.js';

// Simple Redis lock. Acquire with SET NX PX; release with a Lua script that
// only deletes the key when the token matches (so we don't drop someone
// else's lock after ours expired).
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
else
  return 0
end`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function acquireLock(key, ttlMs = 5000, { retries = 25, retryDelayMs = 40 } = {}) {
  const token = randomUUID();
  for (let i = 0; i <= retries; i++) {
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') return token;
    await sleep(retryDelayMs);
  }
  return null;
}

export async function releaseLock(key, token) {
  try {
    await redis.eval(RELEASE_SCRIPT, 1, key, token);
  } catch {
    // best-effort; the TTL frees the lock anyway
  }
}

export async function withLock(key, ttlMs, fn) {
  const token = await acquireLock(key, ttlMs);
  if (!token) {
    throw ApiError.conflict('Resource is busy, please retry');
  }
  try {
    return await fn();
  } finally {
    await releaseLock(key, token);
  }
}
