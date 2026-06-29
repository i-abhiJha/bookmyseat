import { User } from '../models/User.js';
import { redis } from '../config/redis.js';
import { ApiError } from '../utils/ApiError.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from './token.service.js';

const refreshKey = (userId, jti) => `refresh:${userId}:${jti}`;

async function issueTokens(user) {
  const accessToken = signAccessToken({ id: user.id, role: user.role });
  const { token: refreshToken, jti, ttlSeconds } = signRefreshToken({
    id: user.id,
    role: user.role,
  });
  await redis.set(refreshKey(user.id, jti), '1', 'EX', ttlSeconds);
  return { accessToken, refreshToken };
}

export async function register({ name, email, password }) {
  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict('Email already registered');
  }
  const passwordHash = await User.hashPassword(password);
  const user = await User.create({ name, email, passwordHash });
  const tokens = await issueTokens(user);
  return { user, ...tokens };
}

export async function login({ email, password }) {
  const user = await User.findOne({ email });
  // same error for unknown email and wrong password
  if (!user || !(await user.verifyPassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  const tokens = await issueTokens(user);
  return { user, ...tokens };
}

// Rotate: verify the token, consume its jti from Redis, issue a new pair.
// A reused (already-rotated) token has no jti left and is rejected.
export async function refresh(refreshToken) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const { sub: userId, jti } = payload;
  const exists = await redis.del(refreshKey(userId, jti));
  if (exists === 0) {
    throw ApiError.unauthorized('Refresh token has been revoked');
  }

  const user = await User.findById(userId);
  if (!user) {
    throw ApiError.unauthorized('User no longer exists');
  }
  return issueTokens(user);
}

export async function logout(refreshToken) {
  try {
    const { sub: userId, jti } = verifyRefreshToken(refreshToken);
    await redis.del(refreshKey(userId, jti));
  } catch {
    // nothing to revoke
  }
}
