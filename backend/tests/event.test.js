import request from 'supertest';
import { createApp } from '../src/app.js';
import {
  connectAll,
  disconnectAll,
  resetDb,
  registerUser,
  registerAdmin,
  createPublishedEvent,
} from './helpers.js';

const app = createApp();

const eventPayload = () => ({
  title: 'Coldplay — Music of the Spheres',
  venue: 'Stadium',
  startsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  sections: [
    { name: 'VIP', rows: 2, seatsPerRow: 5, tier: 'VIP', price: 5000 }, // 10
    { name: 'GENERAL', rows: 4, seatsPerRow: 10, tier: 'STANDARD', price: 1000 }, // 40
  ],
});

const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(connectAll);
afterAll(disconnectAll);
beforeEach(resetDb);

describe('POST /api/v1/events (RBAC)', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/api/v1/events').send(eventPayload());
    expect(res.status).toBe(401);
  });

  it('rejects non-admin users with 403', async () => {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/events')
      .set(auth(user.accessToken))
      .send(eventPayload());
    expect(res.status).toBe(403);
  });

  it('lets an admin create an event with generated seats (DRAFT)', async () => {
    const admin = await registerAdmin(app);
    const res = await request(app)
      .post('/api/v1/events')
      .set(auth(admin.accessToken))
      .send(eventPayload());

    expect(res.status).toBe(201);
    expect(res.body.event.status).toBe('DRAFT');
    expect(res.body.event.totalSeats).toBe(50);
    expect(res.body.event.availableSeats).toBe(50);

    // Seats were actually generated.
    const seatMap = await request(app).get(`/api/v1/events/${res.body.event._id}/seats`);
    expect(seatMap.status).toBe(200);
    expect(seatMap.body.seats).toHaveLength(50);
    expect(seatMap.body.summary).toEqual({ AVAILABLE: 50, HELD: 0, BOOKED: 0 });
  });
});

describe('event validation', () => {
  let token;
  beforeEach(async () => {
    token = (await registerAdmin(app)).accessToken;
  });

  it('rejects duplicate section names with 400', async () => {
    const payload = eventPayload();
    payload.sections[1].name = 'VIP';
    const res = await request(app).post('/api/v1/events').set(auth(token)).send(payload);
    expect(res.status).toBe(400);
  });

  it('rejects a start date in the past with 400', async () => {
    const payload = eventPayload();
    payload.startsAt = new Date(Date.now() - 1000).toISOString();
    const res = await request(app).post('/api/v1/events').set(auth(token)).send(payload);
    expect(res.status).toBe(400);
  });
});

describe('publish + public listing', () => {
  it('hides DRAFT events from the public list and shows them once PUBLISHED', async () => {
    const admin = await registerAdmin(app);
    const created = await request(app)
      .post('/api/v1/events')
      .set(auth(admin.accessToken))
      .send(eventPayload());
    const id = created.body.event._id;

    // DRAFT — not listed publicly.
    let list = await request(app).get('/api/v1/events');
    expect(list.body.total).toBe(0);

    // Publish.
    const pub = await request(app)
      .patch(`/api/v1/events/${id}/publish`)
      .set(auth(admin.accessToken));
    expect(pub.status).toBe(200);
    expect(pub.body.event.status).toBe('PUBLISHED');

    // Now listed.
    list = await request(app).get('/api/v1/events');
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]._id).toBe(id);

    // Re-publishing a non-DRAFT event is a 409.
    const again = await request(app)
      .patch(`/api/v1/events/${id}/publish`)
      .set(auth(admin.accessToken));
    expect(again.status).toBe(409);
  });

  it('returns 404 for an unknown event', async () => {
    const res = await request(app).get('/api/v1/events/64b7f0f0f0f0f0f0f0f0f0f0');
    expect(res.status).toBe(404);
  });
});

describe('cache-aside (X-Cache header + invalidation)', () => {
  it('serves the event list from cache on the second call (MISS then HIT)', async () => {
    await createPublishedEvent(app);

    const first = await request(app).get('/api/v1/events');
    expect(first.headers['x-cache']).toBe('MISS');

    const second = await request(app).get('/api/v1/events');
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body.total).toBe(first.body.total);
  });

  it('serves event detail from cache on the second call', async () => {
    const { event } = await createPublishedEvent(app);

    const first = await request(app).get(`/api/v1/events/${event._id}`);
    expect(first.headers['x-cache']).toBe('MISS');

    const second = await request(app).get(`/api/v1/events/${event._id}`);
    expect(second.headers['x-cache']).toBe('HIT');
    expect(second.body.event._id).toBe(event._id);
  });

  it('invalidates the list cache when a new event is published', async () => {
    await createPublishedEvent(app); // event A (published)

    // Warm the list cache.
    const warm = await request(app).get('/api/v1/events');
    expect(warm.body.total).toBe(1);
    expect((await request(app).get('/api/v1/events')).headers['x-cache']).toBe('HIT');

    // Publishing event B must invalidate the cached list.
    await createPublishedEvent(app); // event B (published)

    const afterPublish = await request(app).get('/api/v1/events');
    expect(afterPublish.headers['x-cache']).toBe('MISS'); // cache was invalidated
    expect(afterPublish.body.total).toBe(2); // and reflects the new event
  });
});
