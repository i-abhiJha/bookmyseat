// Concurrency load test: fires many parallel /bookings/hold requests at the
// same seats and checks that successful holds == seats actually HELD (i.e. no
// double-booking). Needs a published EVENT_ID and a running server.
//   BASE_URL=http://localhost:4100 EVENT_ID=<id> node scripts/loadtest.js
// Env knobs: REQUESTS, USERS, CONCURRENCY

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5000';
const EVENT_ID = process.env.EVENT_ID;
const REQUESTS = Number(process.env.REQUESTS ?? 600);
const USERS = Number(process.env.USERS ?? 40);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 100);

const api = (path) => `${BASE_URL}/api/v1${path}`;
const rand = (n) => Math.floor(Math.random() * n);

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Run tasks with a bounded worker pool.
async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function seed() {
  const mapRes = await fetch(api(`/events/${EVENT_ID}/seats`));
  if (mapRes.status !== 200) {
    throw new Error(`Could not load seat-map for EVENT_ID=${EVENT_ID} (${mapRes.status})`);
  }
  const map = await json(mapRes);
  const seatIds = map.seats.map((s) => s._id);

  // register bookers (register returns tokens, so no login rate-limit)
  const userTokens = [];
  for (let i = 0; i < USERS; i++) {
    const r = await fetch(api('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Booker ${i}`,
        email: `load_user_${Date.now()}_${i}@ex.com`,
        password: 'supersecret1',
      }),
    });
    userTokens.push((await json(r)).accessToken);
  }

  return { seatIds, userTokens };
}

async function main() {
  if (!EVENT_ID) throw new Error('EVENT_ID env var is required (a PUBLISHED event id)');

  const { seatIds, userTokens } = await seed();
  const SEATS = seatIds.length;
  console.log(
    `Load test → ${BASE_URL}\n` +
      `  seats=${SEATS} requests=${REQUESTS} users=${USERS} concurrency=${CONCURRENCY}\n`
  );

  const statuses = {};
  const latencies = [];

  // each task: a random user holds a random seat (REQUESTS >> SEATS = contention)
  const tasks = Array.from({ length: REQUESTS }, (_, i) => async () => {
    const token = userTokens[rand(userTokens.length)];
    const seatId = seatIds[rand(seatIds.length)];
    const start = performance.now();
    let status = 0;
    try {
      const res = await fetch(api('/bookings/hold'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          eventId: EVENT_ID,
          seatIds: [seatId],
          idempotencyKey: `loadtest-${i}`,
        }),
      });
      status = res.status;
      await res.text();
    } catch {
      status = -1; // network/connection error
    }
    latencies.push(performance.now() - start);
    statuses[status] = (statuses[status] ?? 0) + 1;
  });

  const t0 = performance.now();
  await runPool(tasks, CONCURRENCY);
  const wallSec = (performance.now() - t0) / 1000;

  // check the invariant against the live seat-map
  const map = await json(await fetch(api(`/events/${EVENT_ID}/seats`)));
  const held = map.summary.HELD;
  const successes = statuses[201] ?? 0;
  const conflicts = statuses[409] ?? 0;

  latencies.sort((a, b) => a - b);
  console.log('--- Throughput ---');
  console.log(`  total requests : ${REQUESTS}`);
  console.log(`  wall time      : ${wallSec.toFixed(2)}s`);
  console.log(`  throughput     : ${(REQUESTS / wallSec).toFixed(0)} req/s`);
  console.log(`  latency p50    : ${percentile(latencies, 50).toFixed(1)} ms`);
  console.log(`  latency p95    : ${percentile(latencies, 95).toFixed(1)} ms`);
  console.log(`  latency p99    : ${percentile(latencies, 99).toFixed(1)} ms`);
  console.log('--- Responses ---');
  console.log(`  ${JSON.stringify(statuses)}`);
  console.log('--- Correctness ---');
  console.log(`  successful holds (201) : ${successes}`);
  console.log(`  conflicts (409)        : ${conflicts}`);
  console.log(`  seats now HELD         : ${held}`);

  const ok = successes === held && successes <= SEATS;
  console.log(
    `\n${ok ? '✅ PASS' : '❌ FAIL'} — ${
      ok
        ? 'no double-booking: successful holds == seats held'
        : `INVARIANT VIOLATED: successes(${successes}) != held(${held})`
    }`
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
