import { z } from 'zod';
import { randomUUID } from 'crypto';
import * as reservation from '../services/reservation.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

export const holdSchema = z.object({
  eventId: objectId,
  seatIds: z.array(objectId).min(1).max(10),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const hold = asyncHandler(async (req, res) => {
  // accept the key from body or header, else generate one
  const idempotencyKey =
    req.body.idempotencyKey || req.headers['idempotency-key'] || randomUUID();

  const { booking, created } = await reservation.holdSeats(req.user.id, {
    eventId: req.body.eventId,
    seatIds: req.body.seatIds,
    idempotencyKey,
  });

  res.status(created ? 201 : 200).json({ booking });
});

export const confirmSchema = z.object({
  paymentMethod: z.string().min(1).max(40).optional(),
});

export const confirm = asyncHandler(async (req, res) => {
  const { booking, alreadyConfirmed } = await reservation.confirmBooking(
    req.user.id,
    req.params.id,
    { paymentMethod: req.body.paymentMethod }
  );
  res.status(alreadyConfirmed ? 200 : 201).json({ booking });
});

export const release = asyncHandler(async (req, res) => {
  const booking = await reservation.releaseHold(req.user.id, req.params.id);
  res.json({ booking });
});

export const myBookings = asyncHandler(async (req, res) => {
  const bookings = await reservation.listUserBookings(req.user.id);
  res.json({ bookings });
});
