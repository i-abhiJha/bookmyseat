import request from 'supertest';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { connectRedis, disconnectRedis, redis } from '../src/config/redis.js';
import { config } from '../src/config/env.js';
import { User } from '../src/models/User.js';
import { Event } from '../src/models/Event.js';
import { Seat } from '../src/models/Seat.js';
import { Booking } from '../src/models/Booking.js';
import { signAccessToken } from '../src/services/token.service.js';

// Always run against a *_test database so we never touch dev data.
export const testUri = config.mongoUri.replace(/\/[^/]*$/, '/bookmyseat_test');

export async function connectAll() {
  await connectDb(testUri);
  await connectRedis();
}

export async function disconnectAll() {
  await disconnectRedis();
  await disconnectDb();
}

async function clearKeys(pattern) {
  const keys = await redis.keys(pattern);
  if (keys.length) await redis.del(keys);
}

export async function resetDb() {
  await Promise.all([
    User.deleteMany({}),
    Event.deleteMany({}),
    Seat.deleteMany({}),
    Booking.deleteMany({}),
  ]);
  await clearKeys('refresh:*');
  await clearKeys('ratelimit:*');
  await clearKeys('cache:*');
}

/** Register a normal user and return { user, accessToken, refreshToken }. */
export async function registerUser(app, overrides = {}) {
  const creds = {
    name: 'Test User',
    email: `user_${Date.now()}_${Math.random().toString(36).slice(2)}@ex.com`,
    password: 'supersecret1',
    ...overrides,
  };
  const res = await request(app).post('/api/v1/auth/register').send(creds);
  return res.body;
}

/**
 * Create an admin: register, promote to admin in the DB, then log in again so
 * the freshly issued access token carries role 'admin'.
 */
export async function registerAdmin(app) {
  const email = `admin_${Date.now()}@ex.com`;
  const password = 'supersecret1';
  await request(app).post('/api/v1/auth/register').send({ name: 'Admin', email, password });
  await User.updateOne({ email }, { role: 'admin' });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body; // { user (role admin), accessToken, refreshToken }
}

/**
 * Create N users cheaply (one bcrypt hash shared, tokens signed directly) and
 * return [{ user, accessToken }]. Used by the concurrency test so the timing
 * reflects the DB race, not 30 password hashes.
 */
export async function createUsersFast(n) {
  const passwordHash = await User.hashPassword('supersecret1');
  const stamp = Date.now();
  const docs = Array.from({ length: n }, (_, i) => ({
    name: `Fast ${i}`,
    email: `fast_${stamp}_${i}@ex.com`,
    passwordHash,
  }));
  const users = await User.insertMany(docs);
  return users.map((u) => ({
    user: { _id: u.id },
    accessToken: signAccessToken({ id: u.id, role: u.role }),
  }));
}

/**
 * Create + publish an event and return { event, seats }. `seats` is the full
 * seat-map array (each with _id, label, section, price, status).
 */
export async function createPublishedEvent(app, sections) {
  const admin = await registerAdmin(app);
  const auth = { Authorization: `Bearer ${admin.accessToken}` };
  const payload = {
    title: 'Test Event',
    venue: 'Test Arena',
    startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    sections: sections ?? [{ name: 'GA', rows: 2, seatsPerRow: 5, tier: 'STANDARD', price: 500 }],
  };
  const created = await request(app).post('/api/v1/events').set(auth).send(payload);
  const event = created.body.event;
  await request(app).patch(`/api/v1/events/${event._id}/publish`).set(auth);
  const map = await request(app).get(`/api/v1/events/${event._id}/seats`);
  return { event, seats: map.body.seats };
}
