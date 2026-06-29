import mongoose from 'mongoose';
import { Event } from '../models/Event.js';
import { Seat } from '../models/Seat.js';
import { ApiError } from '../utils/ApiError.js';
import { cacheGetOrSet, cacheDel, cacheDelPattern } from '../utils/cache.js';

const toObjectId = (id) => new mongoose.Types.ObjectId(id);

// Browse endpoints are cached with short TTLs; the seat-map is never cached.
const CACHE_TTL = { list: 30, detail: 60 };
const listKey = ({ page, limit }) => `cache:events:list:p${page}:l${limit}`;
const detailKey = (id) => `cache:events:detail:${id}`;
const LIST_PATTERN = 'cache:events:list:*';

const rowLetter = (i) => String.fromCharCode(65 + i); // 0 -> 'A'

// Expand section specs (rows x seatsPerRow) into individual seat docs.
function buildSeatDocs(eventId, sections) {
  const docs = [];
  for (const section of sections) {
    for (let r = 0; r < section.rows; r++) {
      const letter = rowLetter(r);
      for (let s = 1; s <= section.seatsPerRow; s++) {
        docs.push({
          event: eventId,
          section: section.name,
          label: `${letter}${s}`,
          tier: section.tier,
          price: section.price,
          status: 'AVAILABLE',
        });
      }
    }
  }
  return docs;
}

// Create an event and its seats. No transaction (single-node Mongo), so if
// seat insertion fails we delete the event to avoid an event with no seats.
export async function createEvent(adminId, data) {
  const { sections, ...eventData } = data;
  const totalSeats = sections.reduce((sum, sec) => sum + sec.rows * sec.seatsPerRow, 0);

  const event = await Event.create({
    ...eventData,
    totalSeats,
    availableSeats: totalSeats,
    status: 'DRAFT',
    createdBy: adminId,
  });

  try {
    await Seat.insertMany(buildSeatDocs(event.id, sections), { ordered: true });
  } catch (err) {
    await Event.deleteOne({ _id: event.id });
    await Seat.deleteMany({ event: event.id });
    throw err;
  }

  return event;
}

// Only a DRAFT can be published.
export async function publishEvent(eventId) {
  const event = await Event.findOneAndUpdate(
    { _id: eventId, status: 'DRAFT' },
    { status: 'PUBLISHED' },
    { new: true }
  );
  if (!event) {
    throw ApiError.conflict('Event not found or not in DRAFT state');
  }
  await Promise.all([cacheDelPattern(LIST_PATTERN), cacheDel(detailKey(eventId))]);
  return event;
}

// uncached reads, also used as cache producers

async function queryEventsPage({ page, limit }) {
  const filter = { status: 'PUBLISHED' };
  const [items, total] = await Promise.all([
    Event.find(filter)
      .sort({ startsAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-__v')
      .lean(),
    Event.countDocuments(filter),
  ]);
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

async function findEventOrThrow(eventId) {
  const event = await Event.findById(eventId);
  if (!event) throw ApiError.notFound('Event not found');
  return event;
}

// Both return { value, hit } from the cache layer.
export async function listEvents({ page, limit }) {
  return cacheGetOrSet(listKey({ page, limit }), CACHE_TTL.list, () =>
    queryEventsPage({ page, limit })
  );
}

export async function getEventById(eventId) {
  return cacheGetOrSet(detailKey(eventId), CACHE_TTL.detail, async () => {
    const event = await findEventOrThrow(eventId);
    return event.toJSON();
  });
}

// Seats + a per-status count. Not cached — booking needs live state.
export async function getSeatMap(eventId) {
  await findEventOrThrow(eventId);

  const [seats, summaryRows] = await Promise.all([
    Seat.find({ event: eventId }).sort({ section: 1, label: 1 }),
    Seat.aggregate([
      { $match: { event: toObjectId(eventId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);

  const summary = { AVAILABLE: 0, HELD: 0, BOOKED: 0 };
  for (const row of summaryRows) summary[row._id] = row.count;

  return { eventId, summary, seats };
}
