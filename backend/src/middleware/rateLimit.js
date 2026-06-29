import { redis } from '../config/redis.js';
import { logger } from '../utils/logger.js';
import { ApiError } from '../utils/ApiError.js';

// Fixed-window rate limiter (Redis INCR + EXPIRE), keyed per IP.
// Fails open: if Redis is down the request is allowed through.
export function rateLimit({ keyPrefix, max, windowSeconds }) {
  return async (req, res, next) => {
    const key = `ratelimit:${keyPrefix}:${req.ip}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, windowSeconds);
      }

      const remaining = Math.max(0, max - count);
      res.set('X-RateLimit-Limit', String(max));
      res.set('X-RateLimit-Remaining', String(remaining));

      if (count > max) {
        const ttl = await redis.ttl(key);
        res.set('Retry-After', String(ttl > 0 ? ttl : windowSeconds));
        return next(ApiError.tooManyRequests('Too many requests, slow down'));
      }
      return next();
    } catch (err) {
      logger.warn({ err }, 'rate limiter unavailable, allowing request');
      return next();
    }
  };
}
