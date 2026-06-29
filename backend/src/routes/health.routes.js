import { Router } from 'express';
import mongoose from 'mongoose';
import { redis } from '../config/redis.js';

const router = Router();

// liveness
router.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// readiness — checks dependencies
router.get('/readyz', async (_req, res) => {
  const mongoUp = mongoose.connection.readyState === 1;
  let redisUp = false;
  try {
    redisUp = (await redis.ping()) === 'PONG';
  } catch {
    redisUp = false;
  }

  const ready = mongoUp && redisUp;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'degraded',
    dependencies: { mongo: mongoUp, redis: redisUp },
  });
});

export default router;
