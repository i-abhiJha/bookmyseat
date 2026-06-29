import request from 'supertest';
import { createApp } from '../src/app.js';
import { config } from '../src/config/env.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { connectRedis, disconnectRedis, redis } from '../src/config/redis.js';
import { User } from '../src/models/User.js';

// Always run against a *_test database so we never touch dev data.
const testUri = config.mongoUri.replace(/\/[^/]*$/, '/bookmyseat_test');

const app = createApp();

async function clearKeys(pattern) {
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(keys);
}

beforeAll(async () => {
  await connectDb(testUri);
  await connectRedis();
});

afterAll(async () => {
  await disconnectRedis();
  await disconnectDb();
});

beforeEach(async () => {
  await User.deleteMany({});
  await clearKeys('refresh:*');
  await clearKeys('ratelimit:*');
});

const creds = { name: 'Abhishek', email: 'abhi@example.com', password: 'supersecret1' };

describe('POST /api/v1/auth/register', () => {
  it('creates a user and returns tokens, never the password hash', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(creds);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(creds.email);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.refreshToken).toBeDefined();
  });

  it('rejects a duplicate email with 409', async () => {
    await request(app).post('/api/v1/auth/register').send(creds);
    const res = await request(app).post('/api/v1/auth/register').send(creds);
    expect(res.status).toBe(409);
  });

  it('rejects a weak password with 400', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ ...creds, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/validation/i);
  });
});

describe('POST /api/v1/auth/login', () => {
  beforeEach(async () => {
    await request(app).post('/api/v1/auth/register').send(creds);
  });

  it('returns tokens for valid credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: creds.email, password: creds.password });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('returns 401 for a wrong password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: creds.email, password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('rate-limits after 5 attempts (6th -> 429 with Retry-After)', async () => {
    const attempt = () =>
      request(app)
        .post('/api/v1/auth/login')
        .send({ email: creds.email, password: 'wrongpassword' });

    for (let i = 0; i < 5; i++) await attempt();
    const sixth = await attempt();
    expect(sixth.status).toBe(429);
    expect(sixth.headers['retry-after']).toBeDefined();
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the current user with a valid access token', async () => {
    const { body } = await request(app).post('/api/v1/auth/register').send(creds);
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(creds.email);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/refresh (rotation + revocation)', () => {
  it('issues new tokens and invalidates the old refresh token', async () => {
    const { body } = await request(app).post('/api/v1/auth/register').send(creds);
    const oldRefresh = body.refreshToken;

    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).toBeDefined();
    expect(rotated.body.refreshToken).not.toBe(oldRefresh);

    // Reusing the old (already-rotated) refresh token must fail.
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: oldRefresh });
    expect(reuse.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const { body } = await request(app).post('/api/v1/auth/register').send(creds);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: body.refreshToken });
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: body.refreshToken });
    expect(res.status).toBe(401);
  });
});
