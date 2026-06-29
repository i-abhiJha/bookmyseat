import { Event } from '../models/Event.js';
import { Seat } from '../models/Seat.js';
import { Booking } from '../models/Booking.js';
import { config } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { withLock } from '../utils/redisLock.js';
import { charge } from './payment.service.js';

const holdTtlMs = () => config.holdTtlSeconds * 1000;

// Release seats currently HELD by this user back to AVAILABLE.
// Returns the number actually released.
async function releaseSeats(seatIds, userId) {
  const res = await Seat.updateMany(
    { _id: { $in: seatIds }, status: 'HELD', heldBy: userId },
    { $set: { status: 'AVAILABLE', heldBy: null, holdExpiresAt: null }, $inc: { version: 1 } }
  );
  return res.modifiedCount;
}

// Hold seats for a user. Each seat is claimed with a conditional
// findOneAndUpdate on status: 'AVAILABLE', so concurrent requests for the same
// seat can't both win. Multi-seat holds roll back on partial failure. The
// per-(user,key) lock plus the unique index keep retries idempotent.
export async function holdSeats(userId, { eventId, seatIds, idempotencyKey }) {
  const uniqueSeatIds = [...new Set(seatIds)];

  return withLock(`lock:hold:${userId}:${idempotencyKey}`, 5000, async () => {
    const existing = await Booking.findOne({ user: userId, idempotencyKey });
    if (existing) return { booking: existing, created: false };

    const event = await Event.findById(eventId);
    if (!event) throw ApiError.notFound('Event not found');
    if (event.status !== 'PUBLISHED') {
      throw ApiError.badRequest('Event is not open for booking');
    }

    const holdExpiresAt = new Date(Date.now() + holdTtlMs());
    const held = [];

    for (const seatId of uniqueSeatIds) {
      const seat = await Seat.findOneAndUpdate(
        { _id: seatId, event: eventId, status: 'AVAILABLE' },
        { $set: { status: 'HELD', heldBy: userId, holdExpiresAt }, $inc: { version: 1 } },
        { new: true }
      );

      if (!seat) {
        // roll back seats already held in this request
        await releaseSeats(held.map((s) => s._id), userId);
        throw ApiError.conflict('One or more seats are no longer available', {
          unavailable: [seatId],
        });
      }
      held.push(seat);
    }

    const totalAmount = held.reduce((sum, s) => sum + s.price, 0);

    let booking;
    try {
      booking = await Booking.create({
        user: userId,
        event: eventId,
        seats: held.map((s) => s._id),
        totalAmount,
        status: 'PENDING',
        idempotencyKey,
        expiresAt: holdExpiresAt,
      });
    } catch (err) {
      // a concurrent request with the same key already created the booking
      await releaseSeats(held.map((s) => s._id), userId);
      if (err.code === 11000) {
        const winner = await Booking.findOne({ user: userId, idempotencyKey });
        if (winner) return { booking: winner, created: false };
      }
      throw err;
    }

    await Event.updateOne({ _id: eventId }, { $inc: { availableSeats: -held.length } });
    return { booking, created: true };
  });
}

// User cancels their own pending hold.
export async function releaseHold(userId, bookingId) {
  const booking = await Booking.findOne({ _id: bookingId, user: userId });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status !== 'PENDING') {
    throw ApiError.conflict(`Cannot release a ${booking.status} booking`);
  }

  const freed = await releaseSeats(booking.seats, userId);
  booking.status = 'CANCELLED';
  await booking.save();
  if (freed > 0) {
    await Event.updateOne({ _id: booking.event }, { $inc: { availableSeats: freed } });
  }
  return booking;
}

// Checkout: take payment, flip HELD seats to BOOKED, mark booking CONFIRMED.
// Locked per booking so a double-submit can't charge twice; an already
// confirmed booking returns without charging again.
export async function confirmBooking(userId, bookingId, { paymentMethod } = {}) {
  return withLock(`lock:confirm:${bookingId}`, 5000, async () => {
    const booking = await Booking.findOne({ _id: bookingId, user: userId });
    if (!booking) throw ApiError.notFound('Booking not found');

    if (booking.status === 'CONFIRMED') {
      return { booking, alreadyConfirmed: true };
    }
    if (booking.status !== 'PENDING') {
      throw ApiError.conflict(`Cannot confirm a ${booking.status} booking`);
    }

    // hold may have lapsed before the sweeper ran
    if (booking.expiresAt.getTime() < Date.now()) {
      const freed = await releaseSeats(booking.seats, userId);
      booking.status = 'EXPIRED';
      await booking.save();
      if (freed > 0) {
        await Event.updateOne({ _id: booking.event }, { $inc: { availableSeats: freed } });
      }
      throw ApiError.conflict('Hold has expired; seats were released');
    }

    const payment = await charge({ amount: booking.totalAmount, method: paymentMethod });
    if (!payment.success) {
      // keep it PENDING so the user can retry within the timer
      throw ApiError.paymentRequired('Payment failed', { reason: payment.reason });
    }

    const res = await Seat.updateMany(
      { _id: { $in: booking.seats }, status: 'HELD', heldBy: userId },
      {
        $set: { status: 'BOOKED', bookedBy: userId, heldBy: null, holdExpiresAt: null },
        $inc: { version: 1 },
      }
    );
    if (res.modifiedCount !== booking.seats.length) {
      throw ApiError.conflict('Some seats are no longer held; please re-select');
    }

    booking.status = 'CONFIRMED';
    booking.paymentRef = payment.reference;
    await booking.save();
    return { booking, alreadyConfirmed: false };
  });
}

export async function listUserBookings(userId) {
  return Booking.find({ user: userId }).sort({ createdAt: -1 }).populate('seats', 'label section tier price');
}

// Expire holds whose timer elapsed. Each is claimed with a conditional update
// so multiple sweeper instances won't double-process a booking.
export async function sweepExpiredHolds(now = new Date()) {
  const candidates = await Booking.find({ status: 'PENDING', expiresAt: { $lt: now } })
    .select('_id event seats user')
    .lean();

  let expired = 0;
  for (const c of candidates) {
    const claimed = await Booking.findOneAndUpdate(
      { _id: c._id, status: 'PENDING', expiresAt: { $lt: now } },
      { $set: { status: 'EXPIRED' } }
    );
    if (!claimed) continue;

    const freed = await releaseSeats(c.seats, c.user);
    if (freed > 0) {
      await Event.updateOne({ _id: c.event }, { $inc: { availableSeats: freed } });
    }
    expired += 1;
  }
  return expired;
}
