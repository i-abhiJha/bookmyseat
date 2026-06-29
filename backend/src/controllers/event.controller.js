import { z } from 'zod';
import * as eventService from '../services/event.service.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const sectionSchema = z.object({
  name: z.string().min(1).max(40),
  rows: z.number().int().min(1).max(26), // rows are lettered A..Z
  seatsPerRow: z.number().int().min(1).max(100),
  tier: z.enum(['STANDARD', 'PREMIUM', 'VIP']).default('STANDARD'),
  price: z.number().min(0),
});

export const createEventSchema = z
  .object({
    title: z.string().min(2).max(120),
    description: z.string().max(2000).optional(),
    venue: z.string().min(2).max(120),
    startsAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), {
      message: 'startsAt must be in the future',
    }),
    sections: z.array(sectionSchema).min(1).max(20),
  })
  .refine(
    (data) => new Set(data.sections.map((s) => s.name)).size === data.sections.length,
    { message: 'Section names must be unique', path: ['sections'] }
  );

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const createEvent = asyncHandler(async (req, res) => {
  const event = await eventService.createEvent(req.user.id, req.body);
  res.status(201).json({ event });
});

export const publishEvent = asyncHandler(async (req, res) => {
  const event = await eventService.publishEvent(req.params.id);
  res.json({ event });
});

export const listEvents = asyncHandler(async (req, res) => {
  const { value, hit } = await eventService.listEvents(req.query);
  res.set('X-Cache', hit ? 'HIT' : 'MISS');
  res.json(value);
});

export const getEvent = asyncHandler(async (req, res) => {
  const { value, hit } = await eventService.getEventById(req.params.id);
  res.set('X-Cache', hit ? 'HIT' : 'MISS');
  res.json({ event: value });
});

export const getSeatMap = asyncHandler(async (req, res) => {
  const seatMap = await eventService.getSeatMap(req.params.id);
  res.json(seatMap);
});
