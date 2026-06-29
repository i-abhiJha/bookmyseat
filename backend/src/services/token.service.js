import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { config } from '../config/env.js';

// Short-lived stateless access token + long-lived refresh token. The refresh
// token's jti is tracked in Redis so it can be revoked and rotated.
export function signAccessToken({ id, role }) {
  return jwt.sign({ role }, config.jwt.accessSecret, {
    subject: String(id),
    expiresIn: config.jwt.accessTtl,
  });
}

export function signRefreshToken({ id, role }) {
  const jti = randomUUID();
  const token = jwt.sign({ role, jti }, config.jwt.refreshSecret, {
    subject: String(id),
    expiresIn: config.jwt.refreshTtl,
  });
  // seconds to expiry, used as the Redis key TTL
  const { exp } = jwt.decode(token);
  const ttlSeconds = exp - Math.floor(Date.now() / 1000);
  return { token, jti, ttlSeconds };
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}
