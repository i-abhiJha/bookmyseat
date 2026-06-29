import request from 'supertest';
import { createApp } from '../src/app.js';
import { Seat } from '../src/models/Seat.js';
import { Booking } from '../src/models/Booking.js';
import { Event } from '../src/models/Event.js';
import { sweepExpiredHolds } from '../src/services/reservation.service.js';
import {
  connectAll,
  disconnectAll,
  resetDb,
  registerUser,
  createUsersFast,
  createPublishedEvent,
} from './helpers.js';

const app = createApp();
const auth = (token) => ({ Authorization: `Bearer ${token}` });

beforeAll(connectAll);
afterAll(disconnectAll);
beforeEach(resetDb);

describe('POST /api/v1/bookings/hold', () => {
  it('holds available seats and creates a PENDING booking', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const user = await registerUser(app);

    const res = await request(app)
      .post('/api/v1/bookings/hold')
      .set(auth(user.accessToken))
      .send({ eventId: event._id, seatIds: [seats[0]._id, seats[1]._id] });

    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('PENDING');
    expect(res.body.booking.totalAmount).toBe(1000); // 2 x 500
    expect(res.body.booking.seats).toHaveLength(2);

    // Seats are now HELD and availableSeats decremented.
    const held = await Seat.find({ _id: { $in: [seats[0]._id, seats[1]._id] } });
    expect(held.every((s) => s.status === 'HELD')).toBe(true);
    const ev = await Event.findById(event._id);
    expect(ev.availableSeats).toBe(event.totalSeats - 2);
  });

  it('rejects holding an already-held seat with 409 (no partial hold)', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const u1 = await registerUser(app);
    const u2 = await registerUser(app);

    await request(app)
      .post('/api/v1/bookings/hold')
      .set(auth(u1.accessToken))
      .send({ eventId: event._id, seatIds: [seats[0]._id] });

    // u2 wants two seats, one of which (seats[0]) is taken → all-or-nothing.
    const res = await request(app)
      .post('/api/v1/bookings/hold')
      .set(auth(u2.accessToken))
      .send({ eventId: event._id, seatIds: [seats[1]._id, seats[0]._id] });

    expect(res.status).toBe(409);
    // seats[1] must NOT have been left HELD by the failed attempt.
    const seat1 = await Seat.findById(seats[1]._id);
    expect(seat1.status).toBe('AVAILABLE');
  });

  it('is idempotent: same idempotencyKey returns the same booking', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const user = await registerUser(app);
    const body = { eventId: event._id, seatIds: [seats[0]._id], idempotencyKey: 'checkout-123' };

    const first = await request(app).post('/api/v1/bookings/hold').set(auth(user.accessToken)).send(body);
    const second = await request(app).post('/api/v1/bookings/hold').set(auth(user.accessToken)).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200); // existing booking, not newly created
    expect(second.body.booking._id).toBe(first.body.booking._id);

    // Only ONE booking and only ONE seat held.
    expect(await Booking.countDocuments({ user: user.user._id })).toBe(1);
    expect(await Seat.countDocuments({ event: event._id, status: 'HELD' })).toBe(1);
  });

  // ★ The headline test: prove the atomic guarantee under contention.
  it('never double-books a seat under concurrent requests (exactly one winner)', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const target = seats[0]._id;

    const N = 30;
    const users = await createUsersFast(N);

    // Fire N holds at the SAME seat at the same time.
    const results = await Promise.all(
      users.map((u, i) =>
        request(app)
          .post('/api/v1/bookings/hold')
          .set(auth(u.accessToken))
          .send({ eventId: event._id, seatIds: [target], idempotencyKey: `concurrent-key-${i}` })
      )
    );

    const wins = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);

    expect(wins).toHaveLength(1);
    expect(conflicts).toHaveLength(N - 1);

    // Exactly one booking exists for that seat, and the seat is HELD once.
    expect(await Booking.countDocuments({ seats: target })).toBe(1);
    const seat = await Seat.findById(target);
    expect(seat.status).toBe('HELD');
  });
});

describe('release + expiry', () => {
  it('lets a user release their hold and frees the seats', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const user = await registerUser(app);
    const held = await request(app)
      .post('/api/v1/bookings/hold')
      .set(auth(user.accessToken))
      .send({ eventId: event._id, seatIds: [seats[0]._id] });

    const res = await request(app)
      .post(`/api/v1/bookings/${held.body.booking._id}/release`)
      .set(auth(user.accessToken));

    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('CANCELLED');
    const seat = await Seat.findById(seats[0]._id);
    expect(seat.status).toBe('AVAILABLE');
    const ev = await Event.findById(event._id);
    expect(ev.availableSeats).toBe(event.totalSeats);
  });

  it('sweeper expires stale holds and releases their seats', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const user = await registerUser(app);
    const held = await request(app)
      .post('/api/v1/bookings/hold')
      .set(auth(user.accessToken))
      .send({ eventId: event._id, seatIds: [seats[0]._id] });

    // Force the hold to look expired.
    const past = new Date(Date.now() - 60_000);
    await Booking.updateOne({ _id: held.body.booking._id }, { expiresAt: past });

    const expired = await sweepExpiredHolds();
    expect(expired).toBe(1);

    const booking = await Booking.findById(held.body.booking._id);
    expect(booking.status).toBe('EXPIRED');
    const seat = await Seat.findById(seats[0]._id);
    expect(seat.status).toBe('AVAILABLE');
    const ev = await Event.findById(event._id);
    expect(ev.availableSeats).toBe(event.totalSeats);
  });
});

describe('POST /api/v1/bookings/:id/confirm (checkout)', () => {
  // Helper: register a user and hold one seat; returns { user, booking, seatId }.
  async function holdOneSeat(app, event, seats) {
    const user = await registerUser(app);
    const res = await request(app)
      .post('/api/v1/bookings/hold')
      .set(auth(user.accessToken))
      .send({ eventId: event._id, seatIds: [seats[0]._id] });
    return { user, booking: res.body.booking, seatId: seats[0]._id };
  }

  it('confirms a held booking: seats BOOKED, booking CONFIRMED, payment ref set', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const { user, booking } = await holdOneSeat(app, event, seats);

    const res = await request(app)
      .post(`/api/v1/bookings/${booking._id}/confirm`)
      .set(auth(user.accessToken))
      .send({ paymentMethod: 'card' });

    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('CONFIRMED');
    expect(res.body.booking.paymentRef).toMatch(/^pay_/);

    const seat = await Seat.findById(seats[0]._id);
    expect(seat.status).toBe('BOOKED');
    expect(String(seat.bookedBy)).toBe(String(user.user._id));

    // Booked seat stays unavailable (availableSeats was already decremented at hold).
    const ev = await Event.findById(event._id);
    expect(ev.availableSeats).toBe(event.totalSeats - 1);
  });

  it('is idempotent: re-confirming returns 200 and does not re-charge', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const { user, booking } = await holdOneSeat(app, event, seats);

    const first = await request(app)
      .post(`/api/v1/bookings/${booking._id}/confirm`)
      .set(auth(user.accessToken))
      .send({});
    const second = await request(app)
      .post(`/api/v1/bookings/${booking._id}/confirm`)
      .set(auth(user.accessToken))
      .send({});

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    // Same payment reference => not charged again.
    expect(second.body.booking.paymentRef).toBe(first.body.booking.paymentRef);
  });

  it('returns 402 on a declined card and leaves the hold intact', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const { user, booking } = await holdOneSeat(app, event, seats);

    const res = await request(app)
      .post(`/api/v1/bookings/${booking._id}/confirm`)
      .set(auth(user.accessToken))
      .send({ paymentMethod: 'declined-card' });

    expect(res.status).toBe(402);
    const b = await Booking.findById(booking._id);
    expect(b.status).toBe('PENDING'); // still held, user can retry
    const seat = await Seat.findById(seats[0]._id);
    expect(seat.status).toBe('HELD');
  });

  it('refuses to confirm an expired hold and releases the seats (409)', async () => {
    const { event, seats } = await createPublishedEvent(app);
    const { user, booking } = await holdOneSeat(app, event, seats);

    await Booking.updateOne({ _id: booking._id }, { expiresAt: new Date(Date.now() - 60_000) });

    const res = await request(app)
      .post(`/api/v1/bookings/${booking._id}/confirm`)
      .set(auth(user.accessToken))
      .send({});

    expect(res.status).toBe(409);
    const seat = await Seat.findById(seats[0]._id);
    expect(seat.status).toBe('AVAILABLE');
    const b = await Booking.findById(booking._id);
    expect(b.status).toBe('EXPIRED');
  });

  it("returns 404 when confirming someone else's booking", async () => {
    const { event, seats } = await createPublishedEvent(app);
    const { booking } = await holdOneSeat(app, event, seats);
    const intruder = await registerUser(app);

    const res = await request(app)
      .post(`/api/v1/bookings/${booking._id}/confirm`)
      .set(auth(intruder.accessToken))
      .send({});
    expect(res.status).toBe(404);
  });
});
