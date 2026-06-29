// Dev seed: an admin/user plus two published events with seats. Wipes existing
// events/seats/bookings first. Run with: npm run seed
import { connectDb, disconnectDb } from '../src/config/db.js';
import { connectRedis, disconnectRedis } from '../src/config/redis.js';
import { User } from '../src/models/User.js';
import { Event } from '../src/models/Event.js';
import { Seat } from '../src/models/Seat.js';
import { Booking } from '../src/models/Booking.js';
import { createEvent, publishEvent } from '../src/services/event.service.js';

const ADMIN = { name: 'Demo Admin', email: 'admin@bookmyseat.dev', password: 'supersecret1' };
const DEMO_USER = { name: 'Demo User', email: 'user@bookmyseat.dev', password: 'supersecret1' };

const daysFromNow = (d) => new Date(Date.now() + d * 864e5).toISOString();

async function main() {
  await connectDb();
  await connectRedis();

  await Promise.all([
    Event.deleteMany({}),
    Seat.deleteMany({}),
    Booking.deleteMany({}),
    User.deleteMany({ email: { $in: [ADMIN.email, DEMO_USER.email] } }),
  ]);

  const admin = await User.create({
    name: ADMIN.name,
    email: ADMIN.email,
    passwordHash: await User.hashPassword(ADMIN.password),
    role: 'admin',
  });
  await User.create({
    name: DEMO_USER.name,
    email: DEMO_USER.email,
    passwordHash: await User.hashPassword(DEMO_USER.password),
    role: 'user',
  });

  const events = [
    {
      title: 'Coldplay — Music of the Spheres',
      venue: 'JLN Stadium, Delhi',
      startsAt: daysFromNow(14),
      sections: [
        { name: 'VIP', rows: 2, seatsPerRow: 10, tier: 'VIP', price: 12000 },
        { name: 'GOLD', rows: 4, seatsPerRow: 12, tier: 'PREMIUM', price: 6000 },
        { name: 'GENERAL', rows: 6, seatsPerRow: 14, tier: 'STANDARD', price: 2500 },
      ],
    },
    {
      title: 'Diljit Dosanjh — Dil-Luminati Tour',
      venue: 'DY Patil Stadium, Mumbai',
      startsAt: daysFromNow(30),
      sections: [
        { name: 'FANPIT', rows: 3, seatsPerRow: 10, tier: 'VIP', price: 9000 },
        { name: 'GENERAL', rows: 5, seatsPerRow: 12, tier: 'STANDARD', price: 1999 },
      ],
    },
  ];

  for (const data of events) {
    const ev = await createEvent(admin.id, data);
    await publishEvent(ev.id);
    console.log(`seeded + published: ${ev.title} (${ev.totalSeats} seats)`);
  }

  console.log(`\nAdmin login : ${ADMIN.email} / ${ADMIN.password}`);
  console.log(`User  login : ${DEMO_USER.email} / ${DEMO_USER.password}`);

  await disconnectRedis();
  await disconnectDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
