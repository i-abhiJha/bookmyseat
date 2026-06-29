import dotenv from 'dotenv';

dotenv.config();

// Throws at boot if a required env var is missing.
function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),

  mongoUri: required('MONGO_URI', 'mongodb://localhost:27017/bookmyseat'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },

  holdTtlSeconds: Number(process.env.HOLD_TTL_SECONDS ?? 300), // seat hold duration

  logLevel:
    process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
};

export const isProd = config.env === 'production';
